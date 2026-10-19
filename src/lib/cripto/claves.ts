import { aBase32, aHex, buffer, desdeBase32 } from './bytes'

/**
 * Criptografia del navegador (WebCrypto). La contrasena NUNCA sale de aqui.
 *
 *   contrasena + sal ──PBKDF2-SHA-256 (600 000)──► semilla de 32 bytes
 *   semilla ──HKDF "verificador"──► verificador (32 bytes): lo unico que viaja al servidor
 *   semilla ──HKDF "kek"──► clave AES-256-GCM que cifra la clave privada (no se puede exportar)
 *
 * Cada cuenta tiene un par ECDH P-256. La clave privada se guarda en el servidor cifrada dos veces:
 * con la clave derivada de la contrasena y con una clave de recuperacion aleatoria que solo ve la
 * persona (la imprime o la guarda). El servidor no puede abrir ninguna de las dos.
 */

export const ITERACIONES_KDF = 600_000
export const LARGO_SAL = 16
export const LARGO_MINIMO_CONTRASENA = 12
export const LARGO_MAXIMO_CONTRASENA = 128

const INFO_VERIFICADOR = 'actaflow/verificador/v1'
const INFO_KEK = 'actaflow/kek-contrasena/v1'
const INFO_RECUPERACION = 'actaflow/kek-recuperacion/v1'
export const ID_KEK_CONTRASENA = 'kek:contrasena:v1'
export const ID_KEK_RECUPERACION = 'kek:recuperacion:v1'
const LARGO_CLAVE_RECUPERACION = 20
const texto = new TextEncoder()

export type ClavesDerivadas = {
  /** Lo que el servidor guarda (otra vez cifrado con su pepper) para comprobar la contrasena. */
  verificador: Uint8Array
  /** Abre y cierra la clave privada. No se puede exportar: solo existe en este navegador. */
  kek: CryptoKey
}

/** Mismo formato que el contrato EncryptedBlob (suite AES-256-GCM). */
export type BlobCifrado = {
  idClave: string
  nonce: Uint8Array
  cifrado: Uint8Array
}

export type KitNuevo = {
  idClavePublica: string
  /** Punto P-256 sin comprimir: 65 bytes que empiezan por 0x04. */
  clavePublica: Uint8Array
  huella: string
  porContrasena: BlobCifrado
  porRecuperacion: BlobCifrado
  /** Se muestra UNA vez: es la unica forma de recuperar la clave privada si se olvida la contrasena. */
  claveRecuperacion: string
}

function sutil(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Este navegador no tiene WebCrypto (se necesita HTTPS o localhost)')
  }
  return globalThis.crypto.subtle
}

export function aleatorio(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n))
}

export function nuevaSal(): Uint8Array {
  return aleatorio(LARGO_SAL)
}

async function hkdf(semilla: CryptoKey, info: string, sal: Uint8Array): Promise<ArrayBuffer> {
  return sutil().deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: buffer(sal), info: texto.encode(info) },
    semilla,
    256,
  )
}

async function kekDesde(semilla: CryptoKey, info: string, sal: Uint8Array): Promise<CryptoKey> {
  return sutil().importKey('raw', await hkdf(semilla, info, sal), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/** PBKDF2 con 600 000 iteraciones: tarda cerca de un segundo a proposito (frena la fuerza bruta). */
export async function derivarClaves(
  contrasena: string,
  sal: Uint8Array,
  iteraciones: number,
): Promise<ClavesDerivadas> {
  const material = await sutil().importKey('raw', texto.encode(contrasena.normalize('NFC')), 'PBKDF2', false, [
    'deriveBits',
  ])
  const bits = await sutil().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: buffer(sal), iterations: iteraciones },
    material,
    256,
  )
  const semilla = await sutil().importKey('raw', bits, 'HKDF', false, ['deriveBits'])
  return {
    verificador: new Uint8Array(await hkdf(semilla, INFO_VERIFICADOR, sal)),
    kek: await kekDesde(semilla, INFO_KEK, sal),
  }
}

