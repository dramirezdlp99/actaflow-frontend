import 'server-only'
import { createHash, createHmac } from 'node:crypto'

/**
 * Firma HMAC-SHA256 de las peticiones del BFF al backend.
 * Mensaje canonico, identico en los tres repos:
 *   timestamp \n METODO \n ruta[?consulta] \n sha256_hex(cuerpo)
 */
export const CABECERA_TIMESTAMP = 'X-ActaFlow-Timestamp'
export const CABECERA_FIRMA = 'X-ActaFlow-Signature'

export function mensajeCanonico(timestamp: string, metodo: string, ruta: string, cuerpo: Uint8Array): string {
  const resumen = createHash('sha256').update(cuerpo).digest('hex')
  return `${timestamp}\n${metodo.toUpperCase()}\n${ruta}\n${resumen}`
}

export function firmar(secreto: string, timestamp: string, metodo: string, ruta: string, cuerpo: Uint8Array): string {
  return createHmac('sha256', secreto).update(mensajeCanonico(timestamp, metodo, ruta, cuerpo)).digest('hex')
}

export function cabecerasFirmadas(
  secreto: string,
  metodo: string,
  ruta: string,
  cuerpo: Uint8Array,
  ahoraMs: number = Date.now(),
): Record<string, string> {
  const timestamp = Math.floor(ahoraMs / 1000).toString()
  return {
    [CABECERA_TIMESTAMP]: timestamp,
    [CABECERA_FIRMA]: firmar(secreto, timestamp, metodo, ruta, cuerpo),
  }
}
