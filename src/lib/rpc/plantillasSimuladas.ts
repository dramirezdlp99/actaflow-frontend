import 'server-only'
import { randomUUID } from 'node:crypto'
import { create } from '@bufbuild/protobuf'
import { timestampFromMs } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError, type ConnectRouter, type HandlerContext } from '@connectrpc/connect'
import { ErrorReasonSchema } from '@/gen/actaflow/common/v1/errors_pb'
import { PlatformRole } from '@/gen/actaflow/identity/v1/account_pb'
import {
  TemplateCategory,
  TemplateDiagnosticsSchema,
  TemplateSchema,
  TemplateService,
  VersionState,
  DiagnosticSeverity,
  type Template,
} from '@/gen/actaflow/templates/v1/template_pb'
import { cuentaDeTokenSimulado } from './identidadSimulada'
import { analizar, html } from './lenguajeSimulado'

/**
 * TemplateService SIMULADO en memoria (solo ACTAFLOW_RPC_MODE=mock), con las mismas reglas que
 * legal-case-service: biblioteca publica sin sesion, solo administradores para lo demas, solo la
 * organizacion autora edita, plantillas del sistema de solo lectura y versiones con publicacion.
 */

type Version = {
  numero: number
  estado: VersionState
  titulo: string
  descripcion: string
  categoria: TemplateCategory
  fuente: string
  actualizada: number
  publicada: number | null
}

type Plantilla = { id: string; slug: string; organizacion: string | null; versiones: Version[] }

const INICIO = Date.parse('2026-10-20T00:00:00Z')

