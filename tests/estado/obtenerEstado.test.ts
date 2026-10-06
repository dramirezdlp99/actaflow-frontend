import { afterEach, describe, expect, it, vi } from 'vitest'
import { obtenerEstado } from '@/lib/estado/obtenerEstado'
import { CONFIG_PRUEBA, relojFalso, respuestaEstadoOk, respuestaJson } from '../soporte/datos'

function deps(...respuestas: Array<Response | Error>) {
  const cola = [...respuestas]
  const fetchFalso = vi.fn(async () => {
    const r = cola.shift()
    if (!r) throw new Error('sin mas respuestas')
    if (r instanceof Error) throw r
    return r
  })
  return { fetch: fetchFalso as unknown as typeof fetch, configuracion: CONFIG_PRUEBA, ...relojFalso() }
}

describe('obtenerEstado', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('con el backend respondiendo devuelve la vista completa', async () => {
    const vista = await obtenerEstado(deps(respuestaJson(respuestaEstadoOk())))
    expect(vista.general).toBe('OK')
    expect(vista.capas).toHaveLength(4)
  })

  it('usa el commit de Vercel como version del frontend', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '0123456789abcdef')
    const vista = await obtenerEstado(deps(respuestaJson(respuestaEstadoOk())))
    expect(vista.capas[0]?.version).toBe('0123456')
  })

  it('una firma rechazada se explica para poder corregir la configuracion', async () => {
    const vista = await obtenerEstado(deps(respuestaJson({ codigo: 'firma_invalida' }, 401)))
    const backend = vista.capas.find((c) => c.id === 'backend')
    expect(backend?.estado).toBe('CAIDO')
    expect(backend?.detalle).toContain('ACTAFLOW_BFF_HMAC_SECRET')
  })

  it('una respuesta con forma inesperada no se muestra como valida', async () => {
    const vista = await obtenerEstado(deps(respuestaJson({ hola: 'mundo' })))
    expect(vista.capas.find((c) => c.id === 'backend')?.detalle).toContain('inesperada')
  })

  it('un error HTTP del backend queda reflejado', async () => {
    const vista = await obtenerEstado(deps(respuestaJson({}, 500)))
    expect(vista.capas.find((c) => c.id === 'backend')?.detalle).toBe('El backend respondió HTTP 500')
  })

  it('si el backend no despierta a tiempo lo dice sin lanzar errores', async () => {
    const reloj = relojFalso()
    const fetchFalso = vi.fn(async () => {
      reloj.avanzar(30_000)
      throw new TypeError('fetch failed')
    })
    const vista = await obtenerEstado({
      fetch: fetchFalso as unknown as typeof fetch,
      configuracion: CONFIG_PRUEBA,
      ...reloj,
    })
    expect(vista.capas.find((c) => c.id === 'backend')?.detalle).toContain('puede estar despertando')
  })

  it('sin configuracion del BFF no revienta la pagina', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('ACTAFLOW_BACKEND_URL', '')
    const vista = await obtenerEstado()
    expect(vista.capas.find((c) => c.id === 'backend')?.detalle).toBe('El BFF no está configurado en este entorno')
  })
})
