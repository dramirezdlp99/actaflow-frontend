'use server'

import { create } from '@bufbuild/protobuf'
import { timestampMs } from '@bufbuild/protobuf/wkt'
import { Code } from '@connectrpc/connect'
import { cookies } from 'next/headers'
import { CipherSuite } from '@/gen/actaflow/crypto/v1/crypto_pb'
import { PlatformRole } from '@/gen/actaflow/identity/v1/account_pb'
import { RegisterRequestSchema, type Session } from '@/gen/actaflow/identity/v1/auth_pb'
import { aBase64Url } from '@/lib/cripto/bytes'
import { conDespertar } from '@/lib/rpc/clientes'
import { leerConfiguracion } from '@/lib/rpc/configuracion'
import { fallo, type Fallo } from '@/lib/rpc/errores'
import {
  camposConProblema,
  correo as esquemaCorreo,
  esquemaConfirmacion,
  esquemaIngreso,
  esquemaInvitacion,
  esquemaRegistro,
  esquemaSegundoFactor,
  type DatosInvitacion,
  type DatosRegistro,
  type DatosSegundoFactor,
} from '@/lib/sesion/esquemas'
import { borrarGalleta, borrarSesion, guardarSesion, nombres, opciones, segundosHasta } from '@/lib/sesion/galletas'
import { clientes, comoPersona } from '@/lib/sesion/sesion'

/**
 * Server Actions de identidad: el navegador llama FUNCIONES del BFF (RPC), y el BFF llama por gRPC a
 * identity-service. Los tokens nunca vuelven al navegador: quedan en cookies httpOnly.
 */

type Ok<T> = { ok: true } & T
type Resultado<T> = Ok<T> | Fallo

/** Clave privada cifrada tal como la necesita el navegador para abrirla con la contrasena. */
export type KitCifrado = { idClave: string; nonce: string; cifrado: string }

function kitParaNavegador(sesion: Session | undefined): KitCifrado | null {
  const blob = sesion?.keyKit?.privateKeyByPassword
  return blob ? { idClave: blob.keyId, nonce: aBase64Url(blob.nonce), cifrado: aBase64Url(blob.ciphertext) } : null
}

function invalido(error: Parameters<typeof camposConProblema>[0]): Fallo {
  return { ok: false, mensaje: 'Revisa los campos marcados.', campos: camposConProblema(error) }
}

const blobContrato = (blob: { idClave: string; nonce: Uint8Array; cifrado: Uint8Array }) => ({
  suite: CipherSuite.AES_256_GCM,
  keyId: blob.idClave,
  nonce: blob.nonce,
  ciphertext: blob.cifrado,
})

export async function registrarCuenta(
  datos: DatosRegistro,
): Promise<Resultado<{ inscripcion: string; secreto: string; uri: string }>> {
  const entrada = esquemaRegistro.safeParse(datos)
  if (!entrada.success) {
    return invalido(entrada.error)
  }
  const d = entrada.data
  try {
    const respuesta = await clientes().identidad.auth.register(
      create(RegisterRequestSchema, {
        invitationToken: d.invitacion,
        email: d.correo,
        displayName: d.nombre,
        kdf: { salt: d.sal, iterations: d.iteraciones },
        authVerifier: d.verificador,
        keyKit: {
          publicKey: {
            keyId: d.idClavePublica,
            algorithm: 'ECDH-P256',
            publicKey: d.clavePublica,
            fingerprintSha256: d.huella,
          },
          privateKeyByPassword: blobContrato(d.porContrasena),
          privateKeyByRecovery: blobContrato(d.porRecuperacion),
        },
        idempotencyKey: d.idempotencia,
      }),
    )
    const inscripcion = respuesta.totpEnrollment
    if (!inscripcion) {
      return { ok: false, mensaje: 'El servicio no devolvió la configuración del segundo factor.' }
    }
    return {
      ok: true,
      inscripcion: inscripcion.enrollmentId,
      secreto: inscripcion.secretBase32,
      uri: inscripcion.otpauthUri,
    }
  } catch (error) {
    // identity-service responde FAILED_PRECONDITION; el contrato documenta NOT_FOUND. Se aceptan los dos.
    const invitacionInvalida = 'La invitación no es válida: ya se usó, venció o es para otro correo.'
    return fallo(error, {
      [Code.NotFound]: invitacionInvalida,
      [Code.FailedPrecondition]: invitacionInvalida,
      [Code.AlreadyExists]: 'Ya existe una cuenta con ese correo. Ingresa con ella.',
    })
  }
}

export async function confirmarAlta(datos: {
  inscripcion: string
  codigo: string
}): Promise<Resultado<{ codigos: string[]; cuentaId: string; kit: KitCifrado | null }>> {
  const entrada = esquemaConfirmacion.safeParse(datos)
  if (!entrada.success) {
    return invalido(entrada.error)
  }
  try {
    const respuesta = await clientes().identidad.auth.confirmTotpEnrollment({
      enrollmentId: entrada.data.inscripcion,
      totpCode: entrada.data.codigo,
    })
    if (!respuesta.session) {
      return { ok: false, mensaje: 'El servicio no abrió la sesión.' }
    }
    guardarSesion(await cookies(), respuesta.session)
    return {
      ok: true,
      codigos: respuesta.recoveryCodes,
      cuentaId: respuesta.session.account?.id ?? '',
      kit: kitParaNavegador(respuesta.session),
    }
  } catch (error) {
    // identity-service responde UNAUTHENTICATED a un codigo malo; el contrato documenta INVALID_ARGUMENT.
    const codigoMalo = 'Ese código no es correcto. Revisa la hora de tu teléfono y prueba con el siguiente.'
    return fallo(error, {
      [Code.InvalidArgument]: codigoMalo,
      [Code.Unauthenticated]: codigoMalo,
      [Code.NotFound]: 'Esta inscripción no existe. Vuelve a abrir tu enlace de invitación.',
      [Code.FailedPrecondition]: 'Esta cuenta ya estaba confirmada. Ingresa con ella.',
    })
  }
}

