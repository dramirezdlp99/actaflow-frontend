import { describe, expect, it, vi } from 'vitest'
import { vistaSinBackend } from '@/lib/estado/modelo'

vi.mock('@/lib/estado/obtenerEstado', () => ({
  obtenerEstado: vi.fn(async () => vistaSinBackend('prueba', null, new Date('2026-10-06T15:00:00Z'))),
}))

describe('GET /api/estado (Route Handler del BFF)', () => {
  it('devuelve la vista en JSON y sin cache', async () => {
    const { GET } = await import('@/app/api/estado/route')
    const respuesta = await GET()

    expect(respuesta.status).toBe(200)
    expect(respuesta.headers.get('cache-control')).toBe('no-store')
    const cuerpo = await respuesta.json()
    expect(cuerpo.capas).toHaveLength(4)
    expect(JSON.stringify(cuerpo)).not.toContain('backend.prueba')
  })
})
