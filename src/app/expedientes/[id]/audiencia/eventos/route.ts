import { WatchHearingEventsResponseSchema } from '@/gen/actaflow/hearings/v1/hearing_pb'
import { falloAudiencia } from '@/lib/audiencias/errores'
import { aTexto, UUID } from '@/lib/audiencias/protocolo'
import { clientes, comoPersona, sesionActual } from '@/lib/sesion/sesion'

/**
 * Eventos en vivo de una audiencia: reenvia el streaming de legal-case (WatchHearingEvents) al
 * navegador como NDJSON, una linea por evento ({"e": mensaje del contrato en base64url}). El flujo
 * dura a lo sumo ~50 s (lo cierra legal-case por la pasarela gRPC-Web) y termina con {"fin": true}:
 * el navegador vuelve a pedirlo desde el ultimo evento que recibio, sin perder ninguno.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DIGITOS = /^[0-9]{1,18}$/
const codificador = new TextEncoder()
const linea = (valor: object) => codificador.encode(`${JSON.stringify(valor)}\n`)

export async function GET(peticion: Request): Promise<Response> {
  const parametros = new URL(peticion.url).searchParams
  const audienciaId = parametros.get('audiencia') ?? ''
  const despues = parametros.get('despues') ?? '0'
  if (!UUID.test(audienciaId) || !DIGITOS.test(despues)) {
    return Response.json({ ok: false, mensaje: 'Parámetros no válidos.' }, { status: 400 })
  }
  const sesion = await sesionActual().catch(() => null)
  if (!sesion) {
    return Response.json({ ok: false, mensaje: 'Tu sesión venció.' }, { status: 401 })
  }

  const corte = new AbortController()
  peticion.signal.addEventListener('abort', () => corte.abort())
  const eventos = clientes().expedientes.audiencias.watchHearingEvents(
    { hearingId: audienciaId, afterEventSequence: BigInt(despues) },
    { ...comoPersona(sesion.tokenAcceso), signal: corte.signal, timeoutMs: 58_000 },
  )

  const cuerpo = new ReadableStream<Uint8Array>({
    async start(salida) {
      try {
        for await (const evento of eventos) {
          salida.enqueue(linea({ e: aTexto(WatchHearingEventsResponseSchema, evento) }))
        }
        salida.enqueue(linea({ fin: true }))
      } catch (error) {
        if (!corte.signal.aborted) {
          salida.enqueue(linea({ error: falloAudiencia(error).mensaje }))
        }
      } finally {
        try {
          salida.close()
        } catch {
          // El navegador ya cerro la conexion.
        }
      }
    },
    cancel() {
      corte.abort()
    },
  })

  return new Response(cuerpo, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  })
}