/** Las mismas plantillas del sistema que la migracion V4 de legal-case-service. */
const SEMILLAS = [
  {
    id: '00000000-0000-4000-8000-0000000000a1',
    slug: 'acta-conciliacion-arrendamiento',
    titulo: "Acta de conciliación con acuerdo: arrendamiento",
    descripcion: "Acuerdo de pago de cánones adeudados y restitución del inmueble, con pago único o por cuotas.",
    categoria: TemplateCategory.CONCILIATION_AGREEMENT,
    fuente: "# ACTA DE CONCILIACIÓN No. {{ caso.radicado }}\n\nEn la ciudad de {{ caso.ciudad }}, el {{ audiencia.fecha | fecha_en_letras }}, ante **{{ conciliador.nombre }}**, conciliador(a) en derecho, comparecieron:\n\n**Convocante:** {{ partes.convocante.nombre }}, identificado(a) con {{ partes.convocante.documento }}.\n**Convocado:** {{ partes.convocado.nombre }}, identificado(a) con {{ partes.convocado.documento }}.\n{% si partes.convocante.apoderado %}\n**Apoderado(a) del convocante:** {{ partes.convocante.apoderado }}.\n{% fin %}\n\n## Hechos\n\nLas partes celebraron un contrato de arrendamiento sobre el inmueble ubicado en {{ inmueble.direccion }}. El convocante manifiesta que el convocado adeuda cánones de arrendamiento por {{ acuerdo.monto | moneda_en_letras }}.\n\n## Acuerdo\n\nLas partes acuerdan, de manera libre y voluntaria, lo siguiente:\n\n{% si acuerdo.cuotas > 0 %}\nPRIMERO. El convocado pagará {{ acuerdo.monto | moneda_en_letras }} en {{ acuerdo.cuotas | numero_en_letras }} cuotas, así:\n\n{% para cada cuota en acuerdo.plan %}\nCuota de {{ cuota.valor | moneda }} con vencimiento el {{ cuota.fecha | fecha }}.\n{% fin %}\n{% sino %}\nPRIMERO. El convocado pagará {{ acuerdo.monto | moneda_en_letras }} en un solo pago, a más tardar el {{ acuerdo.fecha_pago | fecha }}.\n{% fin %}\n\nSEGUNDO. El convocado restituirá el inmueble a más tardar el {{ acuerdo.fecha_restitucion | fecha }}.\n\n{% si acuerdo.clausula_penal %}\nTERCERO. Si el convocado incumple, pagará a título de cláusula penal {{ acuerdo.clausula_penal | moneda_en_letras }}.\n{% fin %}\n\nEste acuerdo hace tránsito a cosa juzgada y presta mérito ejecutivo, conforme a la Ley 2220 de 2022.\n\nPara constancia, firman quienes intervinieron.",
  },
  {
    id: '00000000-0000-4000-8000-0000000000a2',
    slug: 'constancia-de-no-acuerdo',
    titulo: "Constancia de no acuerdo",
    descripcion: "Constancia de que la audiencia se celebró sin acuerdo, o de que una parte no asistió.",
    categoria: TemplateCategory.NO_AGREEMENT_RECORD,
    fuente: "# CONSTANCIA DE NO ACUERDO No. {{ caso.radicado }}\n\nEl suscrito conciliador, **{{ conciliador.nombre }}**, hace constar que el {{ audiencia.fecha | fecha_en_letras }} se celebró en {{ caso.ciudad }} la audiencia de conciliación solicitada por {{ partes.convocante.nombre }} frente a {{ partes.convocado.nombre }}.\n\n{% si audiencia.inasistencia %}\nLa parte {{ audiencia.parte_inasistente }} no asistió a la audiencia{% si audiencia.justifico %} y presentó justificación dentro del término legal{% sino %} y no presentó justificación{% fin %}.\n{% sino %}\nAmbas partes asistieron y expusieron sus pretensiones, pero no fue posible llegar a un acuerdo.\n{% fin %}\n\nLas pretensiones de la solicitud ascienden a {{ pretensiones.cuantia | moneda_en_letras }}.\n\nSe expide la presente constancia a solicitud de parte.",
  },
  {
    id: '00000000-0000-4000-8000-0000000000a3',
    slug: 'acta-de-mediacion',
    titulo: "Acta de mediación",
    descripcion: "Registro de participantes, situación y compromisos de una mediación, con seguimiento opcional.",
    categoria: TemplateCategory.MEDIATION_MINUTE,
    fuente: "# ACTA DE MEDIACIÓN\n\nLugar y fecha: {{ caso.ciudad }}, {{ audiencia.fecha | fecha }}.\nMediador(a): {{ mediador.nombre }}.\n\n## Participantes\n\n{% para cada participante en participantes %}\n**{{ participante.nombre }}**, {{ participante.calidad }}.\n{% fin %}\n\n## Situación\n\n{{ situacion.descripcion }}\n\n## Compromisos\n\n{% para cada compromiso en compromisos %}\n{{ compromiso.responsable }} se compromete a {{ compromiso.descripcion }}{% si compromiso.fecha %}, a más tardar el {{ compromiso.fecha | fecha }}{% fin %}.\n{% fin %}\n\n{% si seguimiento.fecha %}\nLas partes acuerdan una reunión de seguimiento el {{ seguimiento.fecha | fecha }}.\n{% fin %}\n\nLa mediación es voluntaria y confidencial; este documento recoge los compromisos que las partes aceptaron.",
  },
]

function vacio(): Map<string, Plantilla> {
  return new Map(
    SEMILLAS.map((s) => [
      s.id,
      {
        id: s.id,
        slug: s.slug,
        organizacion: null,
        versiones: [
          {
            numero: 1,
            estado: VersionState.PUBLISHED,
            titulo: s.titulo,
            descripcion: s.descripcion,
            categoria: s.categoria,
            fuente: s.fuente,
            actualizada: INICIO,
            publicada: INICIO,
          },
        ],
      },
    ]),
  )
}

declare global {
  var __actaflowPlantillasSimuladas: Map<string, Plantilla> | undefined
}

function plantillas(): Map<string, Plantilla> {
  globalThis.__actaflowPlantillasSimuladas ??= vacio()
  return globalThis.__actaflowPlantillasSimuladas
}

export function reiniciarPlantillasSimuladas(): void {
  globalThis.__actaflowPlantillasSimuladas = vacio()
}

const fallo = (mensaje: string, codigo: Code) => new ConnectError(mensaje, codigo)

function conSesion(contexto: HandlerContext) {
  const cabecera = contexto.requestHeader.get('authorization') ?? ''
  const quien = cabecera.startsWith('Bearer ') ? cuentaDeTokenSimulado(cabecera.slice(7)) : null
  if (!quien) {
    throw fallo('Sesion vencida o no valida', Code.Unauthenticated)
  }
  return quien
}

