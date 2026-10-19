// @vitest-environment node
import { create } from '@bufbuild/protobuf'
import { anyPack, timestampFromMs } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FieldViolationsSchema } from '@/gen/actaflow/common/v1/errors_pb'
import { SessionSchema } from '@/gen/actaflow/identity/v1/auth_pb'
import { enlaceInvitacion, leerInvitacion } from '@/lib/cuenta/invitacion'
import { fallo } from '@/lib/rpc/errores'
import { politicaSeguridad } from '@/lib/seguridad/csp'
import { galletasDeSesion, nombres, segundosHasta } from '@/lib/sesion/galletas'
import { destinoSeguro } from '@/lib/sesion/sesion'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('cookies de sesion', () => {
  const AHORA = Date.UTC(2026, 9, 19, 12)
  const sesion = create(SessionSchema, {
    accessToken: 'acceso',
    accessTokenExpiresAt: timestampFromMs(AHORA + 15 * 60_000),
    refreshToken: 'renovacion',
    refreshTokenExpiresAt: timestampFromMs(AHORA + 30 * 24 * 3_600_000),
  })

  it('son httpOnly, SameSite=Lax y vencen un poco antes que el token', () => {
    const [acceso, renovacion] = galletasDeSesion(sesion, AHORA)
    expect(acceso).toMatchObject({ valor: 'acceso', opciones: { httpOnly: true, sameSite: 'lax', path: '/' } })
    expect(acceso?.opciones.maxAge).toBe(15 * 60 - 30)
    expect(renovacion?.opciones.maxAge).toBe(30 * 24 * 3600 - 30)
  })

  it('en produccion son Secure y llevan el prefijo __Host-', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const [acceso] = galletasDeSesion(sesion, AHORA)
    expect(acceso?.nombre).toBe('__Host-actaflow-acceso')
    expect(acceso?.opciones.secure).toBe(true)
    expect(nombres.renovacion()).toBe('__Host-actaflow-renovacion')
  })

  it('en desarrollo funcionan en http://localhost', () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect(nombres.acceso()).toBe('actaflow-acceso')
    expect(galletasDeSesion(sesion, AHORA)[0]?.opciones.secure).toBe(false)
  })

  it('un token sin vencimiento no deja cookie viva', () => {
    expect(segundosHasta(undefined)).toBe(0)
  })
})

describe('redireccion despues de ingresar', () => {
  it('solo acepta rutas internas', () => {
    expect(destinoSeguro('/panel')).toBe('/panel')
    expect(destinoSeguro('/panel?aviso=codigos')).toBe('/panel?aviso=codigos')
    for (const malo of [
      '//evil.test',
      'https://evil.test',
      '/\\evil.test',
      'javascript:alert(1)',
      '',
      null,
      undefined,
    ]) {
      expect(destinoSeguro(malo)).toBe('/panel')
    }
  })
})

describe('CSP de las rutas de cuenta', () => {
  it('solo scripts con el nonce de la peticion o el hash del tema; nada de eval en produccion', () => {
    const csp = politicaSeguridad({ nonce: 'abc', hashTema: 'xyz', desarrollo: false, https: true })
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'sha256-xyz' 'strict-dynamic'")
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain('upgrade-insecure-requests')
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
  })

  it('por http (next start local) no fuerza https', () => {
    expect(politicaSeguridad({ nonce: 'abc', hashTema: 'xyz', desarrollo: false, https: false })).not.toContain(
      'upgrade-insecure-requests',
    )
  })

  it('en desarrollo permite eval y el WebSocket del recargado en caliente', () => {
    const csp = politicaSeguridad({ nonce: 'abc', hashTema: 'xyz', desarrollo: true, https: false })
    expect(csp).toContain("'unsafe-eval'")
    expect(csp).toContain("connect-src 'self' ws: wss:")
  })
})

describe('enlace de invitacion', () => {
  it('lleva el token en el fragmento y se lee de vuelta', () => {
    const token = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4'
    const enlace = enlaceInvitacion('https://actaflow.test/', token)
    expect(enlace).toBe(`https://actaflow.test/registro#invitacion=${token}`)
    expect(leerInvitacion(new URL(enlace).hash)).toBe(token)
  })

  it('ignora fragmentos vacios o con otro formato', () => {
    expect(leerInvitacion('')).toBeNull()
    expect(leerInvitacion('#invitacion=corto')).toBeNull()
    expect(leerInvitacion('#invitacion=<script>alert(1)</script>xxxxxxxxxxxxxxxxxxxxxx')).toBeNull()
  })
})

describe('errores para personas', () => {
  it('usa el mensaje propio del caso y marca los campos del contrato', () => {
    const detalle = create(FieldViolationsSchema, { violations: [{ field: 'email', rule: 'string.email' }] })
    const error = new ConnectError('invalido', Code.InvalidArgument, undefined, [
      { desc: FieldViolationsSchema, value: detalle },
    ])
    expect(fallo(error)).toEqual({
      ok: false,
      mensaje: 'Hay datos que no cumplen el formato esperado.',
      campos: { correo: 'Revisa este campo' },
    })
    expect(fallo(new ConnectError('x', Code.NotFound), { [Code.NotFound]: 'Invitacion vencida' }).mensaje).toBe(
      'Invitacion vencida',
    )
  })

  it('no filtra detalles internos de errores inesperados', () => {
    const espia = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(fallo(new Error('postgres://usuario:clave@host'))).toEqual({
      ok: false,
      mensaje: 'Algo salió mal. Intenta de nuevo.',
    })
    expect(espia).toHaveBeenCalled()
  })

  it('entiende los detalles empaquetados como Any (asi llegan por gRPC-Web)', () => {
    const detalle = create(FieldViolationsSchema, { violations: [{ field: 'totp_code', rule: 'string.pattern' }] })
    const empaquetado = anyPack(FieldViolationsSchema, detalle)
    const error = new ConnectError('invalido', Code.InvalidArgument)
    error.details.push({ type: 'actaflow.common.v1.FieldViolations', value: empaquetado.value })
    expect(fallo(error).campos).toEqual({ codigo: 'Revisa este campo' })
  })
})