/**
 * Primer paso del ingreso: sal e iteraciones del correo. Para un correo que no existe el servicio
 * devuelve parametros falsos pero estables, asi que esta respuesta no revela nada.
 */
export async function parametrosDeIngreso(correo: string): Promise<Resultado<{ sal: string; iteraciones: number }>> {
  const entrada = esquemaCorreo.safeParse(correo)
  if (!entrada.success) {
    return { ok: false, mensaje: 'Escribe un correo válido.', campos: { correo: 'Escribe un correo válido' } }
  }
  try {
    // Es la primera llamada del ingreso: si Render tenia dormido el servicio, aqui se espera a que despierte.
    const { esperaMaxMs } = leerConfiguracion()
    const { kdf } = await conDespertar(
      (timeoutMs) => clientes().identidad.auth.getLoginParameters({ email: entrada.data }, { timeoutMs }),
      esperaMaxMs,
    )
    if (!kdf) {
      return { ok: false, mensaje: 'El servicio no devolvió los parámetros de ingreso.' }
    }
    return { ok: true, sal: aBase64Url(kdf.salt), iteraciones: kdf.iterations }
  } catch (error) {
    return fallo(error)
  }
}

const CREDENCIALES = 'Correo o contraseña incorrectos.'

export async function ingresar(datos: { correo: string; verificador: string }): Promise<Resultado<object>> {
  const entrada = esquemaIngreso.safeParse(datos)
  if (!entrada.success) {
    return invalido(entrada.error)
  }
  try {
    const respuesta = await clientes().identidad.auth.login({
      email: entrada.data.correo,
      authVerifier: entrada.data.verificador,
    })
    // El desafio tambien queda en una cookie httpOnly: el segundo paso no depende de nada del navegador.
    const tarro = await cookies()
    tarro.set(nombres.desafio(), respuesta.challengeId, opciones(segundosHasta(respuesta.challengeExpiresAt) + 30))
    return { ok: true }
  } catch (error) {
    return fallo(error, {
      [Code.Unauthenticated]: CREDENCIALES,
      [Code.ResourceExhausted]: 'Demasiados intentos. La cuenta queda bloqueada unos minutos.',
    })
  }
}

export async function completarIngreso(
  datos: DatosSegundoFactor,
): Promise<Resultado<{ cuentaId: string; kit: KitCifrado | null; restantes: number }> | (Fallo & { reiniciar: true })> {
  const entrada = esquemaSegundoFactor.safeParse(datos)
  if (!entrada.success) {
    return invalido(entrada.error)
  }
  const tarro = await cookies()
  const desafio = tarro.get(nombres.desafio())?.value
  if (!desafio) {
    return { ok: false, reiniciar: true, mensaje: 'El ingreso venció (son 5 minutos). Vuelve a empezar.' }
  }
  try {
    const factor =
      entrada.data.tipo === 'totp'
        ? { case: 'totpCode' as const, value: entrada.data.codigo }
        : { case: 'recoveryCode' as const, value: entrada.data.codigo }
    const respuesta = await clientes().identidad.auth.completeSecondFactor({ challengeId: desafio, factor })
    if (!respuesta.session) {
      return { ok: false, mensaje: 'El servicio no abrió la sesión.' }
    }
    borrarGalleta(tarro, nombres.desafio())
    guardarSesion(tarro, respuesta.session)
    return {
      ok: true,
      cuentaId: respuesta.session.account?.id ?? '',
      kit: kitParaNavegador(respuesta.session),
      restantes: respuesta.remainingRecoveryCodes,
    }
  } catch (error) {
    return fallo(error, { [Code.Unauthenticated]: 'Código incorrecto, ya usado o vencido.' })
  }
}

/** Cierra la sesion en identity-service (revoca la familia de tokens) y borra las cookies. */
export async function cerrarSesion(): Promise<void> {
  const tarro = await cookies()
  const renovacion = tarro.get(nombres.renovacion())?.value
  borrarSesion(tarro)
  if (renovacion) {
    try {
      await clientes().identidad.auth.logout({ refreshToken: renovacion })
    } catch (error) {
      // Las cookies ya se borraron; el token vencera solo. No se bloquea la salida por esto.
      console.warn('No se pudo revocar la sesion en identity-service', error)
    }
  }
}

const ROLES = { ADMIN: PlatformRole.ADMIN, MEMBER: PlatformRole.MEMBER, EXTERNAL: PlatformRole.EXTERNAL }

export async function invitarMiembro(datos: DatosInvitacion): Promise<Resultado<{ token: string; vence: string }>> {
  const entrada = esquemaInvitacion.safeParse(datos)
  if (!entrada.success) {
    return invalido(entrada.error)
  }
  const acceso = (await cookies()).get(nombres.acceso())?.value
  if (!acceso) {
    return { ok: false, mensaje: 'Tu sesión venció. Recarga la página.' }
  }
  try {
    const respuesta = await clientes().identidad.organizacion.inviteMember(
      { email: entrada.data.correo, role: ROLES[entrada.data.rol], idempotencyKey: entrada.data.idempotencia },
      comoPersona(acceso),
    )
    const vence = respuesta.expiresAt ? new Date(timestampMs(respuesta.expiresAt)).toISOString() : ''
    return { ok: true, token: respuesta.invitationToken, vence }
  } catch (error) {
    return fallo(error, { [Code.AlreadyExists]: 'Ya existe una cuenta con ese correo.' })
  }
}