function administrador(contexto: HandlerContext) {
  const quien = conSesion(contexto)
  if (quien.rol !== PlatformRole.ADMIN) {
    throw fallo('Solo los administradores gestionan plantillas', Code.PermissionDenied)
  }
  return quien
}

function propia(contexto: HandlerContext, id: string): Plantilla {
  const quien = administrador(contexto)
  const plantilla = plantillas().get(id)
  if (!plantilla) {
    throw fallo('La plantilla no existe', Code.NotFound)
  }
  if (plantilla.organizacion === null) {
    throw fallo('Las plantillas del sistema no se editan: crea una propia a partir de ella', Code.PermissionDenied)
  }
  if (plantilla.organizacion !== quien.organizacion) {
    throw fallo('Solo la organización autora edita esta plantilla', Code.PermissionDenied)
  }
  return plantilla
}

function contrato(p: Plantilla, v: Version, conFuente: boolean): Template {
  return create(TemplateSchema, {
    id: p.id,
    slug: p.slug,
    title: v.titulo,
    description: v.descripcion,
    category: v.categoria,
    version: v.numero,
    state: v.estado,
    source: conFuente ? v.fuente : '',
    variables: analizar(v.fuente).variables,
    updatedAt: timestampFromMs(v.actualizada),
    publishedAt: v.publicada === null ? undefined : timestampFromMs(v.publicada),
  })
}

const publicadaDe = (p: Plantilla) => p.versiones.find((v) => v.estado === VersionState.PUBLISHED)
const ultimaDe = (p: Plantilla) => p.versiones.reduce((a, b) => (b.numero > a.numero ? b : a))

function paginar<T>(lista: T[], tamano: number, token: string) {
  const desde = token ? Number.parseInt(token, 10) || 0 : 0
  const pagina = lista.slice(desde, desde + tamano)
  return { pagina, siguiente: desde + tamano < lista.length ? String(desde + tamano) : '' }
}

