'use server'

import { obtenerEstado } from '@/lib/estado/obtenerEstado'

/**
 * Server Action: el navegador invoca una FUNCION del BFF (RPC), no un recurso REST. No recibe
 * argumentos y no devuelve datos: solo despierta los servicios de Render consultando su estado.
 */
export async function despertarServicios(): Promise<void> {
  await obtenerEstado()
}
