import { Code, ConnectError, createClient, createRouterTransport } from '@connectrpc/connect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServiceStatusService, type ServiceStatus } from '@/gen/actaflow/system/v1/service_status_pb'
import { obtenerEstado } from '@/lib/estado/obtenerEstado'
import type { ClientesEstado } from '@/lib/rpc/clientes'
import { estadoExpedientes, estadoIdentidad, relojFalso } from '../soporte/datos'

type Respuesta = ServiceStatus | ConnectError

function cliente(respuesta: Respuesta) {
  return createClient(
    ServiceStatusService,
    createRouterTransport(({ service }) => {
      service(ServiceStatusService, {
        getServiceStatus: () => {
          if (respuesta instanceof ConnectError) throw respuesta
          return { status: respuesta }
        },
      })
    }),
  )
}

function clientes(identidad: Respuesta, expedientes: Respuesta): ClientesEstado {
  return { identidad: { estado: cliente(identidad) }, expedientes: { estado: cliente(expedientes) } }
}

const CONFIG = { modo: 'mock', esperaMaxMs: 60_000 } as const

describe('obtenerEstado', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('consulta los dos servicios y arma la vista completa', async () => {
    const vista = await obtenerEstado({
      configuracion: CONFIG,
      clientes: clientes(estadoIdentidad(), estadoExpedientes()),
      ...relojFalso(),
    })
    expect(vista.general).toBe('OK')
    expect(vista.capas).toHaveLength(5)
  })

  it('en modo mock funciona sin ningun microservicio', async () => {
    vi.stubEnv('ACTAFLOW_RPC_MODE', 'mock')
    const vista = await obtenerEstado()
    expect(vista.general).toBe('OK')
    expect(vista.capas.find((c) => c.id === 'motorIa')?.version).toBe('0.0.0-mock')
  })

  it('usa el commit de Vercel como version del frontend', async () => {
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '0123456789abcdef')
    const vista = await obtenerEstado({ configuracion: CONFIG, ...relojFalso() })
    expect(vista.capas[0]?.version).toBe('0123456')
  })

  it('una firma rechazada nombra la variable del par correcto', async () => {
    const vista = await obtenerEstado({
      configuracion: CONFIG,
      clientes: clientes(estadoIdentidad(), new ConnectError('no', Code.Unauthenticated)),
      ...relojFalso(),
    })
    expect(vista.capas[1]?.estado).toBe('OK')
    expect(vista.capas[2]?.detalle).toContain('ACTAFLOW_LEGAL_CASE_HMAC_SECRET')
  })

  it('un servicio que no despierta a tiempo se explica sin lanzar errores', async () => {
    const vista = await obtenerEstado({
      configuracion: CONFIG,
      clientes: clientes(new ConnectError('dormido', Code.Unavailable), estadoExpedientes()),
      ...relojFalso(),
    })
    expect(vista.capas[1]?.detalle).toContain('puede estar despertando')
  })

  it('sin configuracion del BFF no revienta la pagina', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('ACTAFLOW_RPC_MODE', '')
    vi.stubEnv('ACTAFLOW_IDENTITY_URL', '')
    const vista = await obtenerEstado()
    expect(vista.capas[1]?.detalle).toBe('El BFF no está configurado en este entorno')
  })
})
