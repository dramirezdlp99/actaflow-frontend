// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmarAlta, invitarMiembro, registrarCuenta } from '@/app/acciones/identidad'
import {
  actualizarExpediente,
  cambiarEstadoExpediente,
  clavePublicaParticipante,
  crearExpediente,
  entregarClave,
  invitarParticipante,
  retirarParticipante,
} from '@/app/acciones/expedientes'
import { CaseRole, CaseStatus } from '@/gen/actaflow/cases/v1/case_pb'
import { ParticipantState } from '@/gen/actaflow/cases/v1/participant_pb'
import { desdeBase32, desdeBase64Url } from '@/lib/cripto/bytes'
import { cifrarDetalles, descifrarDetalles, desenvolverClave, envolverClave, nuevaClaveCaso } from '@/lib/cripto/casos'
import { abrirKit, prepararRegistro } from '@/lib/cuenta/navegador'
import { TRANSICIONES } from '@/lib/expedientes/etiquetas'
import { blobATexto, envolturaATexto, textoABlob, textoAEnvoltura } from '@/lib/expedientes/formato'
import { clavePublicaDe, listarCasos, listarEventos, listarPersonas, obtenerCaso } from '@/lib/expedientes/servidor'
import { reiniciarExpedientesSimulados } from '@/lib/rpc/expedientesSimulados'
import {
  codigoTotp,
  CORREO_ADMIN_SIMULADO,
  INVITACION_SIMULADA,
  reiniciarIdentidadSimulada,
} from '@/lib/rpc/identidadSimulada'
import { nombres } from '@/lib/sesion/galletas'
import { sesionActual } from '@/lib/sesion/sesion'

// Cada persona tiene su propio "navegador": su tarro de cookies.
let tarro = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (tarro.has(n) ? { value: tarro.get(n) ?? '' } : undefined),
    set: (n: string, v: string, o: { maxAge?: number }) => (o.maxAge === 0 ? tarro.delete(n) : tarro.set(n, v)),
  }),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (destino: string) => {
    throw new Error(`NEXT_REDIRECT ${destino}`)
  },
}))
// `cache` de React solo deduplica dentro de una peticion de servidor; aqui cada llamada es nueva.
vi.mock('react', async (original) => ({ ...(await original<typeof import('react')>()), cache: <T>(f: T) => f }))

let reloj = Date.UTC(2026, 9, 20, 12)

async function alta(invitacion: string, correo: string, nombre: string) {
  tarro = new Map()
  const contrasena = `frase larga de ${nombre}`
  const preparado = await prepararRegistro({
    invitacion,
    correo,
    nombre,
    contrasena,
    idempotencia: crypto.randomUUID(),
  })
  const registro = await registrarCuenta(preparado.datos)
  if (!registro.ok) throw new Error(registro.mensaje)
  reloj += 31_000
  vi.setSystemTime(reloj)
  const confirmado = await confirmarAlta({
    inscripcion: registro.inscripcion,
    codigo: codigoTotp(desdeBase32(registro.secreto), reloj),
  })
  if (!confirmado.ok || !confirmado.kit) throw new Error('alta')
  const privada = await abrirKit(preparado.claves, confirmado.kit)
  const sesion = await sesionActual()
  if (!sesion) throw new Error('sin sesion')
  return { tarro, privada, sesion, cuentaId: confirmado.cuentaId }
}

type Persona = Awaited<ReturnType<typeof alta>>

function como<T>(persona: Persona, trabajo: () => Promise<T>): Promise<T> {
  tarro = persona.tarro
  return trabajo()
}

async function nuevoCaso(persona: Persona, radicado: string, titulo: string) {
  return como(persona, async () => {
    const mia = await clavePublicaDe(persona.sesion, persona.cuentaId)
    if (!mia) throw new Error('sin clave publica')
    const { clave, idClave } = await nuevaClaveCaso()
    const detalles = await cifrarDetalles(clave, idClave, { titulo, resumen: 'Resumen secreto' })
    const envoltura = await envolverClave(clave, { idClave: mia.idClave, publica: desdeBase64Url(mia.publica) })
    const respuesta = await crearExpediente({
      radicado,
      tipo: 'CONCILIATION',
      detalles: blobATexto(detalles),
      clave: envolturaATexto(envoltura),
      audiencia: new Date(reloj + 86_400_000).toISOString(),
      idempotencia: crypto.randomUUID(),
    })
    if (!respuesta.ok) throw new Error(respuesta.mensaje)
    return respuesta.id
  })
}

