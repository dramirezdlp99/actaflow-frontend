import { toBinary } from '@bufbuild/protobuf'
import { Code, ConnectError } from '@connectrpc/connect'
import { GetDocumentStateResponseSchema } from '@/gen/actaflow/collaboration/v1/collaboration_pb'
import { falloActa } from '@/lib/actas/errores'
import { UUID } from '@/lib/audiencias/protocolo'
import { buffer } from '@/lib/cripto/bytes'
import { clientes, comoPersona, sesionActual } from '@/lib/sesion/sesion'

/**
 * Estado del borrador colaborativo (GetDocumentState) como bytes protobuf. Lo consulta el Shared
 * Worker de tiempo real: una sola consulta por navegador, compartida por todas sus pestanas. Es un
 * GET de solo lectura y sin efectos; los cambios se envian por Server Action (enviarBorrador).
 */

export const dynamic = 'force-dynamic'

const DIGITOS = /^[0-9]{1,18}$/
const DEFINITIVOS = new Set([Code.FailedPrecondition, Code.PermissionDenied, Code.NotFound, Code.InvalidArgument])

export async function GET(peticion: Request): Promise<Response> {
  const parametros = new URL(peticion.url).searchParams
  const actaId = parametros.get('acta') ?? ''
  const despues = parametros.get('despues') ?? '0'
  if (!UUID.test(actaId) || !DIGITOS.test(despues)) {
    return Response.json({ mensaje: 'Parámetros no válidos.', definitivo: true }, { status: 400 })
  }
  const sesion = await sesionActual().catch(() => null)
  if (!sesion) {
    return Response.json({ mensaje: 'Tu sesión venció. Recarga la página.', definitivo: false }, { status: 401 })
  }
  try {
    const r = await clientes().expedientes.colaboracion.getDocumentState(
      { minuteId: actaId, afterSequence: BigInt(despues) },
      comoPersona(sesion.tokenAcceso),
    )
    return new Response(buffer(toBinary(GetDocumentStateResponseSchema, r)), {
      headers: { 'content-type': 'application/x-protobuf', 'cache-control': 'no-store' },
    })
  } catch (error) {
    const definitivo = error instanceof ConnectError && DEFINITIVOS.has(error.code)
    return Response.json({ mensaje: falloActa(error).mensaje, definitivo }, { status: definitivo ? 409 : 503 })
  }
}
