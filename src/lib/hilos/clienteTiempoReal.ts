'use client'

import {
  CentralTiempoReal,
  ENTORNO_NAVEGADOR,
  type Conexion,
  type MensajeAlCentral,
  type MensajeDelCentral,
  type Puerto,
} from './tiempoReal'

/**
 * Lado de la pestana de la central de tiempo real. Con Shared Worker, todas las pestanas comparten
 * un hilo y sus conexiones; sin el (algunos navegadores moviles), la misma central corre aqui.
 */
class ClienteTiempoReal {
  private readonly oyentes = new Set<(m: MensajeDelCentral) => void>()
  private readonly esperando = new Map<number, { resolver: (b: Uint8Array) => void; rechazar: (e: unknown) => void }>()
  private readonly cuentas = new Map<string, number>()
  private siguiente = 1
  readonly compartido: boolean
  private readonly enviar: (m: MensajeAlCentral) => void

  constructor() {
    let enviar: ((m: MensajeAlCentral) => void) | null = null
    let compartido = false
    if (typeof SharedWorker !== 'undefined') {
      try {
        const w = new SharedWorker(new URL('../../workers/tiempoReal.worker.ts', import.meta.url), {
          type: 'module',
          name: 'actaflow-tiempo-real',
        })
        w.port.onmessage = (e: MessageEvent<MensajeDelCentral>) => this.despachar(e.data)
        w.port.start()
        enviar = (m) => w.port.postMessage(m)
        compartido = true
      } catch {
        enviar = null
      }
    }
    if (!enviar) {
      const central = new CentralTiempoReal(ENTORNO_NAVEGADOR)
      const local: Puerto = { postMessage: (m) => queueMicrotask(() => this.despachar(m)) }
      enviar = (m) => central.recibir(local, m)
    }
    this.enviar = enviar
    this.compartido = compartido
    // Senales de vida para que la central suelte las pestanas cerradas sin despedirse.
    setInterval(() => this.enviar({ tipo: 'latido' }), 10_000)
    window.addEventListener('pagehide', () => this.enviar({ tipo: 'adios' }))
  }

  private despachar(m: MensajeDelCentral): void {
    if (m.tipo === 'traido' || m.tipo === 'traido-error') {
      const p = this.esperando.get(m.id)
      this.esperando.delete(m.id)
      if (m.tipo === 'traido') p?.resolver(m.respuesta)
      else p?.rechazar(m)
      return
    }
    for (const o of this.oyentes) o(m)
  }

  /** Cuenta referencias: dos componentes de la misma pestana comparten una suscripcion. */
  private sumar(clave: string, alta: () => void, baja: () => void): () => void {
    const n = this.cuentas.get(clave) ?? 0
    this.cuentas.set(clave, n + 1)
    if (n === 0) alta()
    return () => {
      const resto = (this.cuentas.get(clave) ?? 1) - 1
      this.cuentas.set(clave, resto)
      if (resto === 0) baja()
    }
  }

  suscribirAudiencia(
    casoId: string,
    audienciaId: string,
    alEvento: (e: string) => void,
    alConexion: (estado: Conexion, pestanas: number) => void,
  ): () => void {
    const oyente = (m: MensajeDelCentral) => {
      if (m.tipo === 'evento' && m.audienciaId === audienciaId) alEvento(m.e)
      else if (m.tipo === 'conexion' && m.audienciaId === audienciaId) alConexion(m.estado, m.pestanas)
    }
    this.oyentes.add(oyente)
    const soltar = this.sumar(
      `a:${audienciaId}`,
      () => this.enviar({ tipo: 'audiencia', casoId, audienciaId }),
      () => this.enviar({ tipo: 'dejar-audiencia', audienciaId }),
    )
    return () => {
      this.oyentes.delete(oyente)
      soltar()
    }
  }

  seguirBorrador(casoId: string, actaId: string, alNuevo: (pestanas: number) => void): () => void {
    const oyente = (m: MensajeDelCentral) => {
      if (m.tipo === 'borrador-nuevo' && m.actaId === actaId) alNuevo(m.pestanas)
    }
    this.oyentes.add(oyente)
    const soltar = this.sumar(
      `b:${actaId}`,
      () => this.enviar({ tipo: 'borrador', casoId, actaId }),
      () => this.enviar({ tipo: 'dejar-borrador', actaId }),
    )
    return () => {
      this.oyentes.delete(oyente)
      soltar()
    }
  }

  traerBorrador(casoId: string, actaId: string, despues: number): Promise<Uint8Array> {
    const id = this.siguiente++
    return new Promise((resolver, rechazar) => {
      this.esperando.set(id, { resolver, rechazar })
      this.enviar({ tipo: 'traer', id, casoId, actaId, despues })
    })
  }
}

let unico: ClienteTiempoReal | null = null

/** Una sola conexion con la central por pestana. */
export function tiempoReal(): ClienteTiempoReal {
  unico ??= new ClienteTiempoReal()
  return unico
}

export function esErrorTraido(x: unknown): x is Extract<MensajeDelCentral, { tipo: 'traido-error' }> {
  return typeof x === 'object' && x !== null && Reflect.get(x, 'tipo') === 'traido-error'
}
