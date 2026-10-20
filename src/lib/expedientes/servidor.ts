import 'server-only'
import { timestampMs, type Timestamp } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { notFound } from 'next/navigation'
import type { CaseEvent, CaseMembership, CaseRole, CaseStatus, LegalCase } from '@/gen/actaflow/cases/v1/case_pb'
import type { Participant } from '@/gen/actaflow/cases/v1/participant_pb'
import type { EncryptedBlob, WrappedKey } from '@/gen/actaflow/crypto/v1/crypto_pb'
import { aBase64Url, aHex } from '@/lib/cripto/bytes'
import { clientes, comoPersona, type SesionActual } from '@/lib/sesion/sesion'
import type { BlobTexto, EnvolturaTexto } from './formato'

/**
 * Lecturas de expedientes para los Server Components: siempre en nombre de la persona (su token de
 * acceso), y convertidas a vistas planas que se pueden pasar a componentes de cliente.
 */

const fecha = (marca: Timestamp | undefined) => (marca ? new Date(timestampMs(marca)).toISOString() : null)

export const blobTexto = (blob: EncryptedBlob | undefined): BlobTexto | null =>
  blob
    ? {
        idClave: blob.keyId,
        nonce: aBase64Url(blob.nonce),
        cifrado: aBase64Url(blob.ciphertext),
        tipo: blob.plaintextType,
      }
    : null

export const envolturaTexto = (clave: WrappedKey | undefined): EnvolturaTexto | null =>
  clave
    ? {
        idDestinatario: clave.recipientKeyId,
        efimera: aBase64Url(clave.ephemeralPublicKey),
        nonce: aBase64Url(clave.nonce),
        envuelta: aBase64Url(clave.wrappedKey),
      }
    : null

export type VistaCaso = {
  id: string
  radicado: string
  tipo: LegalCase['kind']
  estado: CaseStatus
  /** Texto: los bigint no viajan como props. */
  revision: string
  audiencia: string | null
  participantes: number
  creado: string | null
  actividad: string | null
  detalles: BlobTexto | null
}

export function vistaCaso(caso: LegalCase): VistaCaso {
  return {
    id: caso.id,
    radicado: caso.caseNumber,
    tipo: caso.kind,
    estado: caso.status,
    revision: caso.revision.toString(),
    audiencia: fecha(caso.scheduledHearingAt),
    participantes: caso.participantCount,
    creado: fecha(caso.createdAt),
    actividad: fecha(caso.lastActivityAt),
    detalles: blobTexto(caso.details),
  }
}

export type VistaMembresia = { participanteId: string; rol: CaseRole; clave: EnvolturaTexto | null }

export const vistaMembresia = (m: CaseMembership | undefined): VistaMembresia | null =>
  m ? { participanteId: m.participantId, rol: m.role, clave: envolturaTexto(m.wrappedCaseKey) } : null

export type VistaPersona = {
  id: string
  cuentaId: string
  nombre: string
  correo: string
  rol: Participant['role']
  lado: Participant['side']
  calidad: Participant['capacity']
  estado: Participant['state']
  unido: string | null
}

export const vistaPersona = (p: Participant): VistaPersona => ({
  id: p.id,
  cuentaId: p.accountId,
  nombre: p.displayName,
  correo: p.email,
  rol: p.role,
  lado: p.side,
  calidad: p.capacity,
  estado: p.state,
  unido: fecha(p.joinedAt),
})

export type VistaEvento = { id: string; tipo: CaseEvent['kind']; cuando: string | null; actor: string }

const vistaEvento = (e: CaseEvent): VistaEvento => ({
  id: e.id,
  tipo: e.kind,
  cuando: fecha(e.occurredAt),
  actor: e.actorDisplayName,
})

/** NOT_FOUND del servicio (no existe o no participas) se muestra como la pagina 404. */
async function oNoEncontrado<T>(llamada: Promise<T>): Promise<T> {
  try {
    return await llamada
  } catch (error) {
    if (error instanceof ConnectError && (error.code === Code.NotFound || error.code === Code.InvalidArgument)) {
      notFound()
    }
    throw error
  }
}

export async function listarCasos(sesion: SesionActual, estado: CaseStatus, tamano: number, token: string) {
  const respuesta = await clientes().expedientes.casos.listCases(
    { page: { pageSize: tamano, pageToken: token }, status: estado },
    comoPersona(sesion.tokenAcceso),
  )
  return {
    casos: respuesta.cases.flatMap((c) => (c.legalCase ? [{ caso: vistaCaso(c.legalCase), rol: c.role }] : [])),
    siguiente: respuesta.pageInfo?.nextPageToken ?? '',
  }
}

export async function obtenerCaso(sesion: SesionActual, casoId: string) {
  const respuesta = await oNoEncontrado(
    clientes().expedientes.casos.getCase({ caseId: casoId }, comoPersona(sesion.tokenAcceso)),
  )
  if (!respuesta.legalCase) {
    notFound()
  }
  return { caso: vistaCaso(respuesta.legalCase), membresia: vistaMembresia(respuesta.membership) }
}

export async function listarPersonas(sesion: SesionActual, casoId: string): Promise<VistaPersona[]> {
  const respuesta = await oNoEncontrado(
    clientes().expedientes.participantes.listParticipants({ caseId: casoId }, comoPersona(sesion.tokenAcceso)),
  )
  return respuesta.participants.map(vistaPersona)
}

export async function listarEventos(sesion: SesionActual, casoId: string): Promise<VistaEvento[]> {
  const respuesta = await oNoEncontrado(
    clientes().expedientes.casos.listCaseEvents(
      { caseId: casoId, page: { pageSize: 50 } },
      comoPersona(sesion.tokenAcceso),
    ),
  )
  return respuesta.events.map(vistaEvento)
}

/** Clave publica de una cuenta (para envolverle la clave del caso) y su huella para comparar en persona. */
export async function clavePublicaDe(sesion: SesionActual, cuentaId: string) {
  const { keys } = await clientes().identidad.directorio.getPublicKeys(
    { accountIds: [cuentaId] },
    comoPersona(sesion.tokenAcceso),
  )
  const clave = keys.find((k) => k.accountId === cuentaId)?.key
  if (!clave || clave.publicKey.length !== 65) {
    return null
  }
  const huella = clave.fingerprintSha256 || aHex(await sha256(clave.publicKey))
  return { idClave: clave.keyId, publica: aBase64Url(clave.publicKey), huella }
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const copia = new Uint8Array(bytes)
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', copia))
}