async function kekRecuperacion(claveRecuperacion: string): Promise<CryptoKey> {
  const bytes = desdeBase32(claveRecuperacion)
  if (bytes.length !== LARGO_CLAVE_RECUPERACION) {
    throw new Error('La clave de recuperacion no tiene el largo esperado')
  }
  const semilla = await sutil().importKey('raw', buffer(bytes), 'HKDF', false, ['deriveBits'])
  return kekDesde(semilla, INFO_RECUPERACION, new Uint8Array())
}

/** El id de la clave va como dato autenticado: un blob no se puede pasar por otro. */
async function cifrar(kek: CryptoKey, idClave: string, datos: Uint8Array): Promise<BlobCifrado> {
  const nonce = aleatorio(12)
  const cifrado = await sutil().encrypt(
    { name: 'AES-GCM', iv: buffer(nonce), additionalData: texto.encode(idClave) },
    kek,
    buffer(datos),
  )
  return { idClave, nonce, cifrado: new Uint8Array(cifrado) }
}

async function descifrar(kek: CryptoKey, blob: BlobCifrado): Promise<Uint8Array> {
  const claro = await sutil().decrypt(
    { name: 'AES-GCM', iv: buffer(blob.nonce), additionalData: texto.encode(blob.idClave) },
    kek,
    buffer(blob.cifrado),
  )
  return new Uint8Array(claro)
}

/** XXXX-XXXX-...: 32 caracteres base32 (160 bits) en grupos de 4, faciles de copiar a mano. */
function formatearRecuperacion(bytes: Uint8Array): string {
  return (aBase32(bytes).match(/.{1,4}/g) ?? []).join('-')
}

export async function huella(clavePublica: Uint8Array): Promise<string> {
  return aHex(new Uint8Array(await sutil().digest('SHA-256', buffer(clavePublica))))
}

/** Crea el par de claves de una cuenta nueva y lo deja cifrado para enviarlo al servidor. */
export async function crearKit(kek: CryptoKey): Promise<KitNuevo> {
  const par = await sutil().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const clavePublica = new Uint8Array(await sutil().exportKey('raw', par.publicKey))
  const privada = new Uint8Array(await sutil().exportKey('pkcs8', par.privateKey))
  const claveRecuperacion = formatearRecuperacion(aleatorio(LARGO_CLAVE_RECUPERACION))
  try {
    return {
      idClavePublica: `cuenta:${globalThis.crypto.randomUUID()}:v1`,
      clavePublica,
      huella: await huella(clavePublica),
      porContrasena: await cifrar(kek, ID_KEK_CONTRASENA, privada),
      porRecuperacion: await cifrar(await kekRecuperacion(claveRecuperacion), ID_KEK_RECUPERACION, privada),
      claveRecuperacion,
    }
  } finally {
    privada.fill(0)
  }
}

async function importarPrivada(pkcs8: Uint8Array): Promise<CryptoKey> {
  try {
    // No exportable: aunque un script lograra leerla, no podria sacarla del navegador.
    return await sutil().importKey('pkcs8', buffer(pkcs8), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  } finally {
    pkcs8.fill(0)
  }
}

/** Abre la clave privada con la contrasena. Lanza si la contrasena no corresponde. */
export async function abrirConContrasena(kek: CryptoKey, blob: BlobCifrado): Promise<CryptoKey> {
  return importarPrivada(await descifrar(kek, blob))
}

/** Abre la clave privada con la clave de recuperacion impresa. */
export async function abrirConRecuperacion(claveRecuperacion: string, blob: BlobCifrado): Promise<CryptoKey> {
  return importarPrivada(await descifrar(await kekRecuperacion(claveRecuperacion), blob))
}

export type ProblemaContrasena = 'corta' | 'larga' | 'distintas' | null

export function revisarContrasena(contrasena: string, confirmacion: string): ProblemaContrasena {
  const largo = [...contrasena.normalize('NFC')].length
  if (largo < LARGO_MINIMO_CONTRASENA) {
    return 'corta'
  }
  if (largo > LARGO_MAXIMO_CONTRASENA) {
    return 'larga'
  }
  return contrasena === confirmacion ? null : 'distintas'
}
