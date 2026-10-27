import { create } from '@bufbuild/protobuf'
import {
  CipherSuite,
  EncryptedBlobSchema,
  SealedEnvelopeSchema,
  WrappedKeySchema,
  type EncryptedBlob,
  type SealedEnvelope,
} from '@/gen/actaflow/crypto/v1/crypto_pb'
import { buffer } from '@/lib/cripto/bytes'
import { desenvolverClave, envolverClave } from '@/lib/cripto/casos'
import { aleatorio } from '@/lib/cripto/claves'

/**
 * "Procesador sellado" del lado del navegador: lo que solo el motor de IA debe leer (el audio de una
 * intervencion, la transcripcion que se le manda a extraer) se cifra con una clave de contenido K
 * nueva, y K viaja de dos formas:
 *
 *   - envuelta para la clave publica del motor (mismo esquema que las claves de los casos), para
 *     que el motor abra la carga en memoria y cifre su resultado con la misma K;
 *   - cifrada con la clave del caso, para que cualquier participante abra ese resultado.
 *
 * Ni el BFF ni legal-case pueden abrir nada. El dato autenticado ata cada cifrado a su proposito, a
 * su caso y a su recurso: un sobre no se puede pasar por otro (debe coincidir con el motor).
 */

export const PROPOSITO = {
  audio: 'audio-segment',
  transcripcion: 'transcript',
  entrada: 'extraction-input',
  entidades: 'extraction-result',
  claveContenido: 'content-key',
  revision: 'reviewed-entities',
  actaFinal: 'minute-final',
  actaPdf: 'minute-pdf',
  borrador: 'minute-draft',
  borradorFoto: 'minute-draft-snapshot',
} as const

export const TIPO = {
  audio: 'actaflow.engine.v1.SealedAudioSegment',
  transcripcion: 'actaflow.legal.v1.TranscriptionResult',
  entrada: 'actaflow.engine.v1.ExtractionInput',
  entidades: 'actaflow.legal.v1.EntityExtractionResult',
  claveContenido: 'actaflow.crypto.v1.ContentKey',
  actaFinal: 'actaflow.minutes.v1.FinalContent',
  actaPdf: 'application/pdf',
  borrador: 'application/vnd.actaflow.minute-draft+json',
} as const

export type Proposito = (typeof PROPOSITO)[keyof typeof PROPOSITO]
export type ClaveMotor = { idClave: string; publica: Uint8Array }

const texto = new TextEncoder()

export function aad(proposito: Proposito, casoId: string, recursoId: string): Uint8Array {
  return texto.encode(`actaflow/v1|${proposito}|${casoId}|${recursoId}`)
}

function sutil(): SubtleCrypto {
  return globalThis.crypto.subtle
}

async function cifrar(
  clave: CryptoKey,
  idClave: string,
  datos: Uint8Array,
  tipo: string,
  contexto: Uint8Array,
): Promise<EncryptedBlob> {
  const nonce = aleatorio(12)
  const cifrado = await sutil().encrypt(
    { name: 'AES-GCM', iv: buffer(nonce), additionalData: buffer(contexto) },
    clave,
    buffer(datos),
  )
  return create(EncryptedBlobSchema, {
    suite: CipherSuite.AES_256_GCM,
    keyId: idClave,
    nonce,
    ciphertext: new Uint8Array(cifrado),
    plaintextType: tipo,
  })
}

/** Lanza si la clave, el contexto o el tipo no corresponden (nunca devuelve datos alterados). */
async function descifrar(clave: CryptoKey, blob: EncryptedBlob, tipo: string, contexto: Uint8Array) {
  if (blob.plaintextType !== tipo) {
    throw new Error(`Se esperaba ${tipo} y llego ${blob.plaintextType || 'sin tipo'}`)
  }
  const claro = await sutil().decrypt(
    { name: 'AES-GCM', iv: buffer(blob.nonce), additionalData: buffer(contexto) },
    clave,
    buffer(blob.ciphertext),
  )
  return new Uint8Array(claro)
}

export type Sellar = {
  claveCaso: CryptoKey
  /** Id de la clave del caso (el de los detalles cifrados); solo informativo. */
  idClaveCaso: string
  motor: ClaveMotor
  proposito: typeof PROPOSITO.audio | typeof PROPOSITO.entrada | typeof PROPOSITO.actaFinal
  casoId: string
  recursoId: string
  datos: Uint8Array
  tipo: string
}

export async function sellar(p: Sellar): Promise<SealedEnvelope> {
  const contenido = await sutil().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const idContenido = `contenido:${p.recursoId}`
  const payload = await cifrar(contenido, idContenido, p.datos, p.tipo, aad(p.proposito, p.casoId, p.recursoId))
  const envoltura = await envolverClave(contenido, p.motor)
  const crudo = new Uint8Array(await sutil().exportKey('raw', contenido))
  try {
    const paraCaso = await cifrar(
      p.claveCaso,
      p.idClaveCaso || 'caso',
      crudo,
      TIPO.claveContenido,
      aad(PROPOSITO.claveContenido, p.casoId, p.recursoId),
    )
    return create(SealedEnvelopeSchema, {
      payload,
      processorKey: create(WrappedKeySchema, {
        suite: CipherSuite.ECDH_P256_HKDF_SHA256_AES_256_GCM,
        recipientKeyId: envoltura.idDestinatario,
        ephemeralPublicKey: envoltura.efimera,
        nonce: envoltura.nonce,
        wrappedKey: envoltura.envuelta,
      }),
      contentKeyForCase: paraCaso,
    })
  } finally {
    crudo.fill(0)
  }
}

