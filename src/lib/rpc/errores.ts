import 'server-only'
import { Code, ConnectError } from '@connectrpc/connect'
import { FieldViolationsSchema } from '@/gen/actaflow/common/v1/errors_pb'
import { ServicioNoDisponibleError } from './clientes'

/**
 * Traduce los errores gRPC a mensajes para personas. Nunca devuelve trazas, URLs ni detalles
 * internos: solo lo que la persona puede corregir.
 */

export type Fallo = { ok: false; mensaje: string; campos?: Record<string, string> }

/** Nombres de campo del contrato -> campo del formulario. */
const CAMPOS: Record<string, string> = {
  email: 'correo',
  display_name: 'nombre',
  invitation_token: 'invitacion',
  totp_code: 'codigo',
  recovery_code: 'codigo',
}

export function campos(error: ConnectError): Record<string, string> | undefined {
  const resultado: Record<string, string> = {}
  for (const detalle of error.findDetails(FieldViolationsSchema)) {
    for (const violacion of detalle.violations) {
      const campo = CAMPOS[violacion.field]
      if (campo) {
        resultado[campo] = 'Revisa este campo'
      }
    }
  }
  return Object.keys(resultado).length > 0 ? resultado : undefined
}

export function fallo(error: unknown, porCodigo: Partial<Record<Code, string>> = {}): Fallo {
  if (error instanceof ServicioNoDisponibleError) {
    return { ok: false, mensaje: 'El servicio de identidad está despertando. Intenta de nuevo en un momento.' }
  }
  if (error instanceof ConnectError) {
    const propio = porCodigo[error.code]
    if (propio) {
      return { ok: false, mensaje: propio, campos: campos(error) }
    }
    switch (error.code) {
      case Code.InvalidArgument:
        return { ok: false, mensaje: 'Hay datos que no cumplen el formato esperado.', campos: campos(error) }
      case Code.Unauthenticated:
        return { ok: false, mensaje: 'Tu sesión venció. Vuelve a ingresar.' }
      case Code.PermissionDenied:
        return { ok: false, mensaje: 'Tu cuenta no tiene permiso para esto.' }
      case Code.Unavailable:
      case Code.DeadlineExceeded:
        return { ok: false, mensaje: 'El servicio no respondió a tiempo. Intenta de nuevo.' }
      default:
        break
    }
  }
  console.error('Error inesperado en una Server Action', error)
  return { ok: false, mensaje: 'Algo salió mal. Intenta de nuevo.' }
}

/**
 * Reglas de negocio de expedientes: los mensajes de legal-case-service ya estan pensados para mostrarse
 * (no llevan datos internos), asi que se muestran tal cual. Un caso ajeno se ve igual que uno inexistente.
 */
export function falloExpediente(error: unknown): Fallo {
  if (error instanceof ConnectError) {
    switch (error.code) {
      case Code.NotFound:
        return { ok: false, mensaje: 'El expediente no existe o no participas en él.' }
      case Code.Aborted:
        return {
          ok: false,
          mensaje: 'Alguien más cambió el expediente mientras editabas. Recarga y vuelve a intentarlo.',
        }
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
