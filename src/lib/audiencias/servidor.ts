import 'server-only'
import { Code, ConnectError } from '@connectrpc/connect'
import {
  AudioSegmentSchema,
  EntityExtractionSchema,
  HearingSchema,
  HearingState,
} from '@/gen/actaflow/hearings/v1/hearing_pb'
import { clientes, comoPersona, type SesionActual } from '@/lib/sesion/sesion'
import { aTexto } from './protocolo'

export type EstadoSala = { audiencia: string | null; segmentos: string[]; extraccion: string | null }

/** La audiencia en curso (o la ultima), sus segmentos y su extraccion, para el primer render. */
export async function estadoSala(sesion: SesionActual, casoId: string): Promise<EstadoSala> {
  const servicio = clientes().expedientes.audiencias
  const como = comoPersona(sesion.tokenAcceso)
  const { hearings } = await servicio.listHearings({ caseId: casoId }, como)
  const actual = hearings.find((h) => h.state === HearingState.IN_PROGRESS) ?? hearings[0]
  if (!actual) {
    return { audiencia: null, segmentos: [], extraccion: null }
  }
  const [{ segments }, extraccion] = await Promise.all([
    servicio.listSegments({ hearingId: actual.id, afterSequence: -1 }, como),
    servicio.getEntityExtraction({ hearingId: actual.id }, como).then(
      (r) => r.extraction ?? null,
      (error: unknown) => {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          return null
        }
        throw error
      },
    ),
  ])
  return {
    audiencia: aTexto(HearingSchema, actual),
    segmentos: segments.map((s) => aTexto(AudioSegmentSchema, s)),
    extraccion: extraccion ? aTexto(EntityExtractionSchema, extraccion) : null,
  }
}
