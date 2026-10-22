import { fromBinary, toBinary, type DescMessage, type MessageShape } from '@bufbuild/protobuf'
import { aBase64Url, desdeBase64Url } from '@/lib/cripto/bytes'

/**
 * Los mensajes de la audiencia viajan entre el navegador y el BFF tal cual el contrato: protobuf
 * binario en base64url. Asi el navegador trabaja con los mismos tipos generados que el BFF (y los
 * blobs cifrados no pasan por conversiones a mano). El BFF los vuelve a validar al recibirlos.
 */

export function aTexto<D extends DescMessage>(esquema: D, mensaje: MessageShape<D>): string {
  return aBase64Url(toBinary(esquema, mensaje))
}

/** Lanza si el texto no es base64url o no es un mensaje valido de ese tipo. */
export function desdeTexto<D extends DescMessage>(esquema: D, texto: string): MessageShape<D> {
  return fromBinary(esquema, desdeBase64Url(texto))
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
