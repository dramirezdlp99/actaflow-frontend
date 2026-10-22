import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { CalendarDateSchema } from '@/gen/actaflow/common/v1/values_pb'
import {
  AudioEncoding,
  ExtractionInputSchema,
  KnownParticipantSchema,
  SealedAudioSegmentSchema,
} from '@/gen/actaflow/engine/v1/engine_pb'
import {
  ConfirmEntitiesRequestSchema,
  ProcessingState,
  RequestEntityExtractionRequestSchema,
  SubmitAudioSegmentRequestSchema,
  type AudioSegment,
  type ConfirmEntitiesRequest,
  type EntityExtraction,
  type RequestEntityExtractionRequest,
  type SubmitAudioSegmentRequest,
} from '@/gen/actaflow/hearings/v1/hearing_pb'
import { EntityExtractionResultSchema, type EntityExtractionResult } from '@/gen/actaflow/legal/v1/entities_pb'
import { TranscriptionResultSchema, type TranscriptionResult } from '@/gen/actaflow/legal/v1/transcript_pb'
import {
  abrirClaveContenido,
  abrirResultado,
  cifrarRevision,
  descifrarRevision,
  PROPOSITO,
  sellar,
  TIPO,
  type ClaveMotor,
} from './sellado'

/**
 * Lo que la sala hace en el navegador con los mensajes del contrato: sellar cada intervencion y la
 * transcripcion para el motor, y abrir lo que el motor devuelve. Sin React ni DOM: se prueba en Node.
 */

export type Contexto = { claveCaso: CryptoKey; idClaveCaso: string; casoId: string }
export type Persona = { id: string; nombre: string }

/** Tope del contrato para el texto que se manda a extraer. */
export const MAX_TEXTO_EXTRACCION = 200_000

export async function prepararSegmento(
  c: Contexto & {
    motor: ClaveMotor
    audienciaId: string
    secuencia: number
    hablanteId: string
    wav: Uint8Array
    duracionMs: number
    nombres: string[]
  },
): Promise<SubmitAudioSegmentRequest> {
  const segmentoId = globalThis.crypto.randomUUID()
  const claro = toBinary(
    SealedAudioSegmentSchema,
    create(SealedAudioSegmentSchema, {
      audio: c.wav,
      encoding: AudioEncoding.WAV_PCM16,
      speakerParticipantId: c.hablanteId,
      // Los nombres ayudan a Whisper a escribirlos bien; viajan sellados con el audio.
      hints: { names: c.nombres.filter(Boolean).slice(0, 30).map((n) => n.slice(0, 120)), vocabulary: [] },
    }),
  )
  const audio = await sellar({
    claveCaso: c.claveCaso,
    idClaveCaso: c.idClaveCaso,
    motor: c.motor,
    proposito: PROPOSITO.audio,
    casoId: c.casoId,
    recursoId: segmentoId,
    datos: claro,
    tipo: TIPO.audio,
  })
  return create(SubmitAudioSegmentRequestSchema, {
    hearingId: c.audienciaId,
    segmentId: segmentoId,
    sequence: c.secuencia,
    speakerParticipantId: c.hablanteId,
    durationMs: BigInt(Math.min(30_000, Math.max(1, Math.round(c.duracionMs)))),
    audio,
  })
}

/** null mientras el motor no termina (o si fallo). Lanza si el contenido no se puede abrir. */
export async function abrirTranscripcion(c: Contexto, segmento: AudioSegment): Promise<TranscriptionResult | null> {
  if (segmento.state !== ProcessingState.DONE || !segmento.transcript || !segmento.contentKeyForCase) {
    return null
  }
  const contenido = await abrirClaveContenido(c.claveCaso, segmento.contentKeyForCase, c.casoId, segmento.id)
  const claro = await abrirResultado(contenido, segmento.transcript, PROPOSITO.transcripcion, c.casoId, segmento.id)
  return fromBinary(TranscriptionResultSchema, claro)
}

/** Texto plano de una transcripcion, "Nombre: lo que dijo", en el orden de los segmentos. */
export function textoTranscripcion(
  partes: { hablanteId: string; resultado: TranscriptionResult }[],
  personas: Persona[],
): string {
  const nombre = new Map(personas.map((p) => [p.id, p.nombre]))
  return partes
    .map(({ hablanteId, resultado }) => {
      const dicho = resultado.segments
        .map((s) => s.text.trim())
        .filter(Boolean)
        .join(' ')
      return dicho ? `${nombre.get(hablanteId) ?? 'Participante'}: ${dicho}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

export async function prepararExtraccion(
  c: Contexto & { motor: ClaveMotor; audienciaId: string; texto: string; personas: Persona[]; hoy: Date },
): Promise<RequestEntityExtractionRequest> {
  const extraccionId = globalThis.crypto.randomUUID()
  const claro = toBinary(
    ExtractionInputSchema,
    create(ExtractionInputSchema, {
      text: c.texto.slice(0, MAX_TEXTO_EXTRACCION),
      referenceDate: create(CalendarDateSchema, {
        year: c.hoy.getFullYear(),
        month: c.hoy.getMonth() + 1,
        day: c.hoy.getDate(),
      }),
      participants: c.personas
        .slice(0, 30)
        .map((p) => create(KnownParticipantSchema, { participantId: p.id, displayName: p.nombre.slice(0, 120) })),
    }),
  )
  const input = await sellar({
    claveCaso: c.claveCaso,
    idClaveCaso: c.idClaveCaso,
    motor: c.motor,
    proposito: PROPOSITO.entrada,
    casoId: c.casoId,
    recursoId: extraccionId,
    datos: claro,
    tipo: TIPO.entrada,
  })
  return create(RequestEntityExtractionRequestSchema, { hearingId: c.audienciaId, extractionId: extraccionId, input })
}

export type EntidadesAbiertas = {
  propuesta: EntityExtractionResult | null
  revisada: EntityExtractionResult | null
}

export async function abrirEntidades(c: Contexto, x: EntityExtraction): Promise<EntidadesAbiertas> {
  let propuesta: EntityExtractionResult | null = null
  if (x.state === ProcessingState.DONE && x.proposed && x.contentKeyForCase) {
    const contenido = await abrirClaveContenido(c.claveCaso, x.contentKeyForCase, c.casoId, x.id)
    const claro = await abrirResultado(contenido, x.proposed, PROPOSITO.entidades, c.casoId, x.id)
    propuesta = fromBinary(EntityExtractionResultSchema, claro)
  }
  const revisada = x.reviewed
    ? fromBinary(EntityExtractionResultSchema, await descifrarRevision(c.claveCaso, x.reviewed, c.casoId, x.id))
    : null
  return { propuesta, revisada }
}

export async function prepararRevision(
  c: Contexto & { extraccion: EntityExtraction; resultado: EntityExtractionResult },
): Promise<ConfirmEntitiesRequest> {
  const reviewed = await cifrarRevision(
    c.claveCaso,
    c.idClaveCaso,
    c.casoId,
    c.extraccion.id,
    toBinary(EntityExtractionResultSchema, c.resultado),
  )
  return create(ConfirmEntitiesRequestSchema, {
    extractionId: c.extraccion.id,
    expectedRevision: c.extraccion.revision,
    reviewed,
  })
}
