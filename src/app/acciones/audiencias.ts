'use server'

import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { z } from 'zod'
import { ProcessorKind } from '@/gen/actaflow/crypto/v1/crypto_pb'
import {
  ConfirmEntitiesRequestSchema,
  EntityExtractionSchema,
  HearingSchema,
  RequestEntityExtractionRequestSchema,
  type EntityExtraction,
} from '@/gen/actaflow/hearings/v1/hearing_pb'
import { aTexto, desdeTexto, UUID } from '@/lib/audiencias/protocolo'
import { aBase64Url } from '@/lib/cripto/bytes'
import { conDespertar } from '@/lib/rpc/clientes'
import { falloAudiencia } from '@/lib/audiencias/errores'
import type { Fallo } from '@/lib/rpc/errores'
import { clientes, comoPersona, sesionActual, type SesionActual } from '@/lib/sesion/sesion'

/**
 * Server Actions de la sala de audiencia. Lo que llega del navegador son mensajes del contrato en
 * base64url (con el audio y los textos ya sellados o cifrados): aqui se decodifican, se comprueba
 * que sean lo que dicen ser y se reenvian a legal-case con el token de la persona.
 */

type Resultado<T> = ({ ok: true } & T) | Fallo

/** Tope de un mensaje que llega por Server Action (la transcripcion de una audiencia larga). */
const MAX_TEXTO = 900_000
const texto = z.string().min(1).max(MAX_TEXTO)
const id = z.string().regex(UUID)

async function conSesion<T>(trabajo: (sesion: SesionActual) => Promise<Resultado<T>>): Promise<Resultado<T>> {
  const sesion = await sesionActual().catch(() => null)
  if (!sesion) {
    return { ok: false, mensaje: 'Tu sesión venció. Recarga la página para volver a ingresar.' }
  }
  try {
    return await trabajo(sesion)
  } catch (error) {
    return falloAudiencia(error)
  }
}

/** Para mensajes que no se pudieron decodificar: no se reenvia nada. */
const malFormado: Fallo = { ok: false, mensaje: 'El navegador envió datos con un formato inesperado.' }

/** Clave publica del motor de IA. Puede tardar si el motor estaba dormido en Render. */
export async function claveMotor(): Promise<Resultado<{ idClave: string; publica: string }>> {
  return conSesion<{ idClave: string; publica: string }>(async (sesion) => {
    const { keys } = await conDespertar(
      (timeoutMs) => clientes().expedientes.clavesMotor.getProcessorKeys({}, { ...comoPersona(sesion.tokenAcceso), timeoutMs }),
      120_000,
    )
    const clave = keys.find((k) => k.kind === ProcessorKind.AI_ENGINE)?.key
    if (!clave || clave.publicKey.length !== 65 || clave.publicKey[0] !== 0x04) {
      return { ok: false, mensaje: 'El motor de IA no publicó una clave válida.' }
    }
    return { ok: true, idClave: clave.keyId, publica: aBase64Url(clave.publicKey) }
  })
}

export async function iniciarAudiencia(datos: { casoId: string; idempotencia: string }) {
  const entrada = z.object({ casoId: id, idempotencia: id }).safeParse(datos)
  if (!entrada.success) {
    return malFormado
  }
  return conSesion<{ audiencia: string }>(async (sesion) => {
    const { hearing } = await clientes().expedientes.audiencias.startHearing(
      { caseId: entrada.data.casoId, idempotencyKey: entrada.data.idempotencia },
      comoPersona(sesion.tokenAcceso),
    )
    return { ok: true, audiencia: aTexto(HearingSchema, hearing ?? create(HearingSchema)) }
  })
}

export async function terminarAudiencia(datos: { audienciaId: string }) {
  const entrada = z.object({ audienciaId: id }).safeParse(datos)
  if (!entrada.success) {
    return malFormado
  }
  return conSesion<{ audiencia: string }>(async (sesion) => {
    const { hearing } = await clientes().expedientes.audiencias.endHearing(
      { hearingId: entrada.data.audienciaId },
      comoPersona(sesion.tokenAcceso),
    )
    return { ok: true, audiencia: aTexto(HearingSchema, hearing ?? create(HearingSchema)) }
  })
}

export async function pedirExtraccion(datos: { peticion: string }) {
  const entrada = texto.safeParse(datos.peticion)
  if (!entrada.success) {
    return malFormado
  }
  let peticion
  try {
    peticion = desdeTexto(RequestEntityExtractionRequestSchema, entrada.data)
  } catch {
    return malFormado
  }
  if (!UUID.test(peticion.hearingId) || !UUID.test(peticion.extractionId) || !peticion.input) {
    return malFormado
  }
  return conSesion<{ extraccion: string }>(async (sesion) => {
    const { extraction } = await clientes().expedientes.audiencias.requestEntityExtraction(
      peticion,
      comoPersona(sesion.tokenAcceso),
    )
    return { ok: true, extraccion: extraccionTexto(extraction) }
  })
}

export async function confirmarEntidades(datos: { peticion: string }) {
  const entrada = texto.safeParse(datos.peticion)
  if (!entrada.success) {
    return malFormado
  }
  let peticion
  try {
    peticion = desdeTexto(ConfirmEntitiesRequestSchema, entrada.data)
  } catch {
    return malFormado
  }
  if (!UUID.test(peticion.extractionId) || !peticion.reviewed) {
    return malFormado
  }
  return conSesion<{ extraccion: string }>(async (sesion) => {
    const { extraction } = await clientes().expedientes.audiencias.confirmEntities(
      peticion,
      comoPersona(sesion.tokenAcceso),
    )
    return { ok: true, extraccion: extraccionTexto(extraction) }
  })
}

/** La extraccion mas reciente (para recargar despues de un conflicto de revision). */
export async function ultimaExtraccion(datos: { audienciaId: string }) {
  const entrada = z.object({ audienciaId: id }).safeParse(datos)
  if (!entrada.success) {
    return malFormado
  }
  return conSesion<{ extraccion: string | null }>(async (sesion) => {
    try {
      const { extraction } = await clientes().expedientes.audiencias.getEntityExtraction(
        { hearingId: entrada.data.audienciaId },
        comoPersona(sesion.tokenAcceso),
      )
      return { ok: true, extraccion: extraccionTexto(extraction) }
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return { ok: true, extraccion: null }
      }
      throw error
    }
  })
}

function extraccionTexto(extraccion: EntityExtraction | undefined): string {
  return aTexto(EntityExtractionSchema, extraccion ?? create(EntityExtractionSchema))
}
