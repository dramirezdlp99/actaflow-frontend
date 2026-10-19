/**
 * Conversiones de bytes sin dependencias. Funcionan igual en el navegador y en Node, porque los
 * datos binarios viajan entre ambos como texto base64url (las Server Actions serializan texto).
 */

const ALFABETO_BASE64URL = /^[A-Za-z0-9_-]*$/

export function aBase64Url(bytes: Uint8Array): string {
  let binario = ''
  for (const byte of bytes) {
    binario += String.fromCharCode(byte)
  }
  return btoa(binario).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** Lanza si el texto no es base64url valido; nunca devuelve basura a medias. */
export function desdeBase64Url(texto: string): Uint8Array {
  if (!ALFABETO_BASE64URL.test(texto) || texto.length % 4 === 1) {
    throw new Error('Texto base64url no valido')
  }
  const relleno = '='.repeat((4 - (texto.length % 4)) % 4)
  const binario = atob(texto.replaceAll('-', '+').replaceAll('_', '/') + relleno)
  const bytes = new Uint8Array(binario.length)
  for (let i = 0; i < binario.length; i += 1) {
    bytes[i] = binario.charCodeAt(i)
  }
  return bytes
}

export function aHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** Copia en un ArrayBuffer propio: WebCrypto exige BufferSource sin vistas compartidas. */
export function buffer(bytes: Uint8Array): ArrayBuffer {
  const copia = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copia).set(bytes)
  return copia
}

const ALFABETO_BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function aBase32(bytes: Uint8Array): string {
  let bits = 0
  let valor = 0
  let salida = ''
  for (const byte of bytes) {
    valor = (valor << 8) | byte
    bits += 8
    while (bits >= 5) {
      salida += ALFABETO_BASE32[(valor >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    salida += ALFABETO_BASE32[(valor << (5 - bits)) & 31]
  }
  return salida
}

/** Ignora espacios, guiones y minusculas: asi se puede pegar tal como se imprimio. */
export function desdeBase32(texto: string): Uint8Array {
  const limpio = texto.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '')
  let bits = 0
  let valor = 0
  const salida: number[] = []
  for (const caracter of limpio) {
    const indice = ALFABETO_BASE32.indexOf(caracter)
    if (indice < 0) {
      throw new Error('Texto base32 no valido')
    }
    valor = (valor << 5) | indice
    bits += 5
    if (bits >= 8) {
      salida.push((valor >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Uint8Array.from(salida)
}
