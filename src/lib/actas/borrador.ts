import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import {
  EncryptedUpdateSchema,
  PushUpdatesRequestSchema,
  type EncryptedUpdate,
  type GetDocumentStateResponse,
} from '@/gen/actaflow/collaboration/v1/collaboration_pb'
import { EncryptedBlobSchema } from '@/gen/actaflow/crypto/v1/crypto_pb'
import { cifrarBorrador, descifrarBorrador, PROPOSITO } from '@/lib/audiencias/sellado'

/**
 * Borrador colaborativo del acta, que funciona sin conexion (caso de estudio 3.2).
 *
 * Modelo: un mapa campo → valor del formulario. Cada edicion es un CAMBIO {campo, valor, autor},
 * cifrado con la clave del caso y con un update_id propio. legal-case solo le da un numero de orden
 * (secuencia) y todos los navegadores aplican los cambios en ese mismo orden: con la regla "el ultimo
 * en el orden del servidor gana" (registro LWW por campo) todos llegan al mismo borrador, que es lo
 * que pide un CRDT, sin que el servidor lea nada.
 *
 * Sin conexion, los cambios se guardan cifrados en la BANDEJA DE SALIDA (IndexedDB) y se ven al
 * instante; al volver la red se envian solos. Reenviar no duplica: el servidor reconoce el update_id.
 */

export type Valores = Record<string, string>
export type Cambio = { campo: string; valor: string | null; autor: string }

// ------------------------------------------------------------------------------ documento

export class DocumentoBorrador {
  private confirmados = new Map<string, string>()
  private pendientes: { updateId: string; cambio: Cambio }[] = []
  secuencia = 0

  private static aplicar(mapa: Map<string, string>, c: Cambio) {
    if (c.valor === null) mapa.delete(c.campo)
    else mapa.set(c.campo, c.valor)
  }

  /** Lo confirmado por el servidor mas lo propio que aun no confirma, en el orden en que se hizo. */
  valores(): Valores {
    const mapa = new Map(this.confirmados)
    for (const p of this.pendientes) DocumentoBorrador.aplicar(mapa, p.cambio)
    return Object.fromEntries(mapa)
  }

  get cantidadPendiente(): number {
    return this.pendientes.length
  }

  foto(valores: Valores, secuencia: number) {
    if (secuencia < this.secuencia) return
    this.confirmados = new Map(Object.entries(valores))
    this.secuencia = secuencia
  }

  local(updateId: string, cambio: Cambio) {
    if (!this.pendientes.some((p) => p.updateId === updateId)) this.pendientes.push({ updateId, cambio })
  }

  /** Un cambio ya ordenado por el servidor (propio o ajeno). Los repetidos o viejos se ignoran. */
  remoto(secuencia: number, updateId: string, cambio: Cambio | null) {
    if (secuencia <= this.secuencia) return
    if (cambio) DocumentoBorrador.aplicar(this.confirmados, cambio)
    this.secuencia = secuencia
    this.pendientes = this.pendientes.filter((p) => p.updateId !== updateId)
  }

  descartarPendientes(): number {
    const n = this.pendientes.length
    this.pendientes = []
    return n
  }

  confirmadosComoValores(): Valores {
    return Object.fromEntries(this.confirmados)
  }
}

// ------------------------------------------------------------------------------ cifrado

export type ContextoBorrador = {
  claveCaso: CryptoKey
  idClaveCaso: string
  casoId: string
  actaId: string
  autor: string
}

const json = new TextEncoder()
const leerJson = new TextDecoder()

function esCambio(x: unknown): x is Cambio {
  if (typeof x !== 'object' || x === null) return false
  const campo: unknown = Reflect.get(x, 'campo')
  const valor: unknown = Reflect.get(x, 'valor')
  const autor: unknown = Reflect.get(x, 'autor')
  return (
    typeof campo === 'string' &&
    campo.length <= 200 &&
    (valor === null || (typeof valor === 'string' && valor.length <= 4000)) &&
    typeof autor === 'string'
  )
}

function esFoto(x: unknown): x is { secuencia: number; valores: Valores } {
  if (typeof x !== 'object' || x === null) return false
  const secuencia: unknown = Reflect.get(x, 'secuencia')
  const valores: unknown = Reflect.get(x, 'valores')
  return (
    typeof secuencia === 'number' &&
    typeof valores === 'object' &&
    valores !== null &&
    Object.values(valores).every((v) => typeof v === 'string')
  )
}

