// @vitest-environment node
import { Code, ConnectError } from '@connectrpc/connect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformRole } from '@/gen/actaflow/identity/v1/account_pb'
import {
  completarIngreso,
  confirmarAlta,
  cerrarSesion,
  ingresar,
  invitarMiembro,
  parametrosDeIngreso,
  registrarCuenta,
} from '@/app/acciones/identidad'
import { desdeBase32 } from '@/lib/cripto/bytes'
import { abrirKit, prepararIngreso, prepararRegistro } from '@/lib/cuenta/navegador'
import { crearClientes } from '@/lib/rpc/clientes'
import {
  codigoTotp,
  CORREO_ADMIN_SIMULADO,
  INVITACION_SIMULADA,
  reiniciarIdentidadSimulada,
} from '@/lib/rpc/identidadSimulada'
import { nombres } from '@/lib/sesion/galletas'

// Tarro de cookies en memoria en lugar de next/headers: asi se ve exactamente que guarda el BFF.
const tarro = new Map<string, { valor: string; opciones: unknown }>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nombre: string) => (tarro.has(nombre) ? { value: tarro.get(nombre)?.valor ?? '' } : undefined),
    // Como el navegador: una cookie con maxAge 0 desaparece.
    set: (nombre: string, valor: string, opciones: { maxAge?: number }) =>
      opciones.maxAge === 0 ? tarro.delete(nombre) : tarro.set(nombre, { valor, opciones }),
  }),
}))

const CONTRASENA = 'una frase bastante larga para el admin'
const MINUTO = 60_000
let reloj = Date.UTC(2026, 9, 19, 12)

/** Avanza el reloj medio minuto: cada codigo TOTP sirve una sola vez. */
function siguienteCodigo(secreto: string): string {
  reloj += 31_000
  vi.setSystemTime(reloj)
  return codigoTotp(desdeBase32(secreto), reloj)
}

async function registrar(invitacion: string, correo: string, nombre: string, contrasena: string) {
  const preparado = await prepararRegistro({
    invitacion,
    correo,
    nombre,
    contrasena,
    idempotencia: crypto.randomUUID(),
  })
  const respuesta = await registrarCuenta(preparado.datos)
  if (!respuesta.ok) {
    throw new Error(respuesta.mensaje)
  }
  return { preparado, inscripcion: respuesta }
}

async function alta(invitacion: string, correo: string, nombre: string, contrasena: string) {
  const { preparado, inscripcion } = await registrar(invitacion, correo, nombre, contrasena)
  const confirmado = await confirmarAlta({
    inscripcion: inscripcion.inscripcion,
    codigo: siguienteCodigo(inscripcion.secreto),
  })
  if (!confirmado.ok) {
    throw new Error(confirmado.mensaje)
  }
  return { preparado, secreto: inscripcion.secreto, confirmado }
}

async function primerPaso(correo: string, contrasena: string) {
  const parametros = await parametrosDeIngreso(correo)
  if (!parametros.ok) {
    throw new Error(parametros.mensaje)
  }
  const preparado = await prepararIngreso(contrasena, parametros)
  return { preparado, respuesta: await ingresar({ correo, verificador: preparado.verificador }) }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(reloj)
  vi.stubEnv('ACTAFLOW_RPC_MODE', 'mock')
  tarro.clear()
  reiniciarIdentidadSimulada()
})

