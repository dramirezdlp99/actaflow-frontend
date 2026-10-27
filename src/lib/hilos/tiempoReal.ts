import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { z } from 'zod'
import {
  GetDocumentStateResponseSchema,
  SequencedUpdateSchema,
  type SequencedUpdate,
} from '@/gen/actaflow/collaboration/v1/collaboration_pb'
import type { EncryptedBlob } from '@/gen/actaflow/crypto/v1/crypto_pb'
import { WatchHearingEventsResponseSchema } from '@/gen/actaflow/hearings/v1/hearing_pb'
import { desdeTexto } from '@/lib/audiencias/protocolo'

/**
 * Central de TIEMPO REAL de ActaFlow. Corre en un SHARED WORKER (src/workers/tiempoReal.worker.ts):
 * un solo hilo para todas las pestanas abiertas del sitio en este navegador.
 *
 *   pestana 1 ─┐                       ┌─► 1 flujo de eventos por audiencia (NDJSON)
 *   pestana 2 ─┼── MessagePort ── central ─┤
 *   pestana 3 ─┘                       └─► 1 consulta cada 3 s por borrador de acta
 *
 * Asi, con la misma audiencia o la misma acta abiertas en tres pestanas, la red ve UNA conexion y no
 * tres (caso de estudio 3.2: "sin generar peticiones duplicadas"). Lo que llega se reparte a todas.
 * Todo sigue cifrado: la central reenvia bytes que solo las pestanas abren con la clave del caso.
 * Si el navegador no tiene SharedWorker, la misma clase corre dentro de la pestana.
 */

export type Conexion = 'conectando' | 'en-vivo' | 'reintentando' | 'cerrada'

export type MensajeAlCentral =
  | { tipo: 'audiencia'; casoId: string; audienciaId: string }
  | { tipo: 'dejar-audiencia'; audienciaId: string }
  | { tipo: 'borrador'; casoId: string; actaId: string }
  | { tipo: 'dejar-borrador'; actaId: string }
  | { tipo: 'traer'; id: number; casoId: string; actaId: string; despues: number }
  | { tipo: 'latido' }
  | { tipo: 'adios' }

export type MensajeDelCentral =
  | { tipo: 'evento'; audienciaId: string; e: string }
  | { tipo: 'conexion'; audienciaId: string; estado: Conexion; pestanas: number }
  | { tipo: 'traido'; id: number; respuesta: Uint8Array }
  | { tipo: 'traido-error'; id: number; sinConexion: boolean; definitivo: boolean; mensaje: string }
  | { tipo: 'borrador-nuevo'; actaId: string; pestanas: number }

export type Puerto = { postMessage(m: MensajeDelCentral): void }

export type Entorno = {
  fetch: typeof fetch
  ahora: () => number
  /** Espera cancelable (en las pruebas, inmediata). */
  dormir: (ms: number, senal: AbortSignal) => Promise<void>
  cadaTanto: (f: () => void, ms: number) => () => void
}

export const INTERVALO_BORRADOR_MS = 3_000
/** Una consulta de hace menos de esto sirve para todas las pestanas que piden a la vez. */
export const FRESCURA_MS = 1_000
/** Una pestana que no da senales en este tiempo se da por cerrada. */
export const SILENCIO_MAXIMO_MS = 35_000

const LINEA = z.object({ e: z.string().optional(), fin: z.boolean().optional(), error: z.string().optional() })
const FALLO = z.object({ mensaje: z.string(), definitivo: z.boolean() })

type Audiencia = {
  casoId: string
  puertos: Set<Puerto>
  eventos: string[]
  despues: bigint
  estado: Conexion
  corte: AbortController
}

type Borrador = {
  casoId: string
  puertos: Set<Puerto>
  cambios: Map<number, SequencedUpdate>
  foto: { blob: EncryptedBlob; secuencia: number } | null
  ultima: number
  ultimaConsulta: number
  enCurso: Promise<void> | null
  parar: () => void
}

class ErrorRed extends Error {
  constructor(
    mensaje: string,
    readonly sinConexion: boolean,
    readonly definitivo: boolean,
  ) {
    super(mensaje)
  }
}

export class CentralTiempoReal {
  private readonly audiencias = new Map<string, Audiencia>()
  private readonly borradores = new Map<string, Borrador>()
  private readonly vistos = new Map<Puerto, number>()

  constructor(private readonly entorno: Entorno) {}

  /** Cuantas conexiones de red hay abiertas de verdad (para las pruebas y el panel de la sala). */
  get conexionesAbiertas(): number {
    return this.audiencias.size + this.borradores.size
  }

