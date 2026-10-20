'use server'

import { create } from '@bufbuild/protobuf'
import { timestampFromMs } from '@bufbuild/protobuf/wkt'
import { z } from 'zod'
import { CaseKind, CaseRole, CaseStatus } from '@/gen/actaflow/cases/v1/case_pb'
import { PartyCapacity, PartySide } from '@/gen/actaflow/cases/v1/participant_pb'
import { CipherSuite, EncryptedBlobSchema, WrappedKeySchema } from '@/gen/actaflow/crypto/v1/crypto_pb'
import { clavePublicaDe } from '@/lib/expedientes/servidor'
import { esquemaBlob, esquemaEnvoltura } from '@/lib/expedientes/formato'
import { falloExpediente, type Fallo } from '@/lib/rpc/errores'
import { camposConProblema, correo } from '@/lib/sesion/esquemas'
import { clientes, comoPersona, sesionActual, type SesionActual } from '@/lib/sesion/sesion'

/**
 * Server Actions de expedientes. El navegador cifra; aqui solo se valida la forma (Zod), se arma el
 * mensaje del contrato y se llama a legal-case-service con el token de la persona.
 */

type Resultado<T> = ({ ok: true } & T) | Fallo

const blobContrato = (b: z.output<typeof esquemaBlob>) =>
  create(EncryptedBlobSchema, {
    suite: CipherSuite.AES_256_GCM,
    keyId: b.idClave,
    nonce: b.nonce,
    ciphertext: b.cifrado,
    plaintextType: b.tipo,
  })

const envolturaContrato = (e: z.output<typeof esquemaEnvoltura>) =>
  create(WrappedKeySchema, {
    suite: CipherSuite.ECDH_P256_HKDF_SHA256_AES_256_GCM,
    recipientKeyId: e.idDestinatario,
    ephemeralPublicKey: e.efimera,
    nonce: e.nonce,
    wrappedKey: e.envuelta,
  })

const audiencia = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Fecha no valida')
  .transform((v) => timestampFromMs(Date.parse(v)))

const uuid = z.uuid()

async function conSesion<T>(trabajo: (sesion: SesionActual) => Promise<Resultado<T>>): Promise<Resultado<T>> {
  const sesion = await sesionActual().catch(() => null)
  if (!sesion) {
    return { ok: false, mensaje: 'Tu sesión venció. Recarga la página para volver a ingresar.' }
  }
  try {
    return await trabajo(sesion)
  } catch (error) {
    return falloExpediente(error)
  }
}

function invalido(error: z.ZodError): Fallo {
  return { ok: false, mensaje: 'Revisa los campos marcados.', campos: camposConProblema(error) }
}

const esquemaNuevo = z.object({
  radicado: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{2,39}$/, { error: 'Usa de 3 a 40 letras, números o guiones, como CC-2026-0142' }),
  tipo: z.enum(['CONCILIATION', 'MEDIATION', 'CONTRACT']),
  detalles: esquemaBlob,
  clave: esquemaEnvoltura,
  audiencia: audiencia.optional(),
  idempotencia: uuid,
})

export async function crearExpediente(datos: z.input<typeof esquemaNuevo>): Promise<Resultado<{ id: string }>> {
  const entrada = esquemaNuevo.safeParse(datos)
  if (!entrada.success) {
    return invalido(entrada.error)
  }
  const d = entrada.data
  return conSesion(async (sesion) => {
    const { legalCase } = await clientes().expedientes.casos.createCase(
      {
        caseNumber: d.radicado,
        kind: CaseKind[d.tipo],
        details: blobContrato(d.detalles),
        wrappedCaseKey: envolturaContrato(d.clave),
        scheduledHearingAt: d.audiencia,
        idempotencyKey: d.idempotencia,
      },
      comoPersona(sesion.tokenAcceso),
    )
    return { ok: true, id: legalCase?.id ?? '' }
  })
}

const esquemaEdicion = z.object({
  casoId: uuid,
  revision: z.string().regex(/^[1-9][0-9]{0,17}$/),
  detalles: esquemaBlob.optional(),
  audiencia: audiencia.optional(),
  idempotencia: uuid,
})

export async function actualizarExpediente(
  datos: z.input<typeof esquemaEdicion>,
): Promise<Resultado<{ revision: string }>> {
  const entrada = esquemaEdicion.safeParse(datos)
  if (!entrada.success) {
    return invalido(entrada.error)
  }
  const d = entrada.data
  return conSesion(async (sesion) => {
    const { legalCase } = await clientes().expedientes.casos.updateCase(
      {
        caseId: d.casoId,
        expectedRevision: BigInt(d.revision),
        details: d.detalles ? blobContrato(d.detalles) : undefined,
        scheduledHearingAt: d.audiencia,
        idempotencyKey: d.idempotencia,
      },
      comoPersona(sesion.tokenAcceso),
    )
    return { ok: true, revision: legalCase?.revision.toString() ?? d.revision }
  })
}

const esquemaEstado = z.object({
  casoId: uuid,
  estado: z.enum(['OPEN', 'IN_HEARING', 'AGREEMENT', 'NO_AGREEMENT', 'ARCHIVED']),
  idempotencia: uuid,
})