/** K de un segmento o una extraccion, abierta con la clave del caso. Solo sirve para descifrar. */
export async function abrirClaveContenido(
  claveCaso: CryptoKey,
  blob: EncryptedBlob,
  casoId: string,
  recursoId: string,
): Promise<CryptoKey> {
  const crudo = await descifrar(
    claveCaso,
    blob,
    TIPO.claveContenido,
    aad(PROPOSITO.claveContenido, casoId, recursoId),
  )
  try {
    return await sutil().importKey('raw', buffer(crudo), 'AES-GCM', false, ['decrypt'])
  } finally {
    crudo.fill(0)
  }
}

/** El resultado del motor (transcripcion o entidades), cifrado por el con la misma K. */
export async function abrirResultado(
  contenido: CryptoKey,
  blob: EncryptedBlob,
  proposito: typeof PROPOSITO.transcripcion | typeof PROPOSITO.entidades,
  casoId: string,
  recursoId: string,
): Promise<Uint8Array> {
  const tipo = proposito === PROPOSITO.transcripcion ? TIPO.transcripcion : TIPO.entidades
  return descifrar(contenido, blob, tipo, aad(proposito, casoId, recursoId))
}

/** El PDF del acta que genero el motor, cifrado con la clave de contenido del acta. */
export async function abrirPdf(
  contenido: CryptoKey,
  blob: EncryptedBlob,
  casoId: string,
  actaId: string,
): Promise<Uint8Array> {
  return descifrar(contenido, blob, TIPO.actaPdf, aad(PROPOSITO.actaPdf, casoId, actaId))
}

/** La revision humana de las entidades va cifrada directamente con la clave del caso. */
export async function cifrarRevision(
  claveCaso: CryptoKey,
  idClaveCaso: string,
  casoId: string,
  extraccionId: string,
  datos: Uint8Array,
): Promise<EncryptedBlob> {
  return cifrar(claveCaso, idClaveCaso || 'caso', datos, TIPO.entidades, aad(PROPOSITO.revision, casoId, extraccionId))
}

export async function descifrarRevision(
  claveCaso: CryptoKey,
  blob: EncryptedBlob,
  casoId: string,
  extraccionId: string,
): Promise<Uint8Array> {
  return descifrar(claveCaso, blob, TIPO.entidades, aad(PROPOSITO.revision, casoId, extraccionId))
}

/**
 * Lo que hace el motor: desenvuelve K con su clave privada, abre la carga y cifra un resultado. Lo
 * usan el legal-case simulado (modo mock) y las pruebas; el motor real hace lo mismo en Python.
 */
export async function procesarComoMotor(
  privadaMotor: CryptoKey,
  sobre: SealedEnvelope,
  entrada: {
    proposito: typeof PROPOSITO.audio | typeof PROPOSITO.entrada | typeof PROPOSITO.actaFinal
    tipo: string
  },
  casoId: string,
  recursoId: string,
  procesar: (datos: Uint8Array) => Uint8Array,
): Promise<EncryptedBlob> {
  const envoltura = sobre.processorKey
  const payload = sobre.payload
  if (!envoltura || !payload) {
    throw new Error('Sobre incompleto')
  }
  const contenido = await desenvolverClave(privadaMotor, {
    idDestinatario: envoltura.recipientKeyId,
    efimera: envoltura.ephemeralPublicKey,
    nonce: envoltura.nonce,
    envuelta: envoltura.wrappedKey,
  })
  const datos = await descifrar(contenido, payload, entrada.tipo, aad(entrada.proposito, casoId, recursoId))
  const salida =
    entrada.proposito === PROPOSITO.audio
      ? PROPOSITO.transcripcion
      : entrada.proposito === PROPOSITO.actaFinal
        ? PROPOSITO.actaPdf
        : PROPOSITO.entidades
  const tipo =
    salida === PROPOSITO.transcripcion ? TIPO.transcripcion : salida === PROPOSITO.actaPdf ? TIPO.actaPdf : TIPO.entidades
  return cifrar(contenido, payload.keyId, procesar(datos), tipo, aad(salida, casoId, recursoId))
}

/** El borrador colaborativo del acta va cifrado con la clave del caso (el servidor solo lo ordena). */
export async function cifrarBorrador(
  claveCaso: CryptoKey,
  idClaveCaso: string,
  proposito: typeof PROPOSITO.borrador | typeof PROPOSITO.borradorFoto,
  casoId: string,
  recursoId: string,
  datos: Uint8Array,
): Promise<EncryptedBlob> {
  return cifrar(claveCaso, idClaveCaso || 'caso', datos, TIPO.borrador, aad(proposito, casoId, recursoId))
}

export async function descifrarBorrador(
  claveCaso: CryptoKey,
  blob: EncryptedBlob,
  proposito: typeof PROPOSITO.borrador | typeof PROPOSITO.borradorFoto,
  casoId: string,
  recursoId: string,
): Promise<Uint8Array> {
  return descifrar(claveCaso, blob, TIPO.borrador, aad(proposito, casoId, recursoId))
}
