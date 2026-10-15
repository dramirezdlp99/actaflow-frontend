import { create } from '@bufbuild/protobuf'
import {
  ComponentKind,
  ComponentStatusSchema,
  HealthState,
  ServiceStatusSchema,
  Transport,
  type ServiceStatus,
} from '@/gen/actaflow/system/v1/service_status_pb'

/** Secreto falso y publico con el que se calcularon los vectores compartidos por los tres repos. */
export const SECRETO_PRUEBA = 'secreto-de-prueba-publico-solo-para-tests-0123456789'
export const OTRO_SECRETO = 'otro-secreto-de-prueba-publico-para-tests-9876543210'

/** Estado de identity-service tal como lo define el contrato. */
export function estadoIdentidad(): ServiceStatus {
  return create(ServiceStatusSchema, {
    serviceName: 'identity-service',
    version: '0.2.0',
    state: HealthState.OK,
    servedVia: Transport.GRPC_WEB,
    components: [
      create(ComponentStatusSchema, {
        id: 'database',
        kind: ComponentKind.DATABASE,
        state: HealthState.OK,
        latencyMs: 12n,
        detail: 'PostgreSQL responde; esquema identity v1',
        version: '1',
      }),
    ],
  })
}

/** Estado de legal-case-service con el motor anidado. */
export function estadoExpedientes(motor: HealthState = HealthState.OK): ServiceStatus {
  return create(ServiceStatusSchema, {
    serviceName: 'legal-case-service',
    version: '0.2.0',
    state: motor === HealthState.OK ? HealthState.OK : HealthState.DEGRADED,
    servedVia: Transport.GRPC_WEB,
    components: [
      create(ComponentStatusSchema, {
        id: 'database',
        kind: ComponentKind.DATABASE,
        state: HealthState.OK,
        latencyMs: 30n,
        detail: 'PostgreSQL responde; esquema legal_case v2',
        version: '2',
      }),
      create(ComponentStatusSchema, {
        id: 'ai-engine',
        kind: ComponentKind.SERVICE,
        state: motor,
        latencyMs: 40n,
        detail: 'ai-engine responde',
        version: '0.2.0',
        nested: create(ServiceStatusSchema, {
          serviceName: 'ai-engine',
          version: '0.2.0',
          state: motor,
          servedVia: Transport.GRPC,
          components: [
            create(ComponentStatusSchema, {
              id: 'speech-model',
              kind: ComponentKind.MODEL,
              state: motor,
              detail: motor === HealthState.OK ? 'Modelo de voz tiny listo' : 'Modelo de voz tiny no instalado',
            }),
          ],
        }),
      }),
    ],
  })
}

/** Reloj falso: cada `dormir` avanza el tiempo sin esperar de verdad. */
export function relojFalso(inicio = 1_760_000_000_000) {
  let ahora = inicio
  return {
    ahora: () => ahora,
    dormir: async (ms: number) => {
      ahora += ms
    },
    avanzar: (ms: number) => {
      ahora += ms
    },
  }
}
