import 'server-only'
import { Code, ConnectError } from '@connectrpc/connect'
import { fallo, type Fallo } from '@/lib/rpc/errores'

/** Mensajes para el acta: los de legal-case ya estan pensados para mostrarse (sin datos internos). */
export function falloActa(error: unknown): Fallo {
  if (error instanceof ConnectError) {
    switch (error.code) {
      case Code.NotFound:
        return { ok: false, mensaje: 'El acta no existe o no participas en el expediente.' }
      case Code.Unauthenticated:
        return { ok: false, mensaje: 'El código no es válido o ya se usó. Espera el siguiente código de tu app y vuelve a intentarlo.' }
      case Code.FailedPrecondition:
      case Code.AlreadyExists:
      case Code.PermissionDenied:
        return { ok: false, mensaje: `${error.rawMessage}.` }
      default:
        break
    }
  }
  return fallo(error)
}