describe('alta por invitacion', () => {
  it('registra, confirma el TOTP, deja la sesion en cookies httpOnly y entrega el kit para abrirlo', async () => {
    const { preparado, inscripcion } = await registrar(INVITACION_SIMULADA, CORREO_ADMIN_SIMULADO, 'Admin', CONTRASENA)
    expect(inscripcion.uri).toMatch(/^otpauth:\/\/totp\/ActaFlow/)
    expect(tarro.size).toBe(0)

    const malo = await confirmarAlta({ inscripcion: inscripcion.inscripcion, codigo: '000000' })
    expect(malo).toMatchObject({ ok: false })

    const confirmado = await confirmarAlta({
      inscripcion: inscripcion.inscripcion,
      codigo: siguienteCodigo(inscripcion.secreto),
    })
    if (!confirmado.ok) throw new Error(confirmado.mensaje)
    expect(confirmado.codigos).toHaveLength(10)
    expect(tarro.get(nombres.acceso())?.opciones).toMatchObject({ httpOnly: true, sameSite: 'lax' })
    expect(tarro.has(nombres.renovacion())).toBe(true)
    if (!confirmado.kit) throw new Error('sin kit')
    expect((await abrirKit(preparado.claves, confirmado.kit)).type).toBe('private')
  }, 30_000)

  it('rechaza una invitacion inventada, reusada o para otro correo', async () => {
    await alta(INVITACION_SIMULADA, CORREO_ADMIN_SIMULADO, 'Admin', CONTRASENA)
    const preparado = await prepararRegistro({
      invitacion: INVITACION_SIMULADA,
      correo: 'otra@actaflow.test',
      nombre: 'Otra',
      contrasena: CONTRASENA,
      idempotencia: crypto.randomUUID(),
    })
    expect(await registrarCuenta(preparado.datos)).toMatchObject({
      ok: false,
      mensaje: 'La invitación no es válida: ya se usó, venció o es para otro correo.',
    })
  }, 30_000)

  it('valida en el servidor lo que manda el navegador (no confia en TypeScript)', async () => {
    const preparado = await prepararRegistro({
      invitacion: INVITACION_SIMULADA,
      correo: CORREO_ADMIN_SIMULADO,
      nombre: 'A',
      contrasena: CONTRASENA,
      idempotencia: crypto.randomUUID(),
    })
    const respuesta = await registrarCuenta({ ...preparado.datos, iteraciones: 1_000, clavePublica: 'AAAA' })
    expect(respuesta).toMatchObject({ ok: false })
    if (respuesta.ok) return
    expect(Object.keys(respuesta.campos ?? {}).sort()).toEqual(['clavePublica', 'iteraciones', 'nombre'])
  }, 30_000)
})

describe('ingreso en dos pasos', () => {
  it('pide el segundo factor, abre la sesion y no acepta el mismo codigo dos veces', async () => {
    const { secreto, preparado: registro } = await alta(INVITACION_SIMULADA, CORREO_ADMIN_SIMULADO, 'Admin', CONTRASENA)
    tarro.clear()

    const { preparado, respuesta } = await primerPaso(CORREO_ADMIN_SIMULADO, CONTRASENA)
    expect(respuesta).toEqual({ ok: true })
    expect(preparado.verificador).toBe(registro.datos.verificador)
    expect(tarro.has(nombres.desafio())).toBe(true)
    expect(tarro.has(nombres.acceso())).toBe(false)

    const codigo = siguienteCodigo(secreto)
    const sesion = await completarIngreso({ tipo: 'totp', codigo })
    if (!sesion.ok) throw new Error(sesion.mensaje)
    expect(tarro.has(nombres.desafio())).toBe(false)
    expect(tarro.has(nombres.acceso())).toBe(true)
    if (!sesion.kit) throw new Error('sin kit')
    expect((await abrirKit(preparado.claves, sesion.kit)).type).toBe('private')

    await primerPaso(CORREO_ADMIN_SIMULADO, CONTRASENA)
    expect(await completarIngreso({ tipo: 'totp', codigo })).toMatchObject({
      ok: false,
      mensaje: 'Código incorrecto, ya usado o vencido.',
    })
  }, 60_000)

  it('un codigo de recuperacion sirve una vez y avisa cuantos quedan', async () => {
    const { confirmado } = await alta(INVITACION_SIMULADA, CORREO_ADMIN_SIMULADO, 'Admin', CONTRASENA)
    if (!confirmado.ok) throw new Error()
    const [primero] = confirmado.codigos
    await primerPaso(CORREO_ADMIN_SIMULADO, CONTRASENA)
    const sesion = await completarIngreso({ tipo: 'recuperacion', codigo: (primero ?? '').toLowerCase() })
    expect(sesion).toMatchObject({ ok: true, restantes: 9 })
    await primerPaso(CORREO_ADMIN_SIMULADO, CONTRASENA)
    expect(await completarIngreso({ tipo: 'recuperacion', codigo: primero ?? '' })).toMatchObject({ ok: false })
  }, 60_000)

  it('misma respuesta para contrasena mala y correo inexistente; bloquea tras 5 intentos', async () => {
    await alta(INVITACION_SIMULADA, CORREO_ADMIN_SIMULADO, 'Admin', CONTRASENA)
    const malo = await primerPaso(CORREO_ADMIN_SIMULADO, 'una contrasena equivocada')
    const nadie = await primerPaso('nadie@actaflow.test', 'una contrasena equivocada')
    expect(malo.respuesta).toEqual(nadie.respuesta)
    expect(malo.respuesta).toEqual({ ok: false, mensaje: 'Correo o contraseña incorrectos.' })

    const otraVez = await parametrosDeIngreso('nadie@actaflow.test')
    const yOtra = await parametrosDeIngreso('nadie@actaflow.test')
    expect(otraVez).toEqual(yOtra)

    for (let i = 0; i < 4; i += 1) {
      await primerPaso(CORREO_ADMIN_SIMULADO, 'una contrasena equivocada')
    }
    expect((await primerPaso(CORREO_ADMIN_SIMULADO, CONTRASENA)).respuesta).toMatchObject({ ok: false })
    reloj += 16 * MINUTO
    vi.setSystemTime(reloj)
    expect((await primerPaso(CORREO_ADMIN_SIMULADO, CONTRASENA)).respuesta).toEqual({ ok: true })
  }, 120_000)

  it('sin desafio vigente pide volver a empezar', async () => {
    expect(await completarIngreso({ tipo: 'totp', codigo: '123456' })).toMatchObject({ ok: false, reiniciar: true })
  })
})

