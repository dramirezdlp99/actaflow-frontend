import 'server-only'
import { Code, ConnectError, createClient, type Client, type Transport } from '@connectrpc/connect'
import { createGrpcTransport, createGrpcWebTransport } from '@connectrpc/connect-node'
import { ServiceStatusService } from '@/gen/actaflow/system/v1/service_status_pb'
import type { ConfiguracionBff, TransporteRpc } from './configuracion'
import { interceptorFirma } from './firma'
import { transporteMockExpedientes, transporteMockIdentidad } from './mocks'

/**
 * Clientes gRPC del BFF, generados desde el contrato. El resto del codigo solo ve `Client<...>`:
 * no sabe si debajo hay gRPC nativo (HTTP/2), gRPC-Web (HTTP/1.1) o un mock.
 */
export type ClientesRpc = {
  identidad: { estado: Client<typeof ServiceStatusService> }
  expedientes: { estado: Client<typeof ServiceStatusService> }
}

export function crearTransporte(transporte: TransporteRpc, baseUrl: string, secreto: string): Transport {
  const interceptors = [interceptorFirma(secreto)]
  return transporte === 'grpc'
    ? createGrpcTransport({ baseUrl, interceptors })
    : createGrpcWebTransport({ baseUrl, httpVersion: '1.1', interceptors })
}

export function crearClientes(config: ConfiguracionBff): ClientesRpc {
  const identidad =
    config.modo === 'mock'
      ? transporteMockIdentidad()
      : crearTransporte(config.transporte, config.identidad.url, config.identidad.secreto)
  const expedientes =
    config.modo === 'mock'
      ? transporteMockExpedientes()
      : crearTransporte(config.transporte, config.expedientes.url, config.expedientes.secreto)
  return {
    identidad: { estado: createClient(ServiceStatusService, identidad) },
    expedientes: { estado: createClient(ServiceStatusService, expedientes) },
  }
}

/** Render responde 502/503 (UNAVAILABLE en gRPC-Web) mientras despierta un servicio dormido. */
const CODIGOS_TRANSITORIOS = new Set([Code.Unavailable, Code.DeadlineExceeded])
const TIMEOUT_POR_INTENTO_MS = 30_000
const ESPERA_INICIAL_MS = 2_000
const ESPERA_TOPE_MS = 10_000

export class ServicioNoDisponibleError extends Error {
  constructor(
    readonly intentos: number,
    readonly esperadoMs: number,
  ) {
    super(`El servicio no respondio tras ${intentos} intentos (${Math.round(esperadoMs / 1000)} s)`)
    this.name = 'ServicioNoDisponibleError'
  }
}

export type Reloj = {
  ahora?: () => number
  dormir?: (ms: number) => Promise<void>
}

const dormirReal = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms))

export function esperaEntreIntentos(intento: number): number {
  return Math.min(ESPERA_INICIAL_MS * 1.5 ** (intento - 1), ESPERA_TOPE_MS)
}

/**
 * Ejecuta una llamada idempotente y, si el servicio esta despertando, la repite con espera
 * creciente hasta `esperaMaxMs`. Los errores definitivos (firma, contrato) no se repiten.
 */
export async function conDespertar<T>(
  llamada: (timeoutMs: number) => Promise<T>,
  esperaMaxMs: number,
  { ahora = Date.now, dormir = dormirReal }: Reloj = {},
): Promise<T> {
  const inicio = ahora()
  let intentos = 0
  while (true) {
    intentos += 1
    const restante = esperaMaxMs - (ahora() - inicio)
    try {
      return await llamada(Math.max(1_000, Math.min(TIMEOUT_POR_INTENTO_MS, restante)))
    } catch (error) {
      if (!(error instanceof ConnectError) || !CODIGOS_TRANSITORIOS.has(error.code)) {
        throw error
      }
    }
    const pausa = esperaEntreIntentos(intentos)
    if (ahora() - inicio + pausa >= esperaMaxMs) {
      throw new ServicioNoDisponibleError(intentos, ahora() - inicio)
    }
    await dormir(pausa)
  }
}
