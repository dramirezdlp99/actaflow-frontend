// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { confirmarAlta, invitarMiembro, registrarCuenta } from '@/app/acciones/identidad'
import { analizarPlantilla, guardarPlantilla, publicarPlantilla } from '@/app/acciones/plantillas'
import { TemplateCategory, VariableType, VersionState } from '@/gen/actaflow/templates/v1/template_pb'
import { desdeBase32 } from '@/lib/cripto/bytes'
import { prepararRegistro } from '@/lib/cuenta/navegador'
import {
  bibliotecaPublicada,
  plantillaParaEditar,
  plantillaPublicada,
  plantillasDeMiOrganizacion,
} from '@/lib/plantillas/servidor'
import {
  codigoTotp,
  CORREO_ADMIN_SIMULADO,
  INVITACION_SIMULADA,
  reiniciarIdentidadSimulada,
} from '@/lib/rpc/identidadSimulada'
import { reiniciarPlantillasSimuladas } from '@/lib/rpc/plantillasSimuladas'
import { sesionActual } from '@/lib/sesion/sesion'

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
const revalidadas: string[] = []
vi.mock('next/cache', () => ({ revalidatePath: (ruta: string) => revalidadas.push(ruta) }))
vi.mock('react', async (original) => ({ ...(await original<typeof import('react')>()), cache: <T>(f: T) => f }))

let reloj = Date.UTC(2026, 9, 20, 12)

async function alta(invitacion: string, correo: string, nombre: string) {
  tarro = new Map()
  const preparado = await prepararRegistro({
    invitacion,
    correo,
    nombre,
    contrasena: `frase larga de ${nombre}`,
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
  if (!confirmado.ok) throw new Error('alta')
  const sesion = await sesionActual()
  if (!sesion) throw new Error('sin sesion')
  return { tarro, sesion }
}

type Persona = Awaited<ReturnType<typeof alta>>
const como = <T>(persona: Persona, trabajo: () => Promise<T>): Promise<T> => {
  tarro = persona.tarro
  return trabajo()
}

const FUENTE = '# Acta {{ caso.radicado }}\n\nPago de {{ acuerdo.monto | moneda_en_letras }}.'
let admin: Persona
let ana: Persona

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(reloj)
  vi.stubEnv('ACTAFLOW_RPC_MODE', 'mock')
  reiniciarIdentidadSimulada()
  reiniciarPlantillasSimuladas()
  revalidadas.length = 0
  admin = await alta(INVITACION_SIMULADA, CORREO_ADMIN_SIMULADO, 'Admin')
  const invitacion = await como(admin, () =>
    invitarMiembro({ correo: 'ana@actaflow.test', rol: 'MEMBER', idempotencia: crypto.randomUUID() }),
  )
  if (!invitacion.ok) throw new Error(invitacion.mensaje)
  ana = await alta(invitacion.token, 'ana@actaflow.test', 'Ana')
})

