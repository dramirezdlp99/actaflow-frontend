import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { CaseDetailsSchema } from '@/gen/actaflow/cases/v1/case_pb'
import { aleatorio } from './claves'
import { buffer } from './bytes'

/**
 * Cifrado de punta a punta de un expediente (todo en el navegador, con WebCrypto).
 *
 *   clave del caso: AES-256-GCM aleatoria, una por expediente
 *   detalles (titulo y resumen): mensaje CaseDetails cifrado con la clave del caso
 *   para cada participante: la clave del caso "envuelta" para SU clave publica:
 *
 *     efimera = par ECDH P-256 nuevo (solo para esta envoltura)
 *     secreto = ECDH(efimera.privada, publica del destinatario)              32 bytes
 *     kek     = HKDF-SHA-256(secreto, sal = efimera.publica,
 *                            info = "actaflow/clave-de-caso/v1|" + id de la clave del destinatario)
 *     envuelta = AES-256-GCM(kek, clave del caso), con el id del destinatario como dato autenticado
 *
 * Quien tenga la clave privada del destinatario repite el ECDH con la publica efimera y la abre. El
 * servidor solo guarda la envoltura: no puede abrirla.
 */

export const TIPO_DETALLES = 'actaflow.cases.v1.CaseDetails'
const INFO_ENVOLTURA = 'actaflow/clave-de-caso/v1|'
const CURVA = { name: 'ECDH', namedCurve: 'P-256' } as const
const texto = new TextEncoder()

export type BlobCaso = { idClave: string; nonce: Uint8Array; cifrado: Uint8Array; tipo: string }
export type Envoltura = {
  idDestinatario: string
  efimera: Uint8Array
  nonce: Uint8Array
  envuelta: Uint8Array
}
export type Detalles = { titulo: string; resumen: string }

function sutil(): SubtleCrypto {
  return globalThis.crypto.subtle
}

/** Clave nueva de un expediente. Exportable: hay que envolverla para cada participante. */
export async function nuevaClaveCaso(): Promise<{ clave: CryptoKey; idClave: string }> {
  const clave = await sutil().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  return { clave, idClave: `caso:${globalThis.crypto.randomUUID()}:v1` }
}

export async function cifrarDetalles(clave: CryptoKey, idClave: string, detalles: Detalles): Promise<BlobCaso> {
  const claro = toBinary(
    CaseDetailsSchema,
    create(CaseDetailsSchema, { title: detalles.titulo, summary: detalles.resumen }),
  )
  const nonce = aleatorio(12)
  const cifrado = await sutil().encrypt(
    { name: 'AES-GCM', iv: buffer(nonce), additionalData: texto.encode(idClave) },
    clave,
    buffer(claro),
  )
  return { idClave, nonce, cifrado: new Uint8Array(cifrado), tipo: TIPO_DETALLES }
}

export async function descifrarDetalles(clave: CryptoKey, blob: BlobCaso): Promise<Detalles> {
  const claro = await sutil().decrypt(
    { name: 'AES-GCM', iv: buffer(blob.nonce), additionalData: texto.encode(blob.idClave) },
    clave,
    buffer(blob.cifrado),
  )
  const detalles = fromBinary(CaseDetailsSchema, new Uint8Array(claro))
  return { titulo: detalles.title, resumen: detalles.summary }
}

async function kekEnvoltura(
  privada: CryptoKey,
  publica: CryptoKey,
  efimera: Uint8Array,
  idDestinatario: string,
): Promise<CryptoKey> {
  const secreto = await sutil().deriveBits({ name: 'ECDH', public: publica }, privada, 256)
  const material = await sutil().importKey('raw', secreto, 'HKDF', false, ['deriveKey'])
  return sutil().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: buffer(efimera), info: texto.encode(INFO_ENVOLTURA + idDestinatario) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Envuelve la clave del caso para la clave publica (65 bytes, sin comprimir) de un participante. */
export async function envolverClave(
  claveCaso: CryptoKey,
  destinatario: { idClave: string; publica: Uint8Array },
): Promise<Envoltura> {
  if (destinatario.publica.length !== 65 || destinatario.publica[0] !== 0x04) {
    throw new Error('La clave publica del destinatario no es un punto P-256 valido')
  }
  const publica = await sutil().importKey('raw', buffer(destinatario.publica), CURVA, false, [])
  const par = await sutil().generateKey(CURVA, true, ['deriveBits'])
  const efimera = new Uint8Array(await sutil().exportKey('raw', par.publicKey))
  const kek = await kekEnvoltura(par.privateKey, publica, efimera, destinatario.idClave)
  const nonce = aleatorio(12)
  const crudo = new Uint8Array(await sutil().exportKey('raw', claveCaso))
  try {
    const envuelta = await sutil().encrypt(
      { name: 'AES-GCM', iv: buffer(nonce), additionalData: texto.encode(destinatario.idClave) },
      kek,
      buffer(crudo),
    )
    return { idDestinatario: destinatario.idClave, efimera, nonce, envuelta: new Uint8Array(envuelta) }
  } finally {
    crudo.fill(0)
  }
}

/** Abre una envoltura con la clave privada propia (la de IndexedDB, que no se puede exportar). */
export async function desenvolverClave(privada: CryptoKey, envoltura: Envoltura): Promise<CryptoKey> {
  const efimera = await sutil().importKey('raw', buffer(envoltura.efimera), CURVA, false, [])
  const kek = await kekEnvoltura(privada, efimera, envoltura.efimera, envoltura.idDestinatario)
  const crudo = new Uint8Array(
    await sutil().decrypt(
      { name: 'AES-GCM', iv: buffer(envoltura.nonce), additionalData: texto.encode(envoltura.idDestinatario) },
      kek,
      buffer(envoltura.envuelta),
    ),
  )
  try {
    // Exportable para poder envolverla a su vez para otros participantes (GrantCaseKey).
    return await sutil().importKey('raw', buffer(crudo), 'AES-GCM', true, ['encrypt', 'decrypt'])
  } finally {
    crudo.fill(0)
  }
}
