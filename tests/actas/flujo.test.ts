// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { aceptarActa, cerrarActa, crearActa, documentoFinal, obtenerActa, verificarDocumento } from '@/app/acciones/actas'
import { claveMotor } from '@/app/acciones/audiencias'
import { crearExpediente, invitarParticipante } from '@/app/acciones/expedientes'
import { confirmarAlta, invitarMiembro, registrarCuenta } from '@/app/acciones/identidad'
import {
  CloseMinuteRequestSchema,
  FinalDocumentSchema,
  MinuteSchema,
  MinuteState,
} from '@/gen/actaflow/minutes/v1/minute_pb'
import { VariableType } from '@/gen/actaflow/templates/v1/template_pb'
import { abrirDocumento, prepararCierre } from '@/lib/actas/navegador'
import { valoresAutomaticos, valorManual } from '@/lib/actas/valores'
import type { Contexto } from '@/lib/audiencias/navegador'
import { aTexto, desdeTexto } from '@/lib/audiencias/protocolo'
import { desdeBase32, desdeBase64Url } from '@/lib/cripto/bytes'
import { cifrarDetalles, desenvolverClave, envolverClave, nuevaClaveCaso } from '@/lib/cripto/casos'
import { abrirKit, prepararRegistro } from '@/lib/cuenta/navegador'
import { blobATexto, envolturaATexto, textoAEnvoltura } from '@/lib/expedientes/formato'
import { clavePublicaDe, listarPersonas, obtenerCaso } from '@/lib/expedientes/servidor'
import { esperarActasSimuladas, reiniciarActasSimuladas } from '@/lib/rpc/actasSimuladas'
import { reiniciarAudienciasSimuladas } from '@/lib/rpc/audienciasSimuladas'
import { reiniciarExpedientesSimulados } from '@/lib/rpc/expedientesSimulados'
import {
  codigoTotp,
  CORREO_ADMIN_SIMULADO,
  INVITACION_SIMULADA,
  reiniciarIdentidadSimulada,
  secretoTotpSimulado,
} from '@/lib/rpc/identidadSimulada'
import { analizar, html } from '@/lib/rpc/lenguajeSimulado'
import { reiniciarPlantillasSimuladas } from '@/lib/rpc/plantillasSimuladas'
import { clientes, sesionActual } from '@/lib/sesion/sesion'

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

async function contexto(persona: Persona, casoId: string): Promise<Contexto> {
  const { caso, membresia } = await como(persona, () => obtenerCaso(persona.sesion, casoId))
  if (!membresia?.clave) throw new Error('sin clave del caso')
  const claveCaso = await desenvolverClave(persona.privada, textoAEnvoltura(membresia.clave))
  return { claveCaso, idClaveCaso: caso.detalles?.idClave ?? '', casoId }
}

/** El siguiente codigo TOTP de la app de una persona (avanza 30 s: cada codigo sirve una vez). */
function siguienteCodigo(correo: string): string {
  reloj += 31_000
  vi.setSystemTime(reloj)
  const secreto = secretoTotpSimulado(correo)
  if (!secreto) throw new Error('sin secreto TOTP')
  return codigoTotp(secreto, reloj)
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(reloj)
  vi.stubEnv('ACTAFLOW_RPC_MODE', 'mock')
  reiniciarIdentidadSimulada()
  reiniciarExpedientesSimulados()
  reiniciarPlantillasSimuladas()
  reiniciarAudienciasSimuladas(0)
  reiniciarActasSimuladas()
  admin = await alta(INVITACION_SIMULADA, CORREO_ADMIN_SIMULADO, 'Admin')
  const invitacion = await como(admin, () =>
    invitarMiembro({ correo: 'ana@actaflow.test', rol: 'MEMBER', idempotencia: crypto.randomUUID() }),
  )
  if (!invitacion.ok) throw new Error(invitacion.mensaje)
  ana = await alta(invitacion.token, 'ana@actaflow.test', 'Ana')
})