describe('sesion', () => {
  it('rotar el token de renovacion y reusar el viejo cierra toda la sesion (deteccion de robo)', async () => {
    await alta(INVITACION_SIMULADA, CORREO_ADMIN_SIMULADO, 'Admin', CONTRASENA)
    const auth = crearClientes({ modo: 'mock', esperaMaxMs: 1_000 }).identidad.auth
    const viejo = tarro.get(nombres.renovacion())?.valor ?? ''
    const { session } = await auth.refreshSession({ refreshToken: viejo })
    expect(session?.refreshToken).not.toBe(viejo)
    await expect(auth.refreshSession({ refreshToken: viejo })).rejects.toMatchObject({ code: Code.Unauthenticated })
    await expect(auth.refreshSession({ refreshToken: session?.refreshToken ?? '' })).rejects.toBeInstanceOf(
      ConnectError,
    )
  }, 30_000)

  it('cerrar sesion borra las cookies y revoca la renovacion', async () => {
    await alta(INVITACION_SIMULADA, CORREO_ADMIN_SIMULADO, 'Admin', CONTRASENA)
    const renovacion = tarro.get(nombres.renovacion())?.valor ?? ''
    await cerrarSesion()
    expect(tarro.size).toBe(0)
    const auth = crearClientes({ modo: 'mock', esperaMaxMs: 1_000 }).identidad.auth
    await expect(auth.refreshSession({ refreshToken: renovacion })).rejects.toMatchObject({
      code: Code.Unauthenticated,
    })
  }, 30_000)
})

describe('invitaciones', () => {
  it('el admin invita; la persona se registra con ese enlace y entra como miembro', async () => {
    await alta(INVITACION_SIMULADA, CORREO_ADMIN_SIMULADO, 'Admin', CONTRASENA)
    const invitacion = await invitarMiembro({
      correo: 'Conciliadora@Actaflow.test',
      rol: 'MEMBER',
      idempotencia: crypto.randomUUID(),
    })
    if (!invitacion.ok) throw new Error(invitacion.mensaje)
    expect(invitacion.token.length).toBeGreaterThanOrEqual(32)
    expect(new Date(invitacion.vence).getTime()).toBeGreaterThan(reloj)

    tarro.clear()
    const { confirmado } = await alta(invitacion.token, 'conciliadora@actaflow.test', 'Conciliadora', CONTRASENA)
    expect(confirmado.ok).toBe(true)

    const organizacion = crearClientes({ modo: 'mock', esperaMaxMs: 1_000 }).identidad.organizacion
    const acceso = tarro.get(nombres.acceso())?.valor ?? ''
    const { members } = await organizacion.listMembers(
      { page: { pageSize: 50 } },
      { headers: { authorization: `Bearer ${acceso}` } },
    )
    expect(members.map((m) => [m.account?.email, m.account?.role])).toEqual([
      [CORREO_ADMIN_SIMULADO, PlatformRole.ADMIN],
      ['conciliadora@actaflow.test', PlatformRole.MEMBER],
    ])

    // Un miembro no puede invitar.
    expect(
      await invitarMiembro({ correo: 'x@actaflow.test', rol: 'MEMBER', idempotencia: crypto.randomUUID() }),
    ).toMatchObject({ ok: false, mensaje: 'Tu cuenta no tiene permiso para esto.' })
  }, 60_000)

  it('sin sesion no se puede invitar', async () => {
    expect(
      await invitarMiembro({ correo: 'x@actaflow.test', rol: 'MEMBER', idempotencia: crypto.randomUUID() }),
    ).toMatchObject({ ok: false })
  })
})
