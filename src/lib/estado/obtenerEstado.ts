import 'server-only'
import { BackendNoDisponibleError, llamarBackend, type Dependencias } from '@/lib/bff/cliente'
import { ConfiguracionInvalidaError } from '@/lib/bff/configuracion'
import { esRespuestaEstado, vistaDesdeBackend, vistaSinBackend, type VistaEstado } from './modelo'

const RUTA_ESTADO = '/api/v1/status'

function versionFrontend(): string | null {
  // Vercel expone el commit desplegado; en local no existe.
  return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null
}

/** Consulta el estado de las capas a traves del BFF. Nunca lanza: siempre devuelve una vista. */
export async function obtenerEstado(dependencias: Dependencias = {}): Promise<VistaEstado> {
  const ahora = dependencias.ahora ?? Date.now
  const version = versionFrontend()
  const inicio = ahora()
  try {
    const respuesta = await llamarBackend(RUTA_ESTADO, {}, dependencias)
    const latencia = ahora() - inicio
    if (respuesta.estado === 401) {
      return vistaSinBackend(
        'El backend rechazó la firma del BFF: revisa que ACTAFLOW_BFF_HMAC_SECRET sea igual en ambos',
        version,
        new Date(ahora()),
      )
    }
    if (respuesta.estado !== 200) {
      return vistaSinBackend(`El backend respondió HTTP ${respuesta.estado}`, version, new Date(ahora()))
    }
    if (!esRespuestaEstado(respuesta.datos)) {
      return vistaSinBackend('El backend envió una respuesta inesperada', version, new Date(ahora()))
    }
    return vistaDesdeBackend(respuesta.datos, latencia, version)
  } catch (error) {
    if (error instanceof BackendNoDisponibleError) {
      return vistaSinBackend(
        `No respondió tras esperar ${Math.round(error.esperadoMs / 1000)} s; puede estar despertando`,
        version,
        new Date(ahora()),
      )
    }
    if (error instanceof ConfiguracionInvalidaError) {
      console.error('BFF sin configurar:', error.message)
      return vistaSinBackend('El BFF no está configurado en este entorno', version, new Date(ahora()))
    }
    console.error('Error inesperado consultando el estado', error)
    return vistaSinBackend('Error inesperado al consultar el backend', version, new Date(ahora()))
  }
}
