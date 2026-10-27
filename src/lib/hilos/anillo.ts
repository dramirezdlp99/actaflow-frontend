/**
 * Anillo de audio en memoria COMPARTIDA (SharedArrayBuffer) entre dos hilos:
 *
 *   AudioWorklet (hilo de audio) ──escribe──► [ anillo ] ──lee──► Web Worker (procesa y sella)
 *
 * Un solo escritor y un solo lector, sin locks: cada uno solo mueve SU indice y lo publica con
 * Atomics.store; el otro lo lee con Atomics.load. Asi el audio nunca pasa por el hilo principal
 * ni se copia en mensajes (postMessage), que es la alternativa cuando no hay crossOriginIsolated.
 *
 * Distribucion (la misma en public/worklets/captura-audio.js, que es JavaScript plano):
 *   Int32Array(CONTROL) al inicio: [ESCRITURA, LECTURA, PERDIDAS, DETENER]
 *   Float32Array(capacidad) despues: las muestras
 */

export const CONTROL = 4
export const ESCRITURA = 0
export const LECTURA = 1
export const PERDIDAS = 2
export const DETENER = 3

export class AnilloAudio {
  readonly control: Int32Array
  readonly datos: Float32Array

  constructor(
    readonly memoria: SharedArrayBuffer,
    readonly capacidad = (memoria.byteLength - CONTROL * 4) / 4,
  ) {
    this.control = new Int32Array(memoria, 0, CONTROL)
    this.datos = new Float32Array(memoria, CONTROL * 4, capacidad)
  }

  static crear(capacidad: number): AnilloAudio {
    return new AnilloAudio(new SharedArrayBuffer(CONTROL * 4 + capacidad * 4), capacidad)
  }

  /** Lado del escritor (en produccion lo hace el worklet). Lo que no cabe se cuenta como perdido. */
  escribir(muestras: Float32Array): number {
    const w = Atomics.load(this.control, ESCRITURA)
    const r = Atomics.load(this.control, LECTURA)
    const libres = (r - w - 1 + this.capacidad) % this.capacidad
    const n = Math.min(libres, muestras.length)
    for (let i = 0; i < n; i += 1) {
      this.datos[(w + i) % this.capacidad] = muestras[i] ?? 0
    }
    if (n < muestras.length) {
      Atomics.add(this.control, PERDIDAS, muestras.length - n)
    }
    Atomics.store(this.control, ESCRITURA, (w + n) % this.capacidad)
    return n
  }

  /** Lado del lector: todo lo disponible desde la ultima lectura. */
  leer(): Float32Array {
    const w = Atomics.load(this.control, ESCRITURA)
    const r = Atomics.load(this.control, LECTURA)
    const disponibles = (w - r + this.capacidad) % this.capacidad
    const salida = new Float32Array(disponibles)
    for (let i = 0; i < disponibles; i += 1) {
      salida[i] = this.datos[(r + i) % this.capacidad] ?? 0
    }
    Atomics.store(this.control, LECTURA, (r + disponibles) % this.capacidad)
    return salida
  }

  get perdidas(): number {
    return Atomics.load(this.control, PERDIDAS)
  }

  /** Cualquier hilo puede pedir que se detenga; el escritor deja de escribir. */
  detener(): void {
    Atomics.store(this.control, DETENER, 1)
  }

  get detenido(): boolean {
    return Atomics.load(this.control, DETENER) === 1
  }
}
