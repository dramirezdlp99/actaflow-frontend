'use server'

import { create } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { z } from 'zod'
import {
  CloseMinuteRequestSchema,
  FinalDocumentSchema,
  MinuteSchema,
  type FinalDocument,
  type Minute,
} from '@/gen/actaflow/minutes/v1/minute_pb'
import { falloActa } from '@/lib/actas/errores'
import { aTexto, desdeTexto, UUID } from '@/lib/audiencias/protocolo'
import type { Fallo } from '@/lib/rpc/errores'
import { clientes, comoPersona, sesionActual, type SesionActual } from '@/lib/sesion/sesion'

/**
 * Server Actions del acta. Lo que llega del navegador ya viene sellado (el contenido final, para el
 * motor) o es publico (el SHA-256 del PDF). La aceptacion pide primero a identity la prueba de
 * presencia con el codigo TOTP y se la entrega a legal-case.
 */

type Resultado<T> = ({ ok: true } & T) | Fallo

const id = z.string().regex(UUID)
const SHA256 = /^[0-9a-f]{64}$/
const malFormado: Fallo = { ok: false, mensaje: 'El navegador envió datos con un formato inesperado.' }

async function conSesion<T>(trabajo: (sesion: SesionActual) => Promise<Resultado<T>>): Promise<Resultado<T>> {
  const sesion = await sesionActual().catch(() => null)
  if (!sesion) {
    return { ok: false, mensaje: 'Tu sesión venció. Recarga la página para volver a ingresar.' }
  }
  try {
    return await trabajo(sesion)
  } catch (error) {
    return falloActa(error)
  }
}

const actaTexto = (m: Minute | undefined) => aTexto(MinuteSchema, m ?? create(MinuteSchema))
const documentoTexto = (d: FinalDocument | undefined) => aTexto(FinalDocumentSchema, d ?? create(FinalDocumentSchema))

export async function crearActa(datos: { casoId: string; plantillaId: string; version: number; idempotencia: string }) {
  const entrada = z
    .object({ casoId: id, plantillaId: id, version: z.number().int().min(1), idempotencia: id })
    .safeParse(datos)
  if (!entrada.success) {
    return malFormado
  }
  const d = entrada.data
  return conSesion<{ acta: string }>(async (sesion) => {
    const { minute } = await clientes().expedientes.actas.createMinute(
      { caseId: d.casoId, templateId: d.plantillaId, templateVersion: d.version, idempotencyKey: d.idempotencia },
      comoPersona(sesion.tokenAcceso),
    )
    return { ok: true, acta: actaTexto(minute) }
  })
}

export async function obtenerActa(datos: { actaId: string }) {
  const entrada = z.object({ actaId: id }).safeParse(datos)
  if (!entrada.success) {
    return malFormado
  }
  return conSesion<{ acta: string }>(async (sesion) => {
    const { minute } = await clientes().expedientes.actas.getMinute(
      { minuteId: entrada.data.actaId },
      comoPersona(sesion.tokenAcceso),
    )
    return { ok: true, acta: actaTexto(minute) }
  })
}

/** Cierra el acta con su contenido final YA SELLADO para el motor (CloseMinuteRequest en base64url). */
export async function cerrarActa(datos: { peticion: string }) {
  const entrada = z.string().min(1).max(900_000).safeParse(datos.peticion)
  if (!entrada.success) {
    return malFormado
  }
  let peticion
  try {
    peticion = desdeTexto(CloseMinuteRequestSchema, entrada.data)
  } catch {
    return malFormado
  }
  const f = peticion.finalContent
  if (!UUID.test(peticion.minuteId) || !UUID.test(peticion.idempotencyKey) || !f?.payload || !f.processorKey) {
    return malFormado
  }
  return conSesion<{ acta: string }>(async (sesion) => {
    const { minute } = await clientes().expedientes.actas.closeMinute(peticion, comoPersona(sesion.tokenAcceso))
    return { ok: true, acta: actaTexto(minute) }
  })
}

/** El documento final sellado (PDF cifrado); null mientras no exista. */
export async function documentoFinal(datos: { actaId: string }) {
  const entrada = z.object({ actaId: id }).safeParse(datos)
  if (!entrada.success) {
    return malFormado
  }
  return conSesion<{ documento: string | null }>(async (sesion) => {
    try {
      const { document } = await clientes().expedientes.actas.getFinalDocument(
        { minuteId: entrada.data.actaId },
        comoPersona(sesion.tokenAcceso),
      )
      return { ok: true, documento: documentoTexto(document) }
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        return { ok: true, documento: null }
      }
      throw error
    }
  })
}

/**
 * Una parte acepta el PDF que descifro y leyo (su SHA-256): identity comprueba el codigo TOTP y
 * firma una prueba de presencia para ESTE documento; legal-case la exige para registrar la aceptacion.
 */
export async function aceptarActa(datos: { documentoId: string; sha256: string; codigo: string }) {
  const entrada = z
    .object({ documentoId: id, sha256: z.string().regex(SHA256), codigo: z.string().regex(/^[0-9]{6}$/) })
    .safeParse(datos)
  if (!entrada.success) {
    return { ok: false, mensaje: 'Escribe los 6 dígitos de tu app autenticadora.' } satisfies Fallo
  }
  const d = entrada.data
  return conSesion<{ documento: string }>(async (sesion) => {
    const { presenceToken } = await clientes().identidad.auth.confirmPresence(
      { totpCode: d.codigo, purpose: `accept-minute:${d.documentoId}:${d.sha256}` },
      comoPersona(sesion.tokenAcceso),
    )
    const { document } = await clientes().expedientes.actas.acceptFinalDocument(
      { documentId: d.documentoId, sha256Hex: d.sha256, totpCode: d.codigo, presenceToken },
      comoPersona(sesion.tokenAcceso),
    )
    return { ok: true, documento: documentoTexto(document) }
  })
}

export type Verificacion = {
  autentico: boolean
  radicado: string
  aceptaciones: number
  selladoEn: string | null
  firmante: string
  huellaCertificado: string
}

/** Publico (sin sesion): ¿este SHA-256 corresponde a un acta sellada por ActaFlow? */
export async function verificarDocumento(datos: { sha256: string }): Promise<Resultado<Verificacion>> {
  if (!SHA256.test(datos.sha256)) {
    return malFormado
  }
  try {
    const r = await clientes().expedientes.actas.verifyDocument({ sha256Hex: datos.sha256 })
    const segundos = r.seal?.sealedAt?.seconds
    return {
      ok: true,
      autentico: r.authentic,
      radicado: r.caseNumber,
      aceptaciones: r.acceptanceCount,
      selladoEn: segundos ? new Date(Number(segundos) * 1000).toISOString() : null,
      firmante: r.seal?.signerSubject ?? '',
      huellaCertificado: r.seal?.certificateFingerprintSha256 ?? '',
    }
  } catch (error) {
    return falloActa(error)
  }
}