  recibir(puerto: Puerto, m: MensajeAlCentral): void {
    this.vistos.set(puerto, this.entorno.ahora())
    switch (m.tipo) {
      case 'audiencia':
        return this.seguirAudiencia(puerto, m.casoId, m.audienciaId)
      case 'dejar-audiencia':
        return this.dejarAudiencia(puerto, m.audienciaId)
      case 'borrador':
        return this.seguirBorrador(puerto, m.casoId, m.actaId)
      case 'dejar-borrador':
        return this.dejarBorrador(puerto, m.actaId)
      case 'traer':
        void this.traer(puerto, m)
        return
      case 'latido':
        return
      case 'adios':
        return this.olvidar(puerto)
    }
  }

  /** Suelta las pestanas que dejaron de dar senales (se cerraron sin despedirse). */
  revisarSilencios(): void {
    const limite = this.entorno.ahora() - SILENCIO_MAXIMO_MS
    for (const [puerto, visto] of this.vistos) {
      if (visto < limite) this.olvidar(puerto)
    }
  }

  olvidar(puerto: Puerto): void {
    this.vistos.delete(puerto)
    for (const id of [...this.audiencias.keys()]) this.dejarAudiencia(puerto, id)
    for (const id of [...this.borradores.keys()]) this.dejarBorrador(puerto, id)
  }

  // ---------------------------------------------------------------------------------- audiencias

  private avisarConexion(id: string, a: Audiencia): void {
    for (const p of a.puertos) p.postMessage({ tipo: 'conexion', audienciaId: id, estado: a.estado, pestanas: a.puertos.size })
  }

  private seguirAudiencia(puerto: Puerto, casoId: string, id: string): void {
    let a = this.audiencias.get(id)
    if (!a) {
      a = { casoId, puertos: new Set(), eventos: [], despues: 0n, estado: 'conectando', corte: new AbortController() }
      this.audiencias.set(id, a)
      void this.flujo(id, a)
    }
    a.puertos.add(puerto)
    // La pestana nueva recibe todo lo que ya paso, sin pedirlo otra vez al servidor.
    for (const e of a.eventos) puerto.postMessage({ tipo: 'evento', audienciaId: id, e })
    this.avisarConexion(id, a)
  }

  private dejarAudiencia(puerto: Puerto, id: string): void {
    const a = this.audiencias.get(id)
    if (!a || !a.puertos.delete(puerto)) return
    if (a.puertos.size === 0) {
      a.corte.abort()
      this.audiencias.delete(id)
    } else {
      this.avisarConexion(id, a)
    }
  }

  private async flujo(id: string, a: Audiencia): Promise<void> {
    let fallos = 0
    let terminada = false
    while (!a.corte.signal.aborted && !terminada) {
      try {
        const r = await this.entorno.fetch(
          `/expedientes/${a.casoId}/audiencia/eventos?audiencia=${id}&despues=${a.despues}`,
          { signal: a.corte.signal, cache: 'no-store' },
        )
        if (!r.ok || !r.body || !r.headers.get('content-type')?.includes('ndjson')) throw new Error(`HTTP ${r.status}`)
        a.estado = 'en-vivo'
        this.avisarConexion(id, a)
        const lector = r.body.getReader()
        const decodificador = new TextDecoder()
        let resto = ''
        for (;;) {
          const { value, done } = await lector.read()
          if (done) break
          resto += decodificador.decode(value, { stream: true })
          const lineas = resto.split('\n')
          resto = lineas.pop() ?? ''
          for (const linea of lineas) {
            if (!linea) continue
            const dato = LINEA.parse(JSON.parse(linea))
            if (dato.error) throw new Error(dato.error)
            if (!dato.e) continue
            const evento = desdeTexto(WatchHearingEventsResponseSchema, dato.e)
            if (evento.eventSequence <= a.despues) continue
            a.despues = evento.eventSequence
            a.eventos.push(dato.e)
            fallos = 0
            if (evento.event.case === 'hearingEnded') terminada = true
            for (const p of a.puertos) p.postMessage({ tipo: 'evento', audienciaId: id, e: dato.e })
          }
        }
      } catch {
        if (a.corte.signal.aborted) return
        fallos += 1
        a.estado = 'reintentando'
        this.avisarConexion(id, a)
        await this.entorno.dormir(Math.min(15_000, 1_000 * 2 ** Math.min(fallos, 4)), a.corte.signal)
      }
    }
    if (terminada) {
      a.estado = 'cerrada'
      this.avisarConexion(id, a)
    }
  }

  // ---------------------------------------------------------------------------------- borradores

