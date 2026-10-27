'use client'

import { agrupar, type EntradaEvento, type Interaccion } from './inp'

/**
 * Medidor de INP de TODA la app: escucha las entradas de Event Timing del navegador en cada pagina
 * (lo monta el layout) y guarda las interacciones de la sesion en sessionStorage, para que
 * /rendimiento muestre el INP global y el de cada pagina con sus tres fases.
 */

const CLAVE = 'actaflow-inp'
const MAXIMO = 300

let interacciones: Interaccion[] = leer()
const oyentes = new Set<() => void>()
let iniciado = false

function esInteraccion(x: unknown): x is Interaccion {
  return typeof x === 'object' && x !== null && typeof Reflect.get(x, 'total') === 'number' && typeof Reflect.get(x, 'ruta') === 'string'
}

function leer(): Interaccion[] {
  try {
    const crudo: unknown = JSON.parse(globalThis.sessionStorage?.getItem(CLAVE) ?? '[]')
    return Array.isArray(crudo) ? crudo.filter(esInteraccion) : []
  } catch {
    return []
  }
}

function guardar() {
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify(interacciones))
  } catch {
    // Sin almacenamiento (modo privado estricto): se mide igual, solo que no sobrevive a recargar.
  }
}

export function eventTimingSoportado(): boolean {
  return (
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes.includes('event') &&
    typeof PerformanceEventTiming !== 'undefined' &&
    'interactionId' in PerformanceEventTiming.prototype
  )
}

function describir(objetivo: unknown): { objetivo: string; experimento: boolean } {
  if (!(objetivo instanceof Element)) return { objetivo: '(elemento ya no existe)', experimento: false }
  const texto = (objetivo.getAttribute('aria-label') ?? objetivo.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)
  return {
    objetivo: `${objetivo.tagName.toLowerCase()}${texto ? `: ${texto}` : ''}`,
    experimento: objetivo.closest('[data-experimento]') !== null,
  }
}

export function iniciarMedidor(): void {
  if (iniciado || !eventTimingSoportado()) return
  iniciado = true
  const observador = new PerformanceObserver((lista) => {
    const objetivos = new Map<EntradaEvento, unknown>()
    const entradas: EntradaEvento[] = []
    for (const e of lista.getEntries()) {
      const interactionId: unknown = Reflect.get(e, 'interactionId')
      if (!(e instanceof PerformanceEventTiming) || typeof interactionId !== 'number' || interactionId === 0) continue
      const entrada: EntradaEvento = {
        name: e.name,
        interactionId,
        startTime: e.startTime,
        processingStart: e.processingStart,
        processingEnd: e.processingEnd,
        duration: e.duration,
      }
      objetivos.set(entrada, e.target)
      entradas.push(entrada)
    }
    if (entradas.length === 0) return
    const ruta = location.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '[id]')
    const nuevas = agrupar(entradas, (e) => ({ ruta, ...describir(objetivos.get(e)) }))
    const porId = new Map(interacciones.map((i) => [`${i.ruta}|${i.id}|${i.inicio}`, i]))
    for (const n of nuevas) {
      const clave = `${n.ruta}|${n.id}|${n.inicio}`
      const previa = porId.get(clave)
      if (!previa || n.total > previa.total) porId.set(clave, n)
    }
    interacciones = [...porId.values()].slice(-MAXIMO)
    guardar()
    for (const o of oyentes) o()
  })
  // 16 ms es el minimo que acepta el navegador: asi entran tambien las interacciones rapidas.
  const opciones = { type: 'event', buffered: true, durationThreshold: 16 }
  observador.observe(opciones)
}

export function suscribirMedidor(oyente: () => void): () => void {
  oyentes.add(oyente)
  return () => oyentes.delete(oyente)
}

export function interaccionesMedidas(): Interaccion[] {
  return interacciones
}

const VACIO: Interaccion[] = []
export const interaccionesServidor = () => VACIO

export function reiniciarMedidor(): void {
  interacciones = []
  guardar()
  for (const o of oyentes) o()
}
