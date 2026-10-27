/**
 * Demostracion del Event Loop: se programan trabajos de todos los tipos en un orden "desordenado" y
 * se registra el orden REAL en que corren. La regla que se ve: primero termina el codigo sincrono
 * (la pila de llamadas), despues se vacian TODAS las microtasks y recien entonces corre la siguiente
 * task. Los callbacks de animacion corren antes de pintar.
 *
 * Analogia del restaurante: el cocinero (call stack) termina el plato que tiene en la mano; el
 * encargado (event loop) le pasa primero todos los pedidos prioritarios (microtasks: promesas,
 * queueMicrotask) y solo despues el siguiente pedido normal (task: setTimeout, MessageChannel, clic).
 */

export type Clase = 'sincrono' | 'microtask' | 'task' | 'animacion'
export type Paso = { orden: number; clase: Clase; texto: string }

export type Planificador = {
  /** setTimeout(f, 0) en el navegador. */
  task: (f: () => void) => void
  /** requestAnimationFrame; null donde no exista (Node, pruebas). */
  animacion: ((f: () => void) => void) | null
}

export const PLANIFICADOR_NAVEGADOR: Planificador = {
  task: (f) => setTimeout(f, 0),
  animacion: typeof requestAnimationFrame === 'function' ? (f) => requestAnimationFrame(() => f()) : null,
}

export function recorrerEventLoop(p: Planificador = PLANIFICADOR_NAVEGADOR): Promise<Paso[]> {
  return new Promise((terminar) => {
    const pasos: Paso[] = []
    const anotar = (clase: Clase, texto: string) => pasos.push({ orden: pasos.length + 1, clase, texto })
    let pendientes = p.animacion ? 4 : 3
    const listo = () => {
      pendientes -= 1
      if (pendientes === 0) terminar(pasos)
    }

    anotar('sincrono', '1. console.log("inicio") — corre ya, en la pila')
    p.task(() => {
      anotar('task', 'setTimeout(…, 0) — una task: espera a que se vacíen las microtasks')
      Promise.resolve().then(() => {
        anotar('microtask', 'Promesa creada DENTRO de esa task — corre antes de la siguiente task')
        listo()
      })
    })
    const canal = new MessageChannel()
    canal.port1.onmessage = () => {
      anotar('task', 'MessageChannel.postMessage — otra task (suele ganarle a setTimeout, que tiene una espera mínima)')
      canal.port1.close()
      listo()
    }
    canal.port2.postMessage(null)
    p.animacion?.(() => {
      anotar('animacion', 'requestAnimationFrame — justo antes de pintar el siguiente frame')
      listo()
    })
    void Promise.resolve().then(() => {
      anotar('microtask', 'Promise.then — microtask: apenas termine el código síncrono')
      queueMicrotask(() => anotar('microtask', 'queueMicrotask dentro de una microtask — también antes de cualquier task'))
    })
    queueMicrotask(() => anotar('microtask', 'queueMicrotask — microtask, en orden de llegada'))
    anotar('sincrono', '2. console.log("fin") — el código síncrono termina antes que todo lo demás')
    listo()
  })
}
