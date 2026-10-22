import { fromBinary } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { AudioSegmentSchema, SubmitAudioSegmentRequestSchema } from '@/gen/actaflow/hearings/v1/hearing_pb'
import { falloAudiencia } from '@/lib/audiencias/errores'
import { aTexto, UUID } from '@/lib/audiencias/protocolo'
import { clientes, comoPersona, sesionActual } from '@/lib/sesion/sesion'

/**
 * Recibe una intervencion de la sala: un SubmitAudioSegmentRequest binario con el audio YA SELLADO
 * para el motor (el BFF no puede oirlo). Va por aqui y no por una Server Action porque 30 s de WAV
 * pasan del tope de 1 MB de las Server Actions.
 *
 * Solo acepta `application/x-protobuf` del mismo origen: otro sitio no puede mandar ese tipo sin una
 * consulta previa de CORS, que este endpoint no autoriza.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** 30 s de WAV a 16 kHz son ~960 KB; el sobre agrega poco. */
const MAX_BYTES = 2_000_000

const responder = (cuerpo: object, estado = 200) =>
  Response.json(cuerpo, { status: estado, headers: { 'cache-control': 'no-store' } })

export async function POST(peticion: Request): Promise<Response> {
  const origen = peticion.headers.get('origin')
  if (origen && origen !== new URL(peticion.url).origin) {
    return responder({ ok: false, mensaje: 'Origen no permitido.' }, 403)
  }
  if (peticion.headers.get('content-type') !== 'application/x-protobuf') {
    return responder({ ok: false, mensaje: 'Formato no admitido.' }, 415)
  }
  if (Number(peticion.headers.get('content-length') ?? 0) > MAX_BYTES) {
    return responder({ ok: false, mensaje: 'La intervención es demasiado grande.' }, 413)
  }
  const sesion = await sesionActual().catch(() => null)
  if (!sesion) {
    return responder({ ok: false, mensaje: 'Tu sesión venció. Recarga la página para volver a ingresar.' }, 401)
  }
  const cuerpo = new Uint8Array(await peticion.arrayBuffer())
  if (cuerpo.length === 0 || cuerpo.length > MAX_BYTES) {
    return responder({ ok: false, mensaje: 'La intervención es demasiado grande.' }, 413)
  }
  let segmento
  try {
    segmento = fromBinary(SubmitAudioSegmentRequestSchema, cuerpo)
  } catch {
    return responder({ ok: false, mensaje: 'El navegador envió datos con un formato inesperado.' }, 400)
  }
  const valido =
    UUID.test(segmento.hearingId) &&
    UUID.test(segmento.segmentId) &&
    UUID.test(segmento.speakerParticipantId) &&
    segmento.sequence >= 0 &&
    segmento.durationMs > 0n &&
    segmento.durationMs <= 30_000n &&
    Boolean(segmento.audio?.payload && segmento.audio.processorKey && segmento.audio.contentKeyForCase)
  if (!valido) {
    return responder({ ok: false, mensaje: 'El navegador envió datos con un formato inesperado.' }, 400)
  }
  try {
    const { segment } = await clientes().expedientes.audiencias.submitAudioSegment(
      segmento,
      comoPersona(sesion.tokenAcceso),
    )
    return responder({ ok: true, segmento: segment ? aTexto(AudioSegmentSchema, segment) : null })
  } catch (error) {
    // Otro dispositivo ya uso ese numero de orden: el navegador reintenta con el siguiente.
    if (error instanceof ConnectError && error.code === Code.AlreadyExists) {
      return responder({ ...falloAudiencia(error), codigo: 'ya-existe' }, 409)
    }
    return responder(falloAudiencia(error), 422)
  }
}
