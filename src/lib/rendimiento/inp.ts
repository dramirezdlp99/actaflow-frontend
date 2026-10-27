/**
 * INP (Interaction to Next Paint) a partir de las entradas de Event Timing del navegador.
 *
 *   |──input delay──|──processing──|──presentation──|
 *   startTime   processingStart processingEnd   startTime + duration (siguiente pintado)
 *
 * - Input delay: lo que la interaccion espera en cola porque el hilo principal estaba ocupado.
 * - Processing: lo que tardan los manejadores de eventos (nuestro JavaScript).
 * - Presentation: estilo, layout, paint y composite hasta que se ve el resultado.
 *
 * Una interaccion (un clic, una tecla) puede disparar varios eventos (pointerdown, pointerup,
 * click): todos comparten interactionId y cuenta el mas largo. El INP de la pagina es la peor
 * interaccion, ignorando una de cada 50 (percentil 98), como lo calcula Google.
 * Umbrales: bueno < 200 ms, necesita mejorar 200 a 500 ms, pobre > 500 ms.
 */

export type EntradaEvento = {
  name: string
  interactionId: number
  startTime: number
  processingStart: number
  processingEnd: number
  duration: number
}

export type Interaccion = {
  id: number
  evento: string
  /** Pagina donde ocurrio (para el INP de toda la app). */
  ruta: string
  /** Elemento, para mostrar algo legible ("button: Guardar revision"). */
  objetivo: string
  /** Las interacciones del experimento de bloqueo no cuentan para el INP de la app. */
  experimento: boolean
  inicio: number
  retraso: number
  procesamiento: number
  presentacion: number
  total: number
}

export const UMBRAL_BUENO = 200
export const UMBRAL_POBRE = 500

export type Calificacion = 'bueno' | 'mejorable' | 'pobre'

export function calificar(ms: number): Calificacion {
  if (ms < UMBRAL_BUENO) return 'bueno'
  if (ms <= UMBRAL_POBRE) return 'mejorable'
  return 'pobre'
}

export function fases(e: EntradaEvento) {
  const retraso = Math.max(0, e.processingStart - e.startTime)
  const procesamiento = Math.max(0, e.processingEnd - e.processingStart)
  const presentacion = Math.max(0, e.startTime + e.duration - e.processingEnd)
  return { retraso, procesamiento, presentacion, total: e.duration }
}

/**
 * Agrupa por interactionId. La duracion es la del evento mas largo; las fases se arman con TODOS los
 * eventos de la interaccion (Chrome redondea cada duracion a 8 ms y reparte el trabajo entre
 * pointerdown, pointerup y click): desde el primer manejador que empezo hasta el ultimo que termino.
 */
export function agrupar(
  entradas: EntradaEvento[],
  datos: (e: EntradaEvento) => Pick<Interaccion, 'ruta' | 'objetivo' | 'experimento'>,
): Interaccion[] {
  const grupos = new Map<number, EntradaEvento[]>()
  for (const e of entradas) {
    if (!e.interactionId) continue
    grupos.set(e.interactionId, [...(grupos.get(e.interactionId) ?? []), e])
  }
  return [...grupos.values()]
    .map((g) => {
      const peor = g.reduce((a, b) => (b.duration > a.duration ? b : a))
      const desde = Math.min(...g.map((e) => e.processingStart))
      const hasta = Math.max(...g.map((e) => e.processingEnd))
      const retraso = Math.max(0, desde - peor.startTime)
      const procesamiento = Math.max(0, hasta - Math.max(desde, peor.startTime))
      return {
        id: peor.interactionId,
        evento: peor.name,
        inicio: peor.startTime,
        retraso,
        procesamiento,
        presentacion: Math.max(0, peor.duration - retraso - procesamiento),
        total: peor.duration,
        ...datos(peor),
      }
    })
    .sort((a, b) => a.inicio - b.inicio)
}

/** INP: la peor interaccion, sin contar una de cada 50 (p98). null si aun no hubo interacciones. */
export function inp(interacciones: Pick<Interaccion, 'total'>[]): number | null {
  if (interacciones.length === 0) return null
  const ordenadas = interacciones.map((i) => i.total).sort((a, b) => b - a)
  return ordenadas[Math.min(ordenadas.length - 1, Math.floor(ordenadas.length / 50))] ?? null
}