describe('acta de punta a punta (simulada)', () => {
  it('se llena en el navegador, el motor la sella en PDF y la parte la acepta con su TOTP', async () => {
    const casoId = await nuevoCaso(admin, 'CC-2026-0600', 'Arriendo bodega')
    expect(
      await como(admin, () =>
        invitarParticipante({
          casoId,
          correo: 'ana@actaflow.test',
          nombre: 'Ana',
          rol: 'PARTY',
          lado: 'CLAIMANT',
          calidad: 'PRINCIPAL',
          idempotencia: crypto.randomUUID(),
        }),
      ),
    ).toEqual({ ok: true })
    await como(ana, () => obtenerCaso(ana.sesion, casoId))

    const { template } = await clientes().expedientes.plantillas.getPublishedTemplate({
      slug: 'acta-conciliacion-arrendamiento',
    })
    if (!template) throw new Error('sin plantilla')
    expect((await como(ana, () => crearActa({ casoId, plantillaId: template.id, version: template.version, idempotencia: crypto.randomUUID() }))).ok).toBe(false)
    const creada = await como(admin, () =>
      crearActa({ casoId, plantillaId: template.id, version: template.version, idempotencia: crypto.randomUUID() }),
    )
    if (!creada.ok) throw new Error(creada.mensaje)
    const acta = desdeTexto(MinuteSchema, creada.acta)
    expect(acta.state).toBe(MinuteState.DRAFT)

    // El navegador llena la plantilla: datos del caso y lo que falte, a mano.
    const personas = (await como(admin, () => listarPersonas(admin.sesion, casoId))).map((p) => ({
      id: p.id,
      nombre: p.nombre,
      rol: p.rol,
      lado: p.lado,
      calidad: p.calidad,
    }))
    const valores = valoresAutomaticos({ radicado: 'CC-2026-0600', personas, audiencia: new Date(reloj), entidades: null })
    expect(valores['partes.convocante.nombre']?.kind).toEqual({ case: 'text', value: 'Ana' })
    expect(valores['conciliador.nombre']?.kind).toEqual({ case: 'text', value: 'Admin' })
    const { nodos, variables } = analizar(template.source)
    const aMano: Partial<Record<VariableType, ['dinero' | 'fecha' | 'texto', string]>> = {
      [VariableType.MONEY]: ['dinero', '1.500.000'],
      [VariableType.DATE]: ['fecha', '2026-11-30'],
      [VariableType.TEXT]: ['texto', 'Ipiales'],
      [VariableType.PARTY]: ['texto', 'Ipiales'],
    }
    for (const v of variables.filter((x) => !(x.path in valores))) {
      const [tipo, crudo] = aMano[v.type] ?? ['texto', '']
      const manual = valorManual(tipo, crudo)
      if (manual) valores[v.path] = manual
    }
    const final = html(nodos, valores)
    expect(final).toContain('CC-2026-0600')
    expect(final).not.toContain('class="falta"')

    const c = await contexto(admin, casoId)
    const clave = await como(admin, () => claveMotor())
    if (!clave.ok) throw new Error(clave.mensaje)
    const cierre = await prepararCierre({
      ...c,
      motor: { idClave: clave.idClave, publica: desdeBase64Url(clave.publica) },
      actaId: acta.id,
      titulo: 'Acta CC-2026-0600',
      html: final,
    })
    const cerrada = await como(admin, () => cerrarActa({ peticion: aTexto(CloseMinuteRequestSchema, cierre) }))
    if (!cerrada.ok) throw new Error(cerrada.mensaje)
    expect(desdeTexto(MinuteSchema, cerrada.acta).state).toBe(MinuteState.SEALING)
    await esperarActasSimuladas()
    const ahora = await como(ana, () => obtenerActa({ actaId: acta.id }))
    expect(ahora.ok && desdeTexto(MinuteSchema, ahora.acta).state).toBe(MinuteState.AWAITING_ACCEPTANCE)

    const doc = await como(ana, () => documentoFinal({ actaId: acta.id }))
    if (!doc.ok || !doc.documento) throw new Error('sin documento')
    const documento = desdeTexto(FinalDocumentSchema, doc.documento)
    const abierto = await abrirDocumento(c, documento)
    expect(abierto.coincide).toBe(true)
    expect(new TextDecoder().decode(abierto.pdf.slice(0, 8))).toBe('%PDF-1.4')
    expect(new TextDecoder().decode(abierto.pdf)).toContain('CC-2026-0600')

    // Aceptar: el conciliador no es parte; un codigo falso no pasa; el bueno, si (una sola vez).
    expect(await como(admin, () => aceptarActa({ documentoId: documento.id, sha256: abierto.sha256, codigo: siguienteCodigo(CORREO_ADMIN_SIMULADO) }))).toEqual({
      ok: false,
      mensaje: 'Solo las partes del expediente aceptan el acta.',
    })
    expect((await como(ana, () => aceptarActa({ documentoId: documento.id, sha256: abierto.sha256, codigo: '000000' }))).ok).toBe(false)
    const codigo = siguienteCodigo('ana@actaflow.test')
    const aceptada = await como(ana, () => aceptarActa({ documentoId: documento.id, sha256: abierto.sha256, codigo }))
    if (!aceptada.ok) throw new Error(aceptada.mensaje)
    expect(desdeTexto(FinalDocumentSchema, aceptada.documento).acceptances.map((a) => a.displayName)).toEqual(['Ana'])
    expect((await como(ana, () => aceptarActa({ documentoId: documento.id, sha256: abierto.sha256, codigo }))).ok).toBe(false)
    const fin = await como(admin, () => obtenerActa({ actaId: acta.id }))
    expect(fin.ok && desdeTexto(MinuteSchema, fin.acta).state).toBe(MinuteState.FINAL)

    // Verificacion publica: sin sesion.
    tarro = new Map()
    expect(await verificarDocumento({ sha256: abierto.sha256 })).toMatchObject({ ok: true, autentico: true, radicado: 'CC-2026-0600', aceptaciones: 1 })
    expect(await verificarDocumento({ sha256: '0'.repeat(64) })).toMatchObject({ ok: true, autentico: false })
    expect(cierre.finalContent?.payload?.plaintextType).toBe('actaflow.minutes.v1.FinalContent')
  })
})
