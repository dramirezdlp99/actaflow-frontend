import 'server-only'
import { Code, ConnectError } from '@connectrpc/connect'
import { ConfiguracionInvalidaError, leerConfiguracion, type ConfiguracionBff } from '@/lib/rpc/configuracion'
import {
  conDespertar,
  crearClientes,
  ServicioNoDisponibleError,
  type ClientesEstado,
  type Reloj,
} from '@/lib/rpc/clientes'
import { construirVista, type ResultadoServicio, type VistaEstado } from './modelo'

export type Dependencias = Reloj & {
  configuracion?: ConfiguracionBff
  clientes?: ClientesEstado
}

const VARIABLE_SECRETO = {
  identidad: 'ACTAFLOW_IDENTITY_HMAC_SECRET',
  expedientes: 'ACTAFLOW_LEGAL_CASE_HMAC_SECRET',
} as const

function versionFrontend(): string | null {
  // Vercel expone el commit desplegado; en local no existe.
  return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null
}

/** Explicacion corta y segura de mostrar: sin URLs, trazas ni secretos. */
export function explicarFallo(error: unknown, servicio: keyof typeof VARIABLE_SECRETO): string {
  if (error instanceof ServicioNoDisponibleError) {
    return `No respondió tras esperar ${Math.round(error.esperadoMs / 1000)} s; puede estar despertando`
  }
  if (error instanceof ConnectError) {
    switch (error.code) {
      case Code.Unauthenticated:
        return `Rechazó la firma del BFF: revisa que ${VARIABLE_SECRETO[servicio]} sea igual en ambos`
      case Code.Unimplemented:
        return 'No publica ServiceStatusService: ¿versión de contrato distinta?'
      default:
        return `Error gRPC: ${Code[error.code]}`
    }
  }
  console.error('Error inesperado consultando el estado', error)
  return 'Error inesperado al consultar el servicio'
}

/** Consulta el estado de todas las capas por gRPC. Nunca lanza: siempre devuelve una vista. */
export async function obtenerEstado(dependencias: Dependencias = {}): Promise<VistaEstado> {
  const ahora = dependencias.ahora ?? Date.now
  const version = versionFrontend()
  let configuracion: ConfiguracionBff
  try {
    configuracion = dependencias.configuracion ?? leerConfiguracion()
  } catch (error) {
    if (!(error instanceof ConfiguracionInvalidaError)) {
      throw error
    }
    console.error('BFF sin configurar:', error.message)
    const motivo: ResultadoServicio = { tipo: 'fallo', motivo: 'El BFF no está configurado en este entorno' }
    return construirVista(motivo, motivo, version, new Date(ahora()))
  }
  const clientes: ClientesEstado = dependencias.clientes ?? crearClientes(configuracion)

  const consultar = async (servicio: keyof ClientesEstado): Promise<ResultadoServicio> => {
    const inicio = ahora()
    try {
      const respuesta = await conDespertar(
        (timeoutMs) => clientes[servicio].estado.getServiceStatus({}, { timeoutMs }),
        configuracion.esperaMaxMs,
        dependencias,
      )
      if (!respuesta.status) {
        return { tipo: 'fallo', motivo: 'Respondió sin estado: incumple el contrato' }
      }
      return { tipo: 'respondio', estado: respuesta.status, latenciaMs: ahora() - inicio }
    } catch (error) {
      return { tipo: 'fallo', motivo: explicarFallo(error, servicio) }
    }
  }

  // En paralelo: un servicio dormido no retrasa al otro.
  const [identidad, expedientes] = await Promise.all([consultar('identidad'), consultar('expedientes')])
  return construirVista(identidad, expedientes, version, new Date(ahora()))
}
