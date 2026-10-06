import { describe, expect, it } from 'vitest'
import { esRespuestaEstado, vistaDesdeBackend, vistaSinBackend } from '@/lib/estado/modelo'
import { respuestaEstadoOk } from '../soporte/datos'

describe('modelo de la pagina de estado', () => {
  it('valida la respuesta real del backend', () => {
    expect(esRespuestaEstado(respuestaEstadoOk())).toBe(true)
  })

  it.each([
    ['null', null],
    ['otro servicio', { ...respuestaEstadoOk(), servicio: 'otro' }],
    ['estado desconocido', { ...respuestaEstadoOk(), estado: 'ROTO' }],
    ['sin componentes', { ...respuestaEstadoOk(), componentes: undefined }],
    [
      'componente sin latencia',
      {
        ...respuestaEstadoOk(),
        componentes: { ...respuestaEstadoOk().componentes, motorIa: { estado: 'OK', detalle: null, version: null } },
      },
    ],
    ['un arreglo', []],
  ])('rechaza respuestas mal formadas: %s', (_nombre, valor) => {
    expect(esRespuestaEstado(valor)).toBe(false)
  })

  it('con el backend OK muestra las cuatro capas operativas', () => {
    const vista = vistaDesdeBackend(respuestaEstadoOk(), 230, 'abc1234')

    expect(vista.general).toBe('OK')
    expect(vista.capas.map((c) => [c.id, c.estado])).toEqual([
      ['frontend', 'OK'],
      ['backend', 'OK'],
      ['baseDatos', 'OK'],
      ['motorIa', 'OK'],
    ])
    expect(vista.capas[0]?.version).toBe('abc1234')
    expect(vista.capas[1]?.latenciaMs).toBe(230)
    expect(vista.verificadoEn).toBe('2026-10-06T15:00:00Z')
  })

  it('un motor caido degrada el sistema y conserva su detalle', () => {
    const respuesta = respuestaEstadoOk()
    respuesta.estado = 'DEGRADADO'
    respuesta.componentes.motorIa = {
      estado: 'CAIDO',
      latenciaMs: 7000,
      detalle: 'Sin respuesta en 7 s (puede estar despertando)',
      version: null,
    }

    const vista = vistaDesdeBackend(respuesta, 100, null)

    expect(vista.general).toBe('DEGRADADO')
    const motor = vista.capas.find((c) => c.id === 'motorIa')
    expect(motor?.estado).toBe('CAIDO')
    expect(motor?.detalle).toContain('despertando')
  })

  it('sin backend, las capas que dependen de el quedan desconocidas', () => {
    const vista = vistaSinBackend('No respondio', null, new Date('2026-10-06T15:00:00Z'))

    expect(vista.general).toBe('DEGRADADO')
    expect(vista.capas.map((c) => c.estado)).toEqual(['OK', 'CAIDO', 'DESCONOCIDO', 'DESCONOCIDO'])
    expect(vista.verificadoEn).toBe('2026-10-06T15:00:00.000Z')
  })
})
