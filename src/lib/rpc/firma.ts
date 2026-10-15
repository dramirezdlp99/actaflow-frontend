import 'server-only'
import { createHash, createHmac } from 'node:crypto'
import { toBinary } from '@bufbuild/protobuf'
import type { Interceptor } from '@connectrpc/connect'
import { createAsyncIterable } from '@connectrpc/connect/protocol'

/**
 * Firma HMAC-SHA256 de cada llamada gRPC del BFF, en los metadatos. Mensaje canonico, identico en
 * Java, Python y TypeScript:
 *
 *   {timestamp}\nRPC\n/{paquete.Servicio}/{Metodo}\n{sha256 hex de los bytes protobuf de la peticion}
 *
 * Unario y streaming del servidor firman el unico mensaje de la peticion; streaming del cliente y
 * bidireccional firman cero bytes (se autentica la apertura de la llamada).
 */
export const METADATO_TIMESTAMP = 'x-actaflow-timestamp'
export const METADATO_FIRMA = 'x-actaflow-signature'
const SIN_CUERPO = new Uint8Array()

export function mensajeCanonico(timestamp: string, procedimiento: string, cuerpo: Uint8Array): string {
  const ruta = procedimiento.startsWith('/') ? procedimiento : `/${procedimiento}`
  const resumen = createHash('sha256').update(cuerpo).digest('hex')
  return `${timestamp}\nRPC\n${ruta}\n${resumen}`
}

export function firmar(secreto: string, timestamp: string, procedimiento: string, cuerpo: Uint8Array): string {
  return createHmac('sha256', secreto).update(mensajeCanonico(timestamp, procedimiento, cuerpo)).digest('hex')
}

/** Interceptor de Connect que firma cada llamada con el secreto del par BFF-servicio. */
export function interceptorFirma(secreto: string, ahora: () => number = Date.now): Interceptor {
  return (siguiente) => async (peticion) => {
    const procedimiento = `/${peticion.service.typeName}/${peticion.method.name}`
    const timestamp = Math.floor(ahora() / 1000).toString()
    let cuerpo = SIN_CUERPO
    let paraEnviar = peticion
    if (!peticion.stream) {
      cuerpo = toBinary(peticion.method.input, peticion.message)
    } else if (peticion.method.methodKind === 'server_streaming') {
      // La peticion de un streaming del servidor es un solo mensaje: se lee, se firma y se reenvia.
      const mensajes = []
      for await (const mensaje of peticion.message) {
        mensajes.push(mensaje)
      }
      const [unico] = mensajes
      if (mensajes.length !== 1 || unico === undefined) {
        throw new Error('Un streaming del servidor envia exactamente un mensaje')
      }
      cuerpo = toBinary(peticion.method.input, unico)
      paraEnviar = { ...peticion, message: createAsyncIterable(mensajes) }
    }
    paraEnviar.header.set(METADATO_TIMESTAMP, timestamp)
    paraEnviar.header.set(METADATO_FIRMA, firmar(secreto, timestamp, procedimiento, cuerpo))
    return siguiente(paraEnviar)
  }
}