export function registrarPlantillasSimuladas(router: ConnectRouter): void {
  router.service(TemplateService, {
    listPublishedTemplates(peticion) {
      const lista = [...plantillas().values()]
        .flatMap((p) => {
          const v = publicadaDe(p)
          return v && (!peticion.category || v.categoria === peticion.category) ? [contrato(p, v, false)] : []
        })
        .sort((a, b) => a.title.localeCompare(b.title, 'es') || a.id.localeCompare(b.id))
      const { pagina, siguiente } = paginar(lista, peticion.page?.pageSize ?? 20, peticion.page?.pageToken ?? '')
      return { templates: pagina, pageInfo: { nextPageToken: siguiente } }
    },
    getPublishedTemplate(peticion) {
      for (const p of plantillas().values()) {
        const v = publicadaDe(p)
        if (p.slug === peticion.slug && v) {
          return { template: contrato(p, v, true) }
        }
      }
      throw fallo('No hay una plantilla publicada con ese nombre', Code.NotFound)
    },
    validateTemplate(peticion, contexto) {
      administrador(contexto)
      const { diagnosticos, variables } = analizar(peticion.source)
      return { diagnostics: diagnosticos, variables }
    },
    previewTemplate(peticion, contexto) {
      administrador(contexto)
      const { nodos, diagnosticos } = analizar(peticion.source)
      try {
        return { html: html(nodos, peticion.values), diagnostics: diagnosticos }
      } catch (error) {
        throw fallo(error instanceof Error ? error.message : 'Vista previa no disponible', Code.InvalidArgument)
      }
    },
    saveTemplateDraft(peticion, contexto) {
      const quien = administrador(contexto)
      const { diagnosticos } = analizar(peticion.source)
      const primero = diagnosticos.find((d) => d.severity === DiagnosticSeverity.ERROR)
      if (primero) {
        throw new ConnectError(
          `La plantilla tiene errores: ${primero.message} (línea ${primero.line}, columna ${primero.column})`,
          Code.InvalidArgument,
          undefined,
          [
            { desc: ErrorReasonSchema, value: { reason: 'TEMPLATE_SYNTAX_ERROR' } },
            { desc: TemplateDiagnosticsSchema, value: { diagnostics: diagnosticos } },
          ],
        )
      }
      let plantilla: Plantilla
      if (!peticion.templateId) {
        if ([...plantillas().values()].some((p) => p.slug === peticion.slug)) {
          throw fallo('Ya existe una plantilla con esa dirección (slug)', Code.AlreadyExists)
        }
        plantilla = { id: randomUUID(), slug: peticion.slug, organizacion: quien.organizacion, versiones: [] }
        plantillas().set(plantilla.id, plantilla)
      } else {
        plantilla = propia(contexto, peticion.templateId)
      }
      const datos = {
        titulo: peticion.title,
        descripcion: peticion.description,
        categoria: peticion.category,
        fuente: peticion.source,
        actualizada: Date.now(),
      }
      const ultima = plantilla.versiones.length ? ultimaDe(plantilla) : null
      let version: Version
      if (ultima?.estado === VersionState.DRAFT) {
        version = Object.assign(ultima, datos)
      } else {
        version = { numero: (ultima?.numero ?? 0) + 1, estado: VersionState.DRAFT, publicada: null, ...datos }
        plantilla.versiones.push(version)
      }
      return { template: contrato(plantilla, version, true) }
    },
    publishTemplate(peticion, contexto) {
      const plantilla = propia(contexto, peticion.templateId)
      const version = plantilla.versiones.find((v) => v.numero === peticion.version)
      if (!version) {
        throw fallo('Esa versión no existe', Code.NotFound)
      }
      if (version.estado !== VersionState.DRAFT) {
        throw fallo('Solo se publica un borrador; esa versión ya fue publicada', Code.FailedPrecondition)
      }
      const anterior = publicadaDe(plantilla)
      if (anterior) {
        anterior.estado = VersionState.SUPERSEDED
      }
      version.estado = VersionState.PUBLISHED
      version.publicada = Date.now()
      return { template: contrato(plantilla, version, true) }
    },
    listTemplateVersions(peticion, contexto) {
      const plantilla = propia(contexto, peticion.templateId)
      return {
        versions: [...plantilla.versiones].sort((a, b) => b.numero - a.numero).map((v) => contrato(plantilla, v, false)),
      }
    },
    getTemplateVersion(peticion, contexto) {
      // Como legal-case: una version publicada (del sistema o propia) la lee cualquiera con sesion
      // (el acta se llena en el navegador); un borrador, solo el administrador autor.
      const quien = conSesion(contexto)
      const plantilla = plantillas().get(peticion.templateId)
      const version = plantilla?.versiones.find((v) => v.numero === peticion.version)
      if (!plantilla || !version) {
        throw fallo('Esa versión no existe', Code.NotFound)
      }
      const alcance = plantilla.organizacion === null || plantilla.organizacion === quien.organizacion
      if (version.estado === VersionState.DRAFT || !alcance) {
        propia(contexto, peticion.templateId)
      }
      return { template: contrato(plantilla, version, true) }
    },
    listOrganizationTemplates(peticion, contexto) {
      const quien = administrador(contexto)
      const lista = [...plantillas().values()]
        .filter((p) => p.organizacion === quien.organizacion && p.versiones.length > 0)
        .map((p) => ({ p, v: ultimaDe(p) }))
        .sort((a, b) => b.v.actualizada - a.v.actualizada)
        .map(({ p, v }) => contrato(p, v, false))
      const { pagina, siguiente } = paginar(lista, peticion.page?.pageSize ?? 20, peticion.page?.pageToken ?? '')
      return { templates: pagina, pageInfo: { nextPageToken: siguiente } }
    },
  })
}

/** Para el legal-case simulado de actas: si existe esa version publicada y para quien es visible. */
export function versionPublicadaSimulada(id: string, numero: number, organizacion: string): boolean {
  const plantilla = plantillas().get(id)
  const version = plantilla?.versiones.find((v) => v.numero === numero)
  return Boolean(
    plantilla &&
      version &&
      version.estado !== VersionState.DRAFT &&
      (plantilla.organizacion === null || plantilla.organizacion === organizacion),
  )
}
