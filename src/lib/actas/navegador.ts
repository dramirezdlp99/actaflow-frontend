import { create, toBinary } from '@bufbuild/protobuf'
import {
  CloseMinuteRequestSchema,
  FinalContentSchema,
  type CloseMinuteRequest,
  type FinalDocument,
} from '@/gen/actaflow/minutes/v1/minute_pb'
import type { Contexto } from '@/lib/audiencias/navegador'
import { abrirClaveContenido, abrirPdf, PROPOSITO, sellar, TIPO, type ClaveMotor } from '@/lib/audiencias/sellado'
import { aHex, buffer } from '@/lib/cripto/bytes'

/**
 * El acta en el navegador: al cerrarla, su contenido final se sella para el motor de IA (que genera
 * el PDF sin que legal-case lo vea); al recibir el documento final, el PDF se descifra aqui y su
 * SHA-256 se compara con el del sello. Sin React ni DOM: se prueba en Node.
 */

export async function prepararCierre(
  c: Contexto & { motor: ClaveMotor; actaId: string; titulo: string; html: string },
): Promise<CloseMinuteRequest> {
  const datos = toBinary(FinalContentSchema, create(FinalContentSchema, { title: c.titulo.slice(0, 200), html: c.html }))
  const finalContent = await sellar({
    claveCaso: c.claveCaso,
    idClaveCaso: c.idClaveCaso,
    motor: c.motor,
    proposito: PROPOSITO.actaFinal,
    casoId: c.casoId,
    recursoId: c.actaId,
    datos,
    tipo: TIPO.actaFinal,
  })
  return create(CloseMinuteRequestSchema, {
    minuteId: c.actaId,
    finalContent,
    idempotencyKey: globalThis.crypto.randomUUID(),
  })
}

export async function sha256Hex(datos: Uint8Array): Promise<string> {
  return aHex(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', buffer(datos))))
}

export type PdfAbierto = { pdf: Uint8Array; sha256: string; coincide: boolean }

/** Descifra el PDF con la clave del caso y comprueba que es exactamente el que se sello. */
export async function abrirDocumento(c: Contexto, d: FinalDocument): Promise<PdfAbierto> {
  if (!d.contentKeyForCase || !d.pdf) {
    throw new Error('Documento incompleto')
  }
  const contenido = await abrirClaveContenido(c.claveCaso, d.contentKeyForCase, c.casoId, d.minuteId)
  const pdf = await abrirPdf(contenido, d.pdf, c.casoId, d.minuteId)
  const sha256 = await sha256Hex(pdf)
  return { pdf, sha256, coincide: sha256 === d.seal?.sha256Hex }
}

/** Proposito de la prueba de presencia para aceptar ESTE documento (lo comprueba legal-case). */
export const propositoAceptar = (documentoId: string, sha256: string) => `accept-minute:${documentoId}:${sha256}`
