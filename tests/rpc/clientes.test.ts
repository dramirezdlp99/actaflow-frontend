import { Code, ConnectError } from '@connectrpc/connect'
import { describe, expect, it, vi } from 'vitest'
import { HealthState } from '@/gen/actaflow/system/v1/service_status_pb'
import { conDespertar, crearClientes, esperaEntreIntentos, ServicioNoDisponibleError } from '@/lib/rpc/clientes'
import { relojFalso } from '../soporte/datos'

describe('conDespertar', () => {
  it('reintenta mientras el servicio despierta y devuelve la respuesta', async () => {
    const llamada = vi
      .fn<(timeoutMs: number) => Promise<string>>()
      .mockRejectedValueOnce(new ConnectError('dormido', Code.Unavailable))
      .mockRejectedValueOnce(new ConnectError('lento', Code.DeadlineExceeded))
      .mockResolvedValue('listo')
    await expect(conDespertar(llamada, 120_000, relojFalso())).resolves.toBe('listo')
    expect(llamada).toHaveBeenCalledTimes(3)
    expect(llamada.mock.calls[0]?.[0]).toBe(30_000)
  })

  it('no repite errores definitivos como una firma rechazada', async () => {
    const llamada = vi.fn(async () => {
      throw new ConnectError('no', Code.Unauthenticated)
    })
    await expect(conDespertar(llamada, 120_000, relojFalso())).rejects.toMatchObject({ code: Code.Unauthenticated })
    expect(llamada).toHaveBeenCalledTimes(1)
  })

  it('se rinde al agotar la espera maxima', async () => {
    const reloj = relojFalso()
    const llamada = vi.fn(async () => {
      reloj.avanzar(30_000)
      throw new ConnectError('dormido', Code.Unavailable)
    })
    await expect(conDespertar(llamada, 60_000, reloj)).rejects.toBeInstanceOf(ServicioNoDisponibleError)
  })

  it('la espera entre intentos crece con tope', () => {
    expect([1, 2, 3, 10].map(esperaEntreIntentos)).toEqual([2_000, 3_000, 4_500, 10_000])
  })
})

describe('modo mock (Contract-First)', () => {
  it('los mocks responden mensajes del contrato sin ningun servicio levantado', async () => {
    const clientes = crearClientes({ modo: 'mock', esperaMaxMs: 1_000 })
    const identidad = await clientes.identidad.estado.getServiceStatus({})
    const expedientes = await clientes.expedientes.estado.getServiceStatus({})
    expect(identidad.status?.serviceName).toBe('identity-service')
    expect(expedientes.status?.components.map((c) => c.id)).toEqual(['database', 'ai-engine'])
    expect(expedientes.status?.components[1]?.nested?.state).toBe(HealthState.OK)
  })
})
