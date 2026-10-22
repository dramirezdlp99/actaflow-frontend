/**
 * Audio de la sala, sin dependencias y sin DOM (se prueba en Node):
 *
 *   microfono (44,1 o 48 kHz) ──Remuestreador──► 16 kHz mono ──Segmentador──► intervenciones
 *   intervencion ──codificarWav──► WAV PCM de 16 bits (lo que el motor acepta en cualquier navegador)
 *
 * El Segmentador es un detector de voz por energia: corta cuando alguien deja de hablar (silencio
 * sostenido), descarta lo que no tiene voz y nunca deja pasar una intervencion de mas de 28 s (el
 * contrato admite 30). Asi cada segmento es una frase o un turno, que es lo que mejor transcribe Whisper.
 */

export const FRECUENCIA = 16_000
const MUESTRAS_POR_MS = FRECUENCIA / 1000

/** Interpolacion lineal con estado entre bloques (no hay saltos en los bordes de cada bloque). */
export class Remuestreador {
  /** Posicion de la proxima muestra de salida, contada en el bloque [ultima anterior, ...entrada]. */
  private posicion = 1
  private anterior = 0

  constructor(private readonly origen: number) {}

  procesar(entrada: Float32Array): Float32Array {
    if (this.origen === FRECUENCIA || entrada.length === 0) {
      return entrada.slice()
    }
    const paso = this.origen / FRECUENCIA
    const datos = new Float32Array(entrada.length + 1)
    datos[0] = this.anterior
    datos.set(entrada, 1)
    const salida: number[] = []
    const ultimo = datos.length - 1
    let p = this.posicion
    while (p <= ultimo) {
      const i = Math.floor(p)
      const a = datos[i] ?? 0
      const b = datos[Math.min(i + 1, ultimo)] ?? a
      salida.push(a + (b - a) * (p - i))
      p += paso
    }
    this.posicion = p - entrada.length
    this.anterior = entrada[entrada.length - 1] ?? 0
    return Float32Array.from(salida)
  }
}

export type Intervencion = { muestras: Float32Array; duracionMs: number }

export type OpcionesSegmentador = {
  /** Ventana de analisis. */
  ventanaMs?: number
  /** Silencio que cierra una intervencion. */
  silencioMs?: number
  /** Una intervencion mas corta se sigue acumulando aunque haya silencio. */
  minimoMs?: number
  /** Tope duro: se corta aunque la persona siga hablando. */
  maximoMs?: number
  /** Audio previo que se conserva para no comerse el inicio de la primera palabra. */
  previoMs?: number
  /** Menos voz que esto: se descarta (toses, golpes, ruido). */
  vozMinimaMs?: number
  /** Energia minima (RMS) para considerar voz, aunque el ruido de fondo sea muy bajo. */
  umbralMinimo?: number
}

const PREDETERMINADAS: Required<OpcionesSegmentador> = {
  ventanaMs: 30,
  silencioMs: 800,
  minimoMs: 1_500,
  maximoMs: 28_000,
  previoMs: 300,
  vozMinimaMs: 300,
  umbralMinimo: 0.012,
}

export class Segmentador {
  private readonly o: Required<OpcionesSegmentador>
  private readonly ventana: number
  private pendiente: number[] = []
  private previo: Float32Array[] = []
  private actual: Float32Array[] = []
  private largoActual = 0
  private vozMs = 0
  private silencioMs = 0
  private hablando = false
  /** Piso de ruido estimado: baja rapido y sube despacio. */
  private piso = 0.005

  constructor(opciones: OpcionesSegmentador = {}) {
    this.o = { ...PREDETERMINADAS, ...opciones }
    this.ventana = Math.round(this.o.ventanaMs * MUESTRAS_POR_MS)
  }

  /** Nivel de 0 a 1 de la ultima ventana, para el medidor de la pantalla. */
  nivel = 0

  agregar(muestras: Float32Array): Intervencion[] {
    const cortes: Intervencion[] = []
    for (const m of muestras) {
      this.pendiente.push(m)
      if (this.pendiente.length === this.ventana) {
        const corte = this.analizar(Float32Array.from(this.pendiente))
        this.pendiente = []
        if (corte) {
          cortes.push(corte)
        }
      }
    }
    return cortes
  }

  /** Al detener la grabacion: entrega lo que se estaba diciendo, si tenia voz. */
  cerrar(): Intervencion | null {
    if (this.pendiente.length > 0 && this.hablando) {
      this.actual.push(Float32Array.from(this.pendiente))
      this.largoActual += this.pendiente.length
    }
    this.pendiente = []
    return this.cortar()
  }

  private analizar(bloque: Float32Array): Intervencion | null {
    let suma = 0
    for (const m of bloque) {
      suma += m * m
    }
    const rms = Math.sqrt(suma / bloque.length)
    this.nivel = Math.min(1, rms * 8)
    const umbral = Math.max(this.o.umbralMinimo, this.piso * 3)
    const voz = rms > umbral
    if (!voz) {
      this.piso = rms < this.piso ? rms : this.piso * 0.995 + rms * 0.005
    }

    if (!this.hablando) {
      this.previo.push(bloque)
      const maxPrevio = Math.ceil(this.o.previoMs / this.o.ventanaMs)
      if (this.previo.length > maxPrevio) {
        this.previo.shift()
      }
      if (voz) {
        this.hablando = true
        this.actual = this.previo
        this.largoActual = this.previo.reduce((n, b) => n + b.length, 0)
        this.previo = []
        this.vozMs = this.o.ventanaMs
        this.silencioMs = 0
      }
      return null
    }

    this.actual.push(bloque)
    this.largoActual += bloque.length
    if (voz) {
      this.vozMs += this.o.ventanaMs
      this.silencioMs = 0
    } else {
      this.silencioMs += this.o.ventanaMs
    }
    const duracion = this.largoActual / MUESTRAS_POR_MS
    if (duracion + this.o.ventanaMs > this.o.maximoMs || (this.silencioMs >= this.o.silencioMs && duracion >= this.o.minimoMs)) {
      return this.cortar()
    }
    return null
  }

  private cortar(): Intervencion | null {
    const partes = this.actual
    const conVoz = this.vozMs >= this.o.vozMinimaMs
    this.actual = []
    this.largoActual = 0
    this.vozMs = 0
    this.silencioMs = 0
    this.hablando = false
    if (!conVoz || partes.length === 0) {
      return null
    }
    const total = partes.reduce((n, b) => n + b.length, 0)
    const muestras = new Float32Array(total)
    let i = 0
    for (const b of partes) {
      muestras.set(b, i)
      i += b.length
    }
    return { muestras, duracionMs: Math.max(1, Math.round(total / MUESTRAS_POR_MS)) }
  }
}

/** WAV RIFF mono PCM de 16 bits. */
export function codificarWav(muestras: Float32Array, frecuencia = FRECUENCIA): Uint8Array {
  const datos = muestras.length * 2
  const salida = new Uint8Array(44 + datos)
  const v = new DataView(salida.buffer)
  const ascii = (desde: number, texto: string) => {
    for (let i = 0; i < texto.length; i += 1) {
      v.setUint8(desde + i, texto.charCodeAt(i))
    }
  }
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + datos, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, frecuencia, true)
  v.setUint32(28, frecuencia * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  ascii(36, 'data')
  v.setUint32(40, datos, true)
  for (let i = 0; i < muestras.length; i += 1) {
    const m = Math.max(-1, Math.min(1, muestras[i] ?? 0))
    v.setInt16(44 + i * 2, m < 0 ? m * 0x8000 : m * 0x7fff, true)
  }
  return salida
}