export async function cifrarCambio(c: ContextoBorrador, cambio: Cambio): Promise<EncryptedUpdate> {
  const updateId = globalThis.crypto.randomUUID()
  const update = await cifrarBorrador(
    c.claveCaso,
    c.idClaveCaso,
    PROPOSITO.borrador,
    c.casoId,
    updateId,
    json.encode(JSON.stringify(cambio)),
  )
  return create(EncryptedUpdateSchema, { updateId, update })
}

/** null si el cambio no se puede abrir o no tiene la forma esperada (se salta, no rompe el borrador). */
export async function abrirCambio(c: ContextoBorrador, u: EncryptedUpdate): Promise<Cambio | null> {
  if (!u.update) return null
  try {
    const claro = await descifrarBorrador(c.claveCaso, u.update, PROPOSITO.borrador, c.casoId, u.updateId)
    const dato: unknown = JSON.parse(leerJson.decode(claro))
    return esCambio(dato) ? dato : null
  } catch {
    return null
  }
}

/** La foto va atada al acta (AAD); la secuencia va dentro, cifrada y autenticada. */
export async function cifrarFoto(c: ContextoBorrador, valores: Valores, secuencia: number) {
  return cifrarBorrador(
    c.claveCaso,
    c.idClaveCaso,
    PROPOSITO.borradorFoto,
    c.casoId,
    c.actaId,
    json.encode(JSON.stringify({ secuencia, valores })),
  )
}

export async function abrirFoto(
  c: ContextoBorrador,
  blob: Parameters<typeof descifrarBorrador>[1],
): Promise<{ secuencia: number; valores: Valores } | null> {
  try {
    const dato: unknown = JSON.parse(
      leerJson.decode(await descifrarBorrador(c.claveCaso, blob, PROPOSITO.borradorFoto, c.casoId, c.actaId)),
    )
    return esFoto(dato) ? dato : null
  } catch {
    return null
  }
}

// ------------------------------------------------------------------------------ bandeja de salida

/** Lo que se guarda en el navegador por acta: siempre CIFRADO con la clave del caso. */
export interface Bandeja {
  leerFoto(actaId: string): Promise<Uint8Array | null>
  guardarFoto(actaId: string, foto: Uint8Array): Promise<void>
  pendientes(actaId: string): Promise<Uint8Array[]>
  agregar(actaId: string, updateId: string, cambio: Uint8Array): Promise<void>
  quitar(actaId: string, updateIds: string[]): Promise<void>
}

export class BandejaEnMemoria implements Bandeja {
  private readonly fotos = new Map<string, Uint8Array>()
  private readonly cola = new Map<string, Map<string, Uint8Array>>()

  async leerFoto(actaId: string) {
    return this.fotos.get(actaId) ?? null
  }
  async guardarFoto(actaId: string, foto: Uint8Array) {
    this.fotos.set(actaId, foto)
  }
  async pendientes(actaId: string) {
    return [...(this.cola.get(actaId)?.values() ?? [])]
  }
  async agregar(actaId: string, updateId: string, cambio: Uint8Array) {
    const m = this.cola.get(actaId) ?? new Map<string, Uint8Array>()
    m.set(updateId, cambio)
    this.cola.set(actaId, m)
  }
  async quitar(actaId: string, updateIds: string[]) {
    for (const id of updateIds) this.cola.get(actaId)?.delete(id)
  }
}

// ------------------------------------------------------------------------------ sincronizacion

/** Fallo de red (sin conexion) frente a un rechazo del servidor (definitivo). */
export class SinConexion extends Error {}
export class Rechazado extends Error {}

export type Transporte = {
  traer(actaId: string, despues: number): Promise<GetDocumentStateResponse>
  enviar(peticion: Uint8Array): Promise<number[]>
}

export type EstadoBorrador = {
  valores: Valores
  pendientes: number
  conexion: 'en-linea' | 'sin-conexion'
  aviso: string | null
}

export class SincronizadorBorrador {
  private readonly doc = new DocumentoBorrador()
  private conexion: EstadoBorrador['conexion'] = 'en-linea'
  private aviso: string | null = null
  private ocupado: Promise<void> | null = null
  private otraVez = false

  constructor(
    private readonly c: ContextoBorrador,
    private readonly transporte: Transporte,
    private readonly bandeja: Bandeja,
    private readonly avisar: (estado: EstadoBorrador) => void,
  ) {}

