import 'server-only'
import { Code, ConnectError } from '@connectrpc/connect'
import { FinalDocumentSchema, MinuteSchema, MinuteState } from '@/gen/actaflow/minutes/v1/minute_pb'
import { aTexto } from '@/lib/audiencias/protocolo'
import { clientes, comoPersona, type SesionActual } from '@/lib/sesion/sesion'

export type OpcionPlantilla = { id: string; version: number; titulo: string }

export type EstadoActa = {
  /** Minute en base64url (la mas reciente), o null si el caso aun no tiene acta. */
  acta: string | null
  /** Fuente de la version de plantilla que fijo el acta (publica, sin datos del caso). */
  fuente: string
  tituloPlantilla: string
  /** FinalDocument en base64url cuando ya hay PDF sellado. */
  documento: string | null
  /** Plantillas publicadas para crear el acta. */
  plantillas: OpcionPlantilla[]
}

const noEncontrado = (e: unknown) => e instanceof ConnectError && e.code === Code.NotFound

export async function estadoActa(sesion: SesionActual, casoId: string): Promise<EstadoActa> {
  const como = comoPersona(sesion.tokenAcceso)
  const { actas, plantillas } = clientes().expedientes
  const [{ minutes }, { templates }] = await Promise.all([
    actas.listMinutes({ caseId: casoId }, como),
    plantillas.listPublishedTemplates({ page: { pageSize: 50 } }),
  ])
  const opciones = templates.map((t) => ({ id: t.id, version: t.version, titulo: t.title }))
  const acta = minutes[0]
  if (!acta) {
    return { acta: null, fuente: '', tituloPlantilla: '', documento: null, plantillas: opciones }
  }
  const [{ template }, documento] = await Promise.all([
    plantillas.getTemplateVersion({ templateId: acta.templateId, version: acta.templateVersion }, como),
    acta.state === MinuteState.AWAITING_ACCEPTANCE || acta.state === MinuteState.FINAL
      ? actas.getFinalDocument({ minuteId: acta.id }, como).then(
          (r) => r.document ?? null,
          (e: unknown) => {
            if (noEncontrado(e)) return null
            throw e
          },
        )
      : Promise.resolve(null),
  ])
  return {
    acta: aTexto(MinuteSchema, acta),
    fuente: template?.source ?? '',
    tituloPlantilla: template?.title ?? '',
    documento: documento ? aTexto(FinalDocumentSchema, documento) : null,
    plantillas: opciones,
  }
}