let admin: Persona
let ana: Persona

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(reloj)
  vi.stubEnv('ACTAFLOW_RPC_MODE', 'mock')
  reiniciarIdentidadSimulada()
  reiniciarExpedientesSimulados()
  admin = await alta(INVITACION_SIMULADA, CORREO_ADMIN_SIMULADO, 'Admin')
  const invitacion = await como(admin, () =>
    invitarMiembro({ correo: 'ana@actaflow.test', rol: 'MEMBER', idempotencia: crypto.randomUUID() }),
  )
  if (!invitacion.ok) throw new Error(invitacion.mensaje)
  ana = await alta(invitacion.token, 'ana@actaflow.test', 'Ana')
})

describe('expedientes de punta a punta (simulados)', () => {
  it('crear deja el caso cifrado; solo el creador lo abre y aparece en su lista', async () => {
    const id = await nuevoCaso(admin, 'cc-2026-0142', 'Arrendamiento calle 18')
    const { caso, membresia } = await como(admin, () => obtenerCaso(admin.sesion, id))
    expect(caso.radicado).toBe('CC-2026-0142')
    expect(caso.estado).toBe(CaseStatus.OPEN)
    expect(caso.revision).toBe('1')
    expect(membresia?.rol).toBe(CaseRole.CONCILIATOR)
    if (!membresia?.clave || !caso.detalles) throw new Error('sin clave')
    const clave = await desenvolverClave(admin.privada, textoAEnvoltura(membresia.clave))
    expect((await descifrarDetalles(clave, textoABlob(caso.detalles))).titulo).toBe('Arrendamiento calle 18')

    const { casos } = await como(admin, () => listarCasos(admin.sesion, CaseStatus.UNSPECIFIED, 20, ''))
    expect(casos.map((c) => c.caso.radicado)).toEqual(['CC-2026-0142'])
    // Ana no participa: para ella el caso no existe.
    await expect(como(ana, () => obtenerCaso(ana.sesion, id))).rejects.toThrow('NEXT_NOT_FOUND')
    expect((await como(ana, () => listarCasos(ana.sesion, CaseStatus.UNSPECIFIED, 20, ''))).casos).toEqual([])
  })

  it('invitar, vincular por correo y entregar la clave para que la otra persona lea', async () => {
    const id = await nuevoCaso(admin, 'CC-2026-0200', 'Contrato de obra')
    const invitada = await como(admin, () =>
      invitarParticipante({
        casoId: id,
        correo: 'ANA@actaflow.test',
        nombre: 'Ana P.',
        rol: 'PARTY',
        lado: 'CLAIMANT',
        calidad: 'ATTORNEY',
        idempotencia: crypto.randomUUID(),
      }),
    )
    expect(invitada).toEqual({ ok: true })

    // Ana entra: el caso aparece solo, pero aun sin clave.
    const suyo = await como(ana, () => obtenerCaso(ana.sesion, id))
    expect(suyo.membresia?.rol).toBe(CaseRole.PARTY)
    expect(suyo.membresia?.clave).toBeNull()
    const personas = await como(admin, () => listarPersonas(admin.sesion, id))
    const deAna = personas.find((p) => p.correo === 'ana@actaflow.test')
    expect(deAna?.estado).toBe(ParticipantState.AWAITING_KEY)
    if (!deAna) throw new Error()

    // El admin abre la clave del caso, pide la publica de Ana y se la envuelve.
    const propio = await como(admin, () => obtenerCaso(admin.sesion, id))
    if (!propio.membresia?.clave || !propio.caso.detalles) throw new Error()
    const claveCaso = await desenvolverClave(admin.privada, textoAEnvoltura(propio.membresia.clave))
    const publica = await como(admin, () => clavePublicaParticipante({ casoId: id, participanteId: deAna.id }))
    if (!publica.ok) throw new Error(publica.mensaje)
    expect(publica.huella).toMatch(/^[0-9a-f]{64}$/)
    const envoltura = await envolverClave(claveCaso, {
      idClave: publica.idClave,
      publica: desdeBase64Url(publica.publica),
    })
    expect(
      await como(admin, () =>
        entregarClave({ casoId: id, participanteId: deAna.id, clave: envolturaATexto(envoltura) }),
      ),
    ).toEqual({
      ok: true,
    })

    const ahora = await como(ana, () => obtenerCaso(ana.sesion, id))
    if (!ahora.membresia?.clave || !ahora.caso.detalles) throw new Error('Ana sigue sin clave')
    const deAnaClave = await desenvolverClave(ana.privada, textoAEnvoltura(ahora.membresia.clave))
    expect((await descifrarDetalles(deAnaClave, textoABlob(ahora.caso.detalles))).titulo).toBe('Contrato de obra')

    // Las partes no editan.
    expect(
      await como(ana, () =>
        actualizarExpediente({
          casoId: id,
          revision: ahora.caso.revision,
          audiencia: new Date().toISOString(),
          idempotencia: crypto.randomUUID(),
        }),
      ),
    ).toEqual({ ok: false, mensaje: 'Las partes no editan el expediente.' })
  })

  it('editar exige la revision vigente y el estado sigue las transiciones', async () => {
    const id = await nuevoCaso(admin, 'CC-2026-0300', 'Original')
    const { caso, membresia } = await como(admin, () => obtenerCaso(admin.sesion, id))
    if (!membresia?.clave || !caso.detalles) throw new Error()
    const clave = await desenvolverClave(admin.privada, textoAEnvoltura(membresia.clave))
    const nuevo = blobATexto(await cifrarDetalles(clave, caso.detalles.idClave, { titulo: 'Editado', resumen: '' }))
    const editado = await como(admin, () =>
      actualizarExpediente({ casoId: id, revision: '1', detalles: nuevo, idempotencia: crypto.randomUUID() }),
    )
    expect(editado).toEqual({ ok: true, revision: '2' })
    const viejo = await como(admin, () =>
      actualizarExpediente({ casoId: id, revision: '1', detalles: nuevo, idempotencia: crypto.randomUUID() }),
    )
    expect(viejo.ok ? '' : viejo.mensaje).toContain('Alguien más cambió el expediente')

    const paso = (estado: 'IN_HEARING' | 'AGREEMENT' | 'ARCHIVED') =>
      como(admin, () => cambiarEstadoExpediente({ casoId: id, estado, idempotencia: crypto.randomUUID() }))
    expect((await paso('AGREEMENT')).ok).toBe(false)
    expect(await paso('IN_HEARING')).toEqual({ ok: true })
    expect(await paso('AGREEMENT')).toEqual({ ok: true })
    expect(await paso('ARCHIVED')).toEqual({ ok: true })
    const archivado = await como(admin, () => obtenerCaso(admin.sesion, id))
    expect(archivado.caso.estado).toBe(CaseStatus.ARCHIVED)
    const eventos = await como(admin, () => listarEventos(admin.sesion, id))
    expect(eventos.length).toBeGreaterThanOrEqual(5)
    expect(eventos.at(-1)?.actor).toBe('Admin')
  })

  it('no se puede retirar al ultimo conciliador ni crear sin datos validos', async () => {
    const id = await nuevoCaso(admin, 'CC-2026-0400', 'Uno')
    const { membresia } = await como(admin, () => obtenerCaso(admin.sesion, id))
    const retiro = await como(admin, () =>
      retirarParticipante({ casoId: id, participanteId: membresia?.participanteId ?? '' }),
    )
    expect(retiro).toEqual({ ok: false, mensaje: 'El caso debe conservar al menos un conciliador.' })
    const malo = await como(admin, () =>
      crearExpediente({
        radicado: 'x',
        tipo: 'CONCILIATION',
        detalles: { idClave: '', nonce: '', cifrado: '', tipo: '' },
        clave: { idDestinatario: '', efimera: '', nonce: '', envuelta: '' },
        idempotencia: 'no',
      }),
    )
    expect(malo.ok).toBe(false)
    if (!malo.ok)
      expect(Object.keys(malo.campos ?? {})).toEqual(expect.arrayContaining(['radicado', 'detalles', 'clave']))
  })
})

describe('transiciones', () => {
  it('la interfaz ofrece exactamente los pasos que valida el servicio', () => {
    const esperado: Record<number, CaseStatus[]> = {
      [CaseStatus.OPEN]: [CaseStatus.IN_HEARING, CaseStatus.ARCHIVED],
      [CaseStatus.IN_HEARING]: [CaseStatus.AGREEMENT, CaseStatus.NO_AGREEMENT, CaseStatus.OPEN],
      [CaseStatus.AGREEMENT]: [CaseStatus.ARCHIVED],
      [CaseStatus.NO_AGREEMENT]: [CaseStatus.OPEN, CaseStatus.ARCHIVED],
      [CaseStatus.ARCHIVED]: [],
    }
    for (const [desde, pasos] of Object.entries(esperado)) {
      expect(TRANSICIONES[Number(desde) as CaseStatus].map((p) => p.a).sort()).toEqual([...pasos].sort())
    }
  })
})

describe('cookies del test', () => {
  it('cada persona usa su propia sesion', () => {
    expect(admin.tarro.get(nombres.acceso())).not.toBe(ana.tarro.get(nombres.acceso()))
  })
})
