import { describe, expect, it, vi } from 'vitest'
import { BackendNoDisponibleError, esperaEntreIntentos, llamarBackend } from '@/lib/bff/cliente'
import { CABECERA_FIRMA, CABECERA_TIMESTAMP, firmar } from '@/lib/bff/firma'
import { CONFIG_PRUEBA, relojFalso, respuestaJson, SECRETO_PRUEBA } from '../soporte/datos'

type LlamadaFetch = [string, RequestInit]

function crearFetch(...respuestas: Array<Response | Error>) {
  const cola = [...respuestas]
  return vi.fn(async (_url: string, _init: RequestInit) => {
    const siguiente = cola.shift()
    if (!siguiente) throw new Error('fetch llamado mas veces de lo esperado')
    if (siguiente instanceof Error) throw siguiente
    return siguiente
  })
}

function dependencias(fetchFalso: ReturnType<typeof crearFetch>, reloj = relojFalso()) {
  return { fetch: fetchFalso as unknown as typeof fetch, configuracion: CONFIG_PRUEBA, ...reloj }
}

describe('llamarBackend', () => {
  it('firma la peticion con HMAC y usa la URL real solo en el servidor', async () => {
    const fetchFalso = crearFetch(respuestaJson({ ok: true }))
    const resultado = await llamarBackend('/api/v1/status', {}, dependencias(fetchFalso))

    expect(resultado).toEqual({ estado: 200, datos: { ok: true }, intentos: 1 })
    const [url, init] = fetchFalso.mock.calls[0] as LlamadaFetch
    expect(url).toBe('https://backend.prueba/api/v1/status')
    const cabeceras = init.headers as Record<string, string>
    const ts = cabeceras[CABECERA_TIMESTAMP] as string
    expect(cabeceras[CABECERA_FIRMA]).toBe(firmar(SECRETO_PRUEBA, ts, 'GET', '/api/v1/status', new Uint8Array()))
    expect(init.cache).toBe('no-store')
  })

  it('firma tambien el cuerpo de un POST', async () => {
    const fetchFalso = crearFetch(respuestaJson({ creado: true }, 201))
    await llamarBackend('/api/v1/algo', { metodo: 'POST', cuerpo: { a: 1 } }, dependencias(fetchFalso))

    const [, init] = fetchFalso.mock.calls[0] as LlamadaFetch
    const cabeceras = init.headers as Record<string, string>
    const cuerpo = new TextEncoder().encode('{"a":1}')
    expect(cabeceras['Content-Type']).toBe('application/json')
    expect(cabeceras[CABECERA_FIRMA]).toBe(
      firmar(SECRETO_PRUEBA, cabeceras[CABECERA_TIMESTAMP] as string, 'POST', '/api/v1/algo', cuerpo),
    )
  })

  it('espera a un backend dormido: reintenta errores de red y 503 hasta que responde', async () => {
    const fetchFalso = crearFetch(new TypeError('fetch failed'), respuestaJson({}, 503), respuestaJson({ ok: 1 }))
    const resultado = await llamarBackend('/api/v1/status', {}, dependencias(fetchFalso))

    expect(resultado.estado).toBe(200)
    expect(resultado.intentos).toBe(3)
  })

  it('se rinde al superar la espera maxima', async () => {
    const reloj = relojFalso()
    const fetchFalso = vi.fn(async () => {
      reloj.avanzar(30_000) // cada intento agota su tiempo
      throw new DOMException('timeout', 'TimeoutError')
    })
    const promesa = llamarBackend('/api/v1/status', {}, { ...dependencias(crearFetch(), reloj), fetch: fetchFalso })

    await expect(promesa).rejects.toBeInstanceOf(BackendNoDisponibleError)
    expect(fetchFalso.mock.calls.length).toBeGreaterThan(1)
    expect(fetchFalso.mock.calls.length).toBeLessThanOrEqual(5)
  })

  it('no reintenta respuestas definitivas como 401 o 404', async () => {
    for (const estado of [401, 404]) {
      const fetchFalso = crearFetch(respuestaJson({ codigo: 'x' }, estado))
      const resultado = await llamarBackend('/api/v1/status', {}, dependencias(fetchFalso))
      expect(resultado.estado).toBe(estado)
      expect(fetchFalso).toHaveBeenCalledTimes(1)
    }
  })

  it('no reintenta un POST no idempotente para no duplicar operaciones', async () => {
    const fetchFalso = crearFetch(respuestaJson({}, 503))
    const resultado = await llamarBackend('/api/v1/algo', { metodo: 'POST', cuerpo: {} }, dependencias(fetchFalso))
    expect(resultado.estado).toBe(503)
    expect(fetchFalso).toHaveBeenCalledTimes(1)

    const conError = crearFetch(new TypeError('fetch failed'))
    await expect(llamarBackend('/api/v1/algo', { metodo: 'POST' }, dependencias(conError))).rejects.toThrow(TypeError)
  })

  it('si reintenta un POST marcado como idempotente', async () => {
    const fetchFalso = crearFetch(respuestaJson({}, 502), respuestaJson({ ok: 1 }))
    const resultado = await llamarBackend(
      '/api/v1/algo',
      { metodo: 'POST', cuerpo: {}, idempotente: true },
      dependencias(fetchFalso),
    )
    expect(resultado.intentos).toBe(2)
  })

  it('solo permite rutas /api/ del backend', async () => {
    await expect(llamarBackend('/actuator/health', {}, dependencias(crearFetch()))).rejects.toThrow('/api/')
  })

  it('devuelve datos nulos si la respuesta no es JSON', async () => {
    const fetchFalso = crearFetch(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    expect((await llamarBackend('/api/v1/status', {}, dependencias(fetchFalso))).datos).toBeNull()
  })

  it('la espera entre intentos crece y tiene tope', () => {
    expect(esperaEntreIntentos(1)).toBe(2_000)
    expect(esperaEntreIntentos(2)).toBe(3_000)
    expect(esperaEntreIntentos(20)).toBe(10_000)
  })
})