describe('plantillas de punta a punta (simuladas)', () => {
  it('la biblioteca publicada se lee sin sesion y trae las del sistema', async () => {
    tarro = new Map()
    const biblioteca = await bibliotecaPublicada()
    expect(biblioteca?.map((p) => p.slug)).toEqual([
      'acta-conciliacion-arrendamiento',
      'acta-de-mediacion',
      'constancia-de-no-acuerdo',
    ])
    expect(biblioteca?.every((p) => p.fuente === '' && p.variables.length > 0)).toBe(true)
    const acta = await plantillaPublicada('acta-conciliacion-arrendamiento')
    expect(acta?.fuente.startsWith('# ACTA DE CONCILIACIÓN')).toBe(true)
    expect(acta?.variables.find((v) => v.ruta === 'acuerdo.monto')?.tipo).toBe(VariableType.MONEY)
    expect(await plantillaPublicada('no-existe')).toBeNull()
  })

  it('el editor analiza la fuente: diagnosticos, variables y vista previa saneada con ejemplos', async () => {
    const respuesta = await como(admin, () => analizarPlantilla({ fuente: FUENTE }))
    if (!respuesta.ok) throw new Error(respuesta.mensaje)
    expect(respuesta.diagnosticos).toEqual([])
    expect(respuesta.variables.map((v) => [v.ruta, v.tipo])).toEqual([
      ['caso.radicado', VariableType.TEXT],
      ['acuerdo.monto', VariableType.MONEY],
    ])
    expect(respuesta.html).toBe(
      '<h2>Acta <span class="valor">CC-2026-0142</span></h2>\n' +
        '<p>Pago de <span class="valor">un millón quinientos mil pesos ($1.500.000)</span>.</p>\n',
    )
    const conError = await como(admin, () => analizarPlantilla({ fuente: '{% si x %}sin cerrar' }))
    expect(conError.ok && conError.diagnosticos[0]).toMatchObject({ error: true, linea: 1, columna: 1 })
    const deMiembro = await como(ana, () => analizarPlantilla({ fuente: FUENTE }))
    expect(deMiembro).toEqual({ ok: false, mensaje: 'Solo los administradores gestionan plantillas.' })
  })

  it('guardar, publicar (con revalidacion ISR) y abrir una version nueva', async () => {
    const conErrores = await como(admin, () =>
      guardarPlantilla({
        slug: 'acta-propia',
        titulo: 'Acta propia',
        descripcion: '',
        categoria: 'CONTRACT',
        fuente: 'Hola\n{% si acuerdo.total %}\nTexto',
      }),
    )
    expect(conErrores.ok).toBe(false)
    expect(!conErrores.ok && conErrores.mensaje).toContain('línea 2')
    expect(!conErrores.ok && conErrores.diagnosticos?.[0]).toMatchObject({ error: true, linea: 2 })

    const guardada = await como(admin, () =>
      guardarPlantilla({
        slug: ' Acta-Propia ',
        titulo: 'Acta propia',
        descripcion: 'De prueba',
        categoria: 'CONTRACT',
        fuente: FUENTE,
      }),
    )
    if (!guardada.ok) throw new Error(guardada.mensaje)
    expect(guardada.version).toBe(1)
    const [propia] = await como(admin, () => plantillasDeMiOrganizacion(admin.sesion))
    expect(propia).toMatchObject({ slug: 'acta-propia', estado: VersionState.DRAFT, categoria: TemplateCategory.CONTRACT })
    expect(await plantillaPublicada('acta-propia')).toBeNull()

    const publicada = await como(admin, () => publicarPlantilla({ id: guardada.id, version: 1 }))
    expect(publicada).toEqual({ ok: true, slug: 'acta-propia' })
    expect(revalidadas).toEqual(['/plantillas', '/plantillas/acta-propia'])
    expect((await plantillaPublicada('acta-propia'))?.version).toBe(1)
    const otraVez = await como(admin, () => publicarPlantilla({ id: guardada.id, version: 1 }))
    expect(otraVez).toEqual({ ok: false, mensaje: 'Solo se publica un borrador; esa versión ya fue publicada.' })

    const v2 = await como(admin, () =>
      guardarPlantilla({
        id: guardada.id,
        slug: 'acta-propia',
        titulo: 'Acta propia',
        descripcion: 'De prueba',
        categoria: 'CONTRACT',
        fuente: `${FUENTE}\n\nVersión dos.`,
      }),
    )
    expect(v2.ok && v2.version).toBe(2)
    const { versiones, actual } = await como(admin, () => plantillaParaEditar(admin.sesion, guardada.id))
    expect(versiones.map((v) => [v.version, v.estado])).toEqual([
      [2, VersionState.DRAFT],
      [1, VersionState.PUBLISHED],
    ])
    expect(actual.fuente.endsWith('Versión dos.')).toBe(true)
  })

  it('reglas: slug unico, solo administradores y las del sistema no se editan', async () => {
    const repetida = await como(admin, () =>
      guardarPlantilla({
        slug: 'acta-de-mediacion',
        titulo: 'Copia',
        descripcion: '',
        categoria: 'MEDIATION_MINUTE',
        fuente: FUENTE,
      }),
    )
    expect(repetida).toEqual({ ok: false, mensaje: 'Ya existe una plantilla con esa dirección (slug).' })
    const invalida = await como(admin, () =>
      guardarPlantilla({ slug: 'con espacios', titulo: 'x', descripcion: '', categoria: 'CONTRACT', fuente: FUENTE }),
    )
    expect(invalida).toMatchObject({ ok: false, campos: { slug: expect.any(String), titulo: expect.any(String) } })
    const deMiembro = await como(ana, () =>
      guardarPlantilla({ slug: 'de-ana', titulo: 'De Ana', descripcion: '', categoria: 'CONTRACT', fuente: FUENTE }),
    )
    expect(deMiembro.ok).toBe(false)
    const sistema = '00000000-0000-4000-8000-0000000000a1'
    const ajena = await como(admin, () =>
      guardarPlantilla({
        id: sistema,
        slug: 'acta-conciliacion-arrendamiento',
        titulo: 'Cambio',
        descripcion: '',
        categoria: 'CONTRACT',
        fuente: FUENTE,
      }),
    )
    expect(ajena).toEqual({
      ok: false,
      mensaje: 'Las plantillas del sistema no se editan: crea una propia a partir de ella.',
    })
    await expect(como(admin, () => plantillaParaEditar(admin.sesion, sistema))).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