  private seguirBorrador(puerto: Puerto, casoId: string, actaId: string): void {
    let b = this.borradores.get(actaId)
    if (!b) {
      const nuevo: Borrador = {
        casoId,
        puertos: new Set(),
        cambios: new Map(),
        foto: null,
        ultima: 0,
        ultimaConsulta: 0,
        enCurso: null,
        parar: () => {},
      }
      nuevo.parar = this.entorno.cadaTanto(() => void this.consultar(actaId, nuevo).catch(() => undefined), INTERVALO_BORRADOR_MS)
      this.borradores.set(actaId, nuevo)
      b = nuevo
    }
    b.puertos.add(puerto)
  }

  private dejarBorrador(puerto: Puerto, actaId: string): void {
    const b = this.borradores.get(actaId)
    if (!b || !b.puertos.delete(puerto)) return
    if (b.puertos.size === 0) {
      b.parar()
      this.borradores.delete(actaId)
    }
  }

  /** Una sola consulta a la vez por acta; quien llega mientras tanto espera esa misma. */
  private consultar(actaId: string, b: Borrador): Promise<void> {
    b.enCurso ??= (async () => {
      try {
        const r = await this.entorno
          .fetch(`/expedientes/${b.casoId}/acta/borrador?acta=${actaId}&despues=${b.ultima}`, { cache: 'no-store' })
          .catch(() => {
            throw new ErrorRed('Sin conexión', true, false)
          })
        if (!r.ok) {
          const fallo = FALLO.safeParse(await r.json().catch(() => null))
          throw new ErrorRed(fallo.success ? fallo.data.mensaje : `HTTP ${r.status}`, false, fallo.success && fallo.data.definitivo)
        }
        const estado = fromBinary(GetDocumentStateResponseSchema, new Uint8Array(await r.arrayBuffer()))
        b.ultimaConsulta = this.entorno.ahora()
        let nuevos = 0
        if (estado.snapshot) {
          b.foto = { blob: estado.snapshot, secuencia: Number(estado.snapshotSequence) }
          for (const s of [...b.cambios.keys()]) if (s <= b.foto.secuencia) b.cambios.delete(s)
          b.ultima = Math.max(b.ultima, b.foto.secuencia)
          nuevos += 1
        }
        for (const u of estado.updates) {
          const s = Number(u.sequence)
          if (b.cambios.has(s)) continue
          b.cambios.set(s, u)
          b.ultima = Math.max(b.ultima, s)
          nuevos += 1
        }
        if (nuevos > 0) {
          for (const p of b.puertos) p.postMessage({ tipo: 'borrador-nuevo', actaId, pestanas: b.puertos.size })
        }
        if (estado.updates.length >= 500) b.ultimaConsulta = 0
      } finally {
        b.enCurso = null
      }
    })()
    return b.enCurso
  }

  private async traer(puerto: Puerto, m: Extract<MensajeAlCentral, { tipo: 'traer' }>): Promise<void> {
    this.seguirBorrador(puerto, m.casoId, m.actaId)
    const b = this.borradores.get(m.actaId)
    if (!b) return
    try {
      if (this.entorno.ahora() - b.ultimaConsulta >= FRESCURA_MS || b.enCurso) await this.consultar(m.actaId, b)
      const conFoto = b.foto !== null && m.despues < b.foto.secuencia
      const desde = conFoto && b.foto ? b.foto.secuencia : m.despues
      const respuesta = create(GetDocumentStateResponseSchema, {
        snapshot: conFoto ? b.foto?.blob : undefined,
        snapshotSequence: BigInt(conFoto ? (b.foto?.secuencia ?? 0) : 0),
        updates: [...b.cambios.entries()]
          .filter(([s]) => s > desde)
          .sort(([x], [y]) => x - y)
          .map(([, u]) => create(SequencedUpdateSchema, u)),
      })
      puerto.postMessage({ tipo: 'traido', id: m.id, respuesta: toBinary(GetDocumentStateResponseSchema, respuesta) })
    } catch (e) {
      const red = e instanceof ErrorRed ? e : new ErrorRed(e instanceof Error ? e.message : 'Error', false, false)
      puerto.postMessage({ tipo: 'traido-error', id: m.id, sinConexion: red.sinConexion, definitivo: red.definitivo, mensaje: red.message })
    }
  }
}

/** El entorno real (navegador o Shared Worker). */
export const ENTORNO_NAVEGADOR: Entorno = {
  fetch: (...a) => fetch(...a),
  ahora: () => Date.now(),
  dormir: (ms, senal) =>
    new Promise<void>((resolver) => {
      const t = setTimeout(resolver, ms)
      senal.addEventListener('abort', () => {
        clearTimeout(t)
        resolver()
      })
    }),
  cadaTanto: (f, ms) => {
    const t = setInterval(f, ms)
    return () => clearInterval(t)
  },
}
