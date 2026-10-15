import { describe, expect, it } from 'vitest'
import { HealthState, Transport } from '@/gen/actaflow/system/v1/service_status_pb'
import { construirVista, estadoCapa, nombreTransporte, type ResultadoServicio } from '@/lib/estado/modelo'
import { estadoExpedientes, estadoIdentidad } from '../soporte/datos'

const AHORA = new Date('2026-10-06T15:00:00Z')
const ok = (estado = estadoIdentidad()): ResultadoServicio => ({ tipo: 'respondio', estado, latenciaMs: 90 })
const caido: ResultadoServicio = { tipo: 'fallo', motivo: 'No respondió' }

describe('construirVista', () => {
  it('con todo respondiendo bien, las cinco capas estan operativas', () => {
    const vista = construirVista(ok(), ok(estadoExpedientes()), 'abc1234', AHORA)
    expect(vista.general).toBe('OK')
    expect(vista.capas.map((c) => c.id)).toEqual(['frontend', 'identidad', 'expedientes', 'baseDatos', 'motorIa'])
    expect(vista.verificadoEn).toBe('2026-10-06T15:00:00.000Z')
    const identidad = vista.capas[1]
    expect(identidad).toMatchObject({ estado: 'OK', latenciaMs: 90, version: '0.2.0', transporte: 'gRPC-Web (HTTP/1.1)' })
  })

  it('la base de datos resume los esquemas de los dos servicios', () => {
    const base = construirVista(ok(), ok(estadoExpedientes()), null, AHORA).capas[3]
    expect(base?.detalle).toBe('PostgreSQL responde; esquema identity v1 · PostgreSQL responde; esquema legal_case v2')
    expect(base?.latenciaMs).toBe(30)
  })

  it('el motor muestra lo que dice de si mismo y por donde le llegaron', () => {
    const motor = construirVista(ok(), ok(estadoExpedientes(HealthState.DEGRADED)), null, AHORA).capas[4]
    expect(motor).toMatchObject({
      estado: 'DEGRADADO',
      detalle: 'Modelo de voz tiny no instalado',
      transporte: 'gRPC (HTTP/2)',
    })
  })

  it('si expedientes no responde, el motor queda desconocido y la base solo a medias', () => {
    const vista = construirVista(ok(), caido, null, AHORA)
    expect(vista.general).toBe('DEGRADADO')
    expect(vista.capas[2]).toMatchObject({ estado: 'CAIDO', detalle: 'No respondió' })
    expect(vista.capas[3]?.estado).toBe('DESCONOCIDO')
    expect(vista.capas[4]?.estado).toBe('DESCONOCIDO')
  })

  it('sin ningun servicio la base de datos es desconocida', () => {
    expect(construirVista(caido, caido, null, AHORA).capas[3]?.estado).toBe('DESCONOCIDO')
  })

  it('traduce todos los valores de los enums del contrato', () => {
    expect([HealthState.UNSPECIFIED, HealthState.OK, HealthState.DEGRADED, HealthState.DOWN].map(estadoCapa)).toEqual([
      'DESCONOCIDO',
      'OK',
      'DEGRADADO',
      'CAIDO',
    ])
    expect(nombreTransporte(Transport.UNSPECIFIED)).toBeNull()
  })
})