  private publicar() {
    this.avisar({
      valores: this.doc.valores(),
      pendientes: this.doc.cantidadPendiente,
      conexion: this.conexion,
      aviso: this.aviso,
    })
  }

  get valores(): Valores {
    return this.doc.valores()
  }

  /** Lo guardado en este navegador primero (sirve sin red); luego, el servidor. */
  async iniciar(): Promise<void> {
    const foto = await this.bandeja.leerFoto(this.c.actaId)
    if (foto) {
      const abierta = await abrirFoto(this.c, fromBinary(EncryptedBlobSchema, foto))
      if (abierta) this.doc.foto(abierta.valores, abierta.secuencia)
    }
    for (const bytes of await this.bandeja.pendientes(this.c.actaId)) {
      const u = fromBinary(EncryptedUpdateSchema, bytes)
      const cambio = await abrirCambio(this.c, u)
      if (cambio) this.doc.local(u.updateId, cambio)
    }
    this.publicar()
    await this.sincronizar()
  }

  async cambiar(campo: string, valor: string | null): Promise<void> {
    const cambio: Cambio = { campo, valor, autor: this.c.autor }
    const u = await cifrarCambio(this.c, cambio)
    this.doc.local(u.updateId, cambio)
    this.publicar()
    await this.bandeja.agregar(this.c.actaId, u.updateId, toBinary(EncryptedUpdateSchema, u))
    void this.sincronizar()
  }

  /** Envia lo pendiente y trae lo nuevo. Si ya hay una vuelta en curso, hace otra al terminar. */
  sincronizar(): Promise<void> {
    if (this.ocupado) {
      this.otraVez = true
      return this.ocupado
    }
    this.ocupado = (async () => {
      do {
        this.otraVez = false
        await this.vuelta()
      } while (this.otraVez)
    })().finally(() => {
      this.ocupado = null
    })
    return this.ocupado
  }

  private async vuelta(): Promise<void> {
    try {
      await this.enviarPendientes()
      await this.traer()
      this.conexion = 'en-linea'
    } catch (e) {
      if (e instanceof SinConexion) this.conexion = 'sin-conexion'
      else this.aviso = e instanceof Error ? e.message : 'No se pudo sincronizar el borrador.'
    }
    this.publicar()
  }

  private async enviarPendientes(): Promise<void> {
    const todos = await this.bandeja.pendientes(this.c.actaId)
    for (let i = 0; i < todos.length; i += 200) {
      const lote = todos.slice(i, i + 200).map((b) => fromBinary(EncryptedUpdateSchema, b))
      const peticion = create(PushUpdatesRequestSchema, { minuteId: this.c.actaId, updates: lote })
      try {
        await this.transporte.enviar(toBinary(PushUpdatesRequestSchema, peticion))
      } catch (e) {
        if (e instanceof Rechazado) {
          // El acta se cerro (o ya no puedes editar): esos cambios no van a entrar nunca.
          await this.bandeja.quitar(this.c.actaId, lote.map((u) => u.updateId))
          const n = this.doc.descartarPendientes()
          this.aviso = n > 0 ? `${e.message} ${n === 1 ? 'Un cambio' : `${n} cambios`} sin enviar no se guardaron.` : e.message
          return
        }
        throw e
      }
      await this.bandeja.quitar(this.c.actaId, lote.map((u) => u.updateId))
    }
  }

  private async traer(): Promise<void> {
    for (;;) {
      const r = await this.transporte.traer(this.c.actaId, this.doc.secuencia)
      if (r.snapshot) {
        const foto = await abrirFoto(this.c, r.snapshot)
        if (foto && foto.secuencia === Number(r.snapshotSequence)) this.doc.foto(foto.valores, foto.secuencia)
      }
      for (const s of r.updates) {
        const u = s.update
        if (!u) continue
        this.doc.remoto(Number(s.sequence), u.updateId, await abrirCambio(this.c, u))
      }
      if (r.updates.length < 500) break
    }
    // Para abrir el acta sin red la proxima vez, lo confirmado queda cifrado en este navegador.
    const foto = await cifrarFoto(this.c, this.doc.confirmadosComoValores(), this.doc.secuencia)
    await this.bandeja.guardarFoto(this.c.actaId, toBinary(EncryptedBlobSchema, foto))
  }
}