export async function cambiarEstadoExpediente(datos: z.input<typeof esquemaEstado>): Promise<Resultado<object>> {
  const entrada = esquemaEstado.safeParse(datos)
  if (!entrada.success) {
    return invalido(entrada.error)
  }
  const d = entrada.data
  return conSesion(async (sesion) => {
    await clientes().expedientes.casos.changeCaseStatus(
      { caseId: d.casoId, status: CaseStatus[d.estado], idempotencyKey: d.idempotencia },
      comoPersona(sesion.tokenAcceso),
    )
    return { ok: true }
  })
}

const esquemaInvitacion = z
  .object({
    casoId: uuid,
    correo,
    nombre: z.string().trim().min(2, { error: 'Escribe al menos 2 caracteres' }).max(120),
    rol: z.enum(['CONCILIATOR', 'ASSISTANT', 'PARTY']),
    lado: z.enum(['CLAIMANT', 'RESPONDENT']).optional(),
    calidad: z.enum(['PRINCIPAL', 'ATTORNEY']).optional(),
    idempotencia: uuid,
  })
  .refine((d) => (d.rol === 'PARTY') === (d.lado !== undefined && d.calidad !== undefined), {
    error: 'Las partes necesitan lado y calidad; los demás roles no',
    path: ['lado'],
  })

export async function invitarParticipante(datos: z.input<typeof esquemaInvitacion>): Promise<Resultado<object>> {
  const entrada = esquemaInvitacion.safeParse(datos)
  if (!entrada.success) {
    return invalido(entrada.error)
  }
  const d = entrada.data
  return conSesion(async (sesion) => {
    await clientes().expedientes.participantes.inviteParticipant(
      {
        caseId: d.casoId,
        email: d.correo,
        displayName: d.nombre,
        role: CaseRole[d.rol],
        side: d.lado ? PartySide[d.lado] : PartySide.UNSPECIFIED,
        capacity: d.calidad ? PartyCapacity[d.calidad] : PartyCapacity.UNSPECIFIED,
        idempotencyKey: d.idempotencia,
      },
      comoPersona(sesion.tokenAcceso),
    )
    return { ok: true }
  })
}

const esquemaPersona = z.object({ casoId: uuid, participanteId: uuid })

type ClavePublica = { idClave: string; publica: string; huella: string }

/**
 * Clave publica del participante, para envolverle la clave del caso en el navegador. Se comprueba
 * que la persona este en el caso antes de pedir su clave a identity.
 */
export async function clavePublicaParticipante(
  datos: z.input<typeof esquemaPersona>,
): Promise<Resultado<ClavePublica>> {
  const entrada = esquemaPersona.safeParse(datos)
  if (!entrada.success) {
    return invalido(entrada.error)
  }
  const d = entrada.data
  return conSesion<ClavePublica>(async (sesion) => {
    const { participants } = await clientes().expedientes.participantes.listParticipants(
      { caseId: d.casoId },
      comoPersona(sesion.tokenAcceso),
    )
    const persona = participants.find((p) => p.id === d.participanteId)
    if (!persona?.accountId) {
      return { ok: false, mensaje: 'Esa persona aún no ha entrado con su cuenta.' }
    }
    const clave = await clavePublicaDe(sesion, persona.accountId)
    if (!clave) {
      return { ok: false, mensaje: 'No se encontró la clave pública de esa persona.' }
    }
    return { ok: true, ...clave }
  })
}

const esquemaEntrega = esquemaPersona.extend({ clave: esquemaEnvoltura })

export async function entregarClave(datos: z.input<typeof esquemaEntrega>): Promise<Resultado<object>> {
  const entrada = esquemaEntrega.safeParse(datos)
  if (!entrada.success) {
    return invalido(entrada.error)
  }
  const d = entrada.data
  return conSesion(async (sesion) => {
    await clientes().expedientes.participantes.grantCaseKey(
      { caseId: d.casoId, participantId: d.participanteId, wrappedCaseKey: envolturaContrato(d.clave) },
      comoPersona(sesion.tokenAcceso),
    )
    return { ok: true }
  })
}

const esquemaRol = esquemaPersona.extend({ rol: z.enum(['CONCILIATOR', 'ASSISTANT']) })

export async function cambiarRolParticipante(datos: z.input<typeof esquemaRol>): Promise<Resultado<object>> {
  const entrada = esquemaRol.safeParse(datos)
  if (!entrada.success) {
    return invalido(entrada.error)
  }
  const d = entrada.data
  return conSesion(async (sesion) => {
    await clientes().expedientes.participantes.changeParticipantRole(
      { caseId: d.casoId, participantId: d.participanteId, role: CaseRole[d.rol] },
      comoPersona(sesion.tokenAcceso),
    )
    return { ok: true }
  })
}

export async function retirarParticipante(datos: z.input<typeof esquemaPersona>): Promise<Resultado<object>> {
  const entrada = esquemaPersona.safeParse(datos)
  if (!entrada.success) {
    return invalido(entrada.error)
  }
  const d = entrada.data
  return conSesion(async (sesion) => {
    await clientes().expedientes.participantes.removeParticipant(
      { caseId: d.casoId, participantId: d.participanteId },
      comoPersona(sesion.tokenAcceso),
    )
    return { ok: true }
  })
}
