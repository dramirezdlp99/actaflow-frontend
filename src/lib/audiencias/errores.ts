import 'server-only'
import { Code, ConnectError } from '@connectrpc/connect'
import { fallo, type Fallo } from '@/lib/rpc/errores'

/** Mensajes para la sala: los de legal-case ya estan pensados para mostrarse (sin datos internos). */
export function falloAudiencia(error: unknown): Fallo {
  if (error instanceof ConnectError) {
    switch (error.code) {
      case Code.NotFound:
        return { ok: false, mensaje: 'La audiencia no existe o no participas en el expediente.' }
      case Code.Aborted:
        return { ok: false, mensaje: 'Alguien más guardó la revisión antes que tú. Se cargó la versión nueva.' }
      case Code.FailedPrecondition:
      case Code.AlreadyExists:
      case Code.PermissionDenied:
        return { ok: false, mensaje: `${error.rawMessage}.` }
      case Code.Unavailable:
        return { ok: false, mensaje: 'El motor de IA está despertando. Intenta de nuevo en un minuto.' }
      default:
        break
    }
  }
  return fallo(error)
}
