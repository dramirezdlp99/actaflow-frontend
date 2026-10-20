import 'server-only'
import { create } from '@bufbuild/protobuf'
import { timestampNow } from '@bufbuild/protobuf/wkt'
import { createRouterTransport, type Transport } from '@connectrpc/connect'
import {
  ComponentKind,
  ComponentStatusSchema,
  HealthState,
  ServiceStatusSchema,
  ServiceStatusService,
  Transport as TransporteContrato,
} from '@/gen/actaflow/system/v1/service_status_pb'
import { registrarExpedientesSimulados } from './expedientesSimulados'
import { registrarIdentidadSimulada } from './identidadSimulada'
import { registrarPlantillasSimuladas } from './plantillasSimuladas'

/**
 * Mocks TIPADOS desde el contrato: el compilador obliga a que respondan exactamente los mensajes
 * de `actaflow-contracts`. Con ACTAFLOW_RPC_MODE=mock el frontend se desarrolla y se prueba sin
 * levantar ningun microservicio (Contract-First: los equipos trabajan en paralelo).
 */

const VERSION_MOCK = '0.0.0-mock'

function baseDatos(esquema: string) {
  return create(ComponentStatusSchema, {
    id: 'database',
    kind: ComponentKind.DATABASE,
    state: HealthState.OK,
    latencyMs: 8n,
    detail: `PostgreSQL simulado; esquema ${esquema} v1`,
    version: '1',
  })
}

export function transporteMockIdentidad(): Transport {
  return createRouterTransport((router) => {
    registrarIdentidadSimulada(router)
    router.service(ServiceStatusService, {
      getServiceStatus: () => ({
        status: create(ServiceStatusSchema, {
          serviceName: 'identity-service',
          version: VERSION_MOCK,
          state: HealthState.OK,
          checkedAt: timestampNow(),
          servedVia: TransporteContrato.UNSPECIFIED,
          components: [baseDatos('identity')],
        }),
      }),
    })
  })
}

export function transporteMockExpedientes(): Transport {
  return createRouterTransport((router) => {
    registrarExpedientesSimulados(router)
    registrarPlantillasSimuladas(router)
    router.service(ServiceStatusService, {
      getServiceStatus: () => ({
        status: create(ServiceStatusSchema, {
          serviceName: 'legal-case-service',
          version: VERSION_MOCK,
          state: HealthState.OK,
          checkedAt: timestampNow(),
          servedVia: TransporteContrato.UNSPECIFIED,
          components: [
            baseDatos('legal_case'),
            create(ComponentStatusSchema, {
              id: 'ai-engine',
              kind: ComponentKind.SERVICE,
              state: HealthState.OK,
              latencyMs: 21n,
              detail: 'ai-engine responde',
              version: VERSION_MOCK,
              nested: create(ServiceStatusSchema, {
                serviceName: 'ai-engine',
                version: VERSION_MOCK,
                state: HealthState.OK,
                checkedAt: timestampNow(),
                servedVia: TransporteContrato.UNSPECIFIED,
                components: [
                  create(ComponentStatusSchema, {
                    id: 'speech-model',
                    kind: ComponentKind.MODEL,
                    state: HealthState.OK,
                    detail: 'Modelo de voz tiny simulado',
                    version: 'faster-whisper-tiny-int8',
                  }),
                ],
              }),
            }),
          ],
        }),
      }),
    })
  })
}
