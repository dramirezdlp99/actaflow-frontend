/**
 * Experimento "bloquear y desbloquear": el hilo principal queda atrapado en un ciclo sincrono (nada
 * se pinta y ningun clic se atiende) y lo libera OTRO hilo escribiendo en memoria compartida:
 *
 *   hilo principal:  while (Atomics.load(bandera) === 0) { ...trabajo... }   ← bloqueado
 *   Web Worker:      Atomics.store(bandera, 1)                               ← lo desbloquea
 *
 * El Worker escribe la bandera cuando le llega una peticion: desde otra pestana (BroadcastChannel),
 * o sola, a los N segundos. Asi se desbloquea sin cerrar la pestana ni el navegador. Un tope de
 * seguridad libera el hilo pase lo que pase.
 */

export const CANAL_DESBLOQUEO = 'actaflow-desbloqueo'
export const TOPE_SEGURIDAD_MS = 30_000

export type Liberado = 'otra-pestana' | 'automatico' | 'tope'

export type MensajeAlBloqueo =
  | { tipo: 'preparar'; memoria: SharedArrayBuffer }
  | { tipo: 'auto'; ms: number }
  | { tipo: 'primos'; hasta: number }

export type MensajeDelBloqueo = { tipo: 'listo' } | { tipo: 'primos'; cantidad: number; ms: number }

/** Bandera en memoria compartida: [0] = 0 bloqueado, 1 liberado; [1] = quien lo libero. */
export const QUIEN: Record<Liberado, number> = { 'otra-pestana': 1, automatico: 2, tope: 3 }

export function crearBandera(): Int32Array<SharedArrayBuffer> {
  return new Int32Array(new SharedArrayBuffer(8))
}

export function liberar(bandera: Int32Array, quien: Liberado): void {
  Atomics.store(bandera, 1, QUIEN[quien])
  Atomics.store(bandera, 0, 1)
  Atomics.notify(bandera, 0)
}

/**
 * Bloquea el hilo que la llama hasta que otro hilo escriba la bandera (o se cumpla el tope).
 * `trabajar` simula trabajo pesado en cada vuelta. Devuelve cuanto duro y quien lo libero.
 */
export function bloquearHasta(
  bandera: Int32Array,
  ahora: () => number,
  tope = TOPE_SEGURIDAD_MS,
  trabajar: () => void = () => {},
): { ms: number; por: Liberado } {
  Atomics.store(bandera, 0, 0)
  Atomics.store(bandera, 1, 0)
  const inicio = ahora()
  while (Atomics.load(bandera, 0) === 0) {
    trabajar()
    if (ahora() - inicio >= tope) {
      liberar(bandera, 'tope')
    }
  }
  const quien = Atomics.load(bandera, 1)
  const por: Liberado = quien === QUIEN['otra-pestana'] ? 'otra-pestana' : quien === QUIEN.automatico ? 'automatico' : 'tope'
  return { ms: ahora() - inicio, por }
}

/** Trabajo de CPU de verdad (criba de primos), para comparar hilo principal contra Worker. */
export function contarPrimos(hasta: number): number {
  const compuesto = new Uint8Array(hasta + 1)
  let cantidad = 0
  for (let i = 2; i <= hasta; i += 1) {
    if (compuesto[i]) continue
    cantidad += 1
    for (let j = i * i; j <= hasta; j += i) compuesto[j] = 1
  }
  return cantidad
}

/** Lo que hace el Worker del experimento (se prueba en Node sin un Worker real). */
export class HiloBloqueo {
  private bandera: Int32Array | null = null
  private temporizador: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly publicar: (m: MensajeDelBloqueo) => void,
    private readonly ahora: () => number = () => performance.now(),
  ) {}

  recibir(m: MensajeAlBloqueo): void {
    if (m.tipo === 'preparar') {
      this.bandera = new Int32Array(m.memoria)
      this.publicar({ tipo: 'listo' })
    } else if (m.tipo === 'auto') {
      if (this.temporizador) clearTimeout(this.temporizador)
      this.temporizador = setTimeout(() => this.desbloquear('automatico'), m.ms)
    } else {
      const inicio = this.ahora()
      const cantidad = contarPrimos(m.hasta)
      this.publicar({ tipo: 'primos', cantidad, ms: this.ahora() - inicio })
    }
  }

  /** La "otra peticion": llega por BroadcastChannel desde otra pestana, o del temporizador. */
  desbloquear(quien: Liberado): void {
    if (this.bandera) liberar(this.bandera, quien)
  }
}
