// @vitest-environment node
import { Worker } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import { bloquearHasta, contarPrimos, crearBandera, HiloBloqueo, type MensajeDelBloqueo } from '@/lib/rendimiento/bloqueo'
import { recorrerEventLoop } from '@/lib/rendimiento/eventLoop'
import { agrupar, calificar, fases, inp, type EntradaEvento } from '@/lib/rendimiento/inp'

const entrada = (id: number, inicio: number, cola: number, proceso: number, total: number, name = 'click'): EntradaEvento => ({
  name,
  interactionId: id,
  startTime: inicio,
  processingStart: inicio + cola,
  processingEnd: inicio + cola + proceso,
  duration: total,
})

describe('INP', () => {
  it('separa las tres fases: input delay + processing + presentation = total', () => {
    expect(fases(entrada(1, 100, 30, 50, 120))).toEqual({ retraso: 30, procesamiento: 50, presentacion: 40, total: 120 })
  })

  it('una interaccion con varios eventos cuenta una vez: dura lo del mas largo y las fases suman todos', () => {
    const r = agrupar(
      [entrada(7, 0, 5, 5, 40, 'pointerdown'), entrada(7, 2, 5, 60, 96, 'click'), entrada(0, 3, 1, 1, 400, 'mousemove'), entrada(8, 500, 2, 2, 24)],
      () => ({ ruta: '/x', objetivo: 'button', experimento: false }),
    )
    expect(r.map((i) => [i.id, i.evento, i.total])).toEqual([
      [7, 'click', 96],
      [8, 'click', 24],
    ])
    // pointerdown empezo a procesar en 5 y click termino en 67: 62 ms de processing, no los 60 de un solo evento.
    expect(r[0]).toMatchObject({ retraso: 3, procesamiento: 62, presentacion: 31 })
  })

  it('el INP es la peor interaccion, ignorando una de cada 50 (p98), y se califica con los umbrales de Google', () => {
    expect(inp([])).toBeNull()
    expect(inp([{ total: 80 }, { total: 140 }, { total: 30 }])).toBe(140)
    const muchas = [...Array.from({ length: 99 }, () => ({ total: 50 })), { total: 900 }]
    expect(inp(muchas), 'una sola interaccion rara entre 100 no decide el INP').toBe(50)
    expect([calificar(150), calificar(350), calificar(800)]).toEqual(['bueno', 'mejorable', 'pobre'])
  })
})

describe('Event Loop', () => {
  it('primero la pila, luego TODAS las microtasks, despues las tasks (y la microtask de una task antes de la siguiente)', async () => {
    const pasos = await recorrerEventLoop({ task: (f) => setTimeout(f, 0), animacion: null })
    const clases = pasos.map((p) => p.clase)
    expect(clases.slice(0, 2)).toEqual(['sincrono', 'sincrono'])
    expect(clases.slice(2, 5)).toEqual(['microtask', 'microtask', 'microtask'])
    expect(clases.slice(5).filter((c) => c === 'task')).toHaveLength(2)
    const timeout = pasos.findIndex((p) => p.texto.startsWith('setTimeout'))
    expect(pasos[timeout + 1]?.texto).toMatch(/DENTRO de esa task/)
  })
})

describe('bloquear y desbloquear desde otro hilo', () => {
  it('un hilo de verdad (worker_threads) libera el ciclo escribiendo en la memoria compartida', async () => {
    const bandera = crearBandera()
    const hilo = new Worker(
      `const { workerData } = require('node:worker_threads')
       const b = new Int32Array(workerData)
       setTimeout(() => { Atomics.store(b, 1, 1); Atomics.store(b, 0, 1) }, 150)`,
      { eval: true, workerData: bandera.buffer },
    )
    await new Promise((r) => hilo.once('online', r))
    const r = bloquearHasta(bandera, () => performance.now(), 10_000)
    await hilo.terminate()
    expect(r.por).toBe('otra-pestana')
    expect(r.ms).toBeGreaterThan(50)
    expect(r.ms).toBeLessThan(5_000)
  })

  it('si nadie lo libera, el tope de seguridad lo suelta', () => {
    let t = 0
    expect(bloquearHasta(crearBandera(), () => (t += 10), 1_000).por).toBe('tope')
  })

  it('el Worker del laboratorio calcula en su hilo y desbloquea cuando se lo piden', () => {
    const mensajes: MensajeDelBloqueo[] = []
    const h = new HiloBloqueo((m) => mensajes.push(m))
    const bandera = crearBandera()
    h.recibir({ tipo: 'preparar', memoria: bandera.buffer })
    h.recibir({ tipo: 'primos', hasta: 100 })
    expect(mensajes[1]).toMatchObject({ tipo: 'primos', cantidad: 25 })
    h.desbloquear('automatico')
    expect([Atomics.load(bandera, 0), Atomics.load(bandera, 1)]).toEqual([1, 2])
    expect(contarPrimos(1_000_000)).toBe(78_498)
  })
})
