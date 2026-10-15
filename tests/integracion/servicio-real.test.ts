// @vitest-environment node
import { createClient } from '@connectrpc/connect'
import { describe, expect, it } from 'vitest'
import { HealthState, ServiceStatusService } from '@/gen/actaflow/system/v1/service_status_pb'
import { crearTransporte } from '@/lib/rpc/clientes'

/**
 * Prueba OPCIONAL contra un servicio real (Java o Python), para comprobar la interoperabilidad
 * entre lenguajes. Solo corre si se definen estas variables, por ejemplo en PowerShell:
 *
 *   $env:ACTAFLOW_IT_URL="http://localhost:9098"; $env:ACTAFLOW_IT_TRANSPORT="grpc-web"
 *   $env:ACTAFLOW_IT_SECRET="<el secreto del par>"; npx vitest run tests/integracion
 */
const url = process.env.ACTAFLOW_IT_URL
const secreto = process.env.ACTAFLOW_IT_SECRET
const transporte = process.env.ACTAFLOW_IT_TRANSPORT === 'grpc' ? 'grpc' : 'grpc-web'

describe.skipIf(!url || !secreto)(`servicio real por ${transporte}`, () => {
  it('responde GetServiceStatus con la firma del BFF', async () => {
    const cliente = createClient(ServiceStatusService, crearTransporte(transporte, url ?? '', secreto ?? ''))
    const respuesta = await cliente.getServiceStatus({}, { timeoutMs: 60_000 })
    expect(respuesta.status?.serviceName).toBeTruthy()
    expect(respuesta.status?.state).not.toBe(HealthState.UNSPECIFIED)
    console.warn(`${respuesta.status?.serviceName} ${respuesta.status?.version}: estado ${respuesta.status?.state}`)
  })
})
