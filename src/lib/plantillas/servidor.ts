import 'server-only'
import { timestampMs, type Timestamp } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError } from '@connectrpc/connect'
import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import { notFound } from 'next/navigation'
import {
  DiagnosticSeverity,
  type EntitySource,
  type Template,
  type TemplateCategory,
  type TemplateDiagnostic,
  type TemplateVariable,
  type VariableType,
  type VersionState,
} from '@/gen/actaflow/templates/v1/template_pb'
import { conDespertar } from '@/lib/rpc/clientes'
import { leerConfiguracion } from '@/lib/rpc/configuracion'
import { clientes, comoPersona, type SesionActual } from '@/lib/sesion/sesion'

/**
 * Lecturas de plantillas para los Server Components, convertidas a vistas planas.
 *
 * La biblioteca publicada se lee SIN sesion (es publica): asi /plantillas se genera con ISR. Si el
 * backend no responde durante `next build` (Render dormido), la pagina sale con un aviso y se
 * regenera en el siguiente ciclo; en tiempo de ejecucion el error se propaga para que Next siga
 * sirviendo la ultima version buena.
 */

export type VistaVariable = {
  ruta: string
  tipo: VariableType
  etiqueta: string
  requerida: boolean
  origen: EntitySource
}

export type VistaPlantilla = {
  id: string
  slug: string
  titulo: string
  descripcion: string
  categoria: TemplateCategory
  version: number
  estado: VersionState
  fuente: string
  variables: VistaVariable[]
  publicada: string | null
  actualizada: string | null
}

export type VistaDiagnostico = { error: boolean; linea: number; columna: number; mensaje: string }

const fecha = (marca: Timestamp | undefined) => (marca ? new Date(timestampMs(marca)).toISOString() : null)

export const vistaVariable = (v: TemplateVariable): VistaVariable => ({
  ruta: v.path,
  tipo: v.type,
  etiqueta: v.label,
  requerida: v.required,
  origen: v.source,
})

export const vistaDiagnostico = (d: TemplateDiagnostic): VistaDiagnostico => ({
  error: d.severity === DiagnosticSeverity.ERROR,
  linea: d.line,
  columna: d.column,
  mensaje: d.message,
})

export function vistaPlantilla(t: Template): VistaPlantilla {
  return {
    id: t.id,
    slug: t.slug,
    titulo: t.title,
    descripcion: t.description,
    categoria: t.category,
    version: t.version,
    estado: t.state,
    fuente: t.source,
    variables: t.variables.map(vistaVariable),
    publicada: fecha(t.publishedAt),
    actualizada: fecha(t.updatedAt),
  }
}

const enConstruccion = () => process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD
const MAX_PAGINAS = 10
const TAMANO_PAGINA = 100

/** Espera maxima para despertar el backend: en el build, como mucho un minuto. */
function espera(): number {
  const maxima = leerConfiguracion().esperaMaxMs
  return enConstruccion() ? Math.min(maxima, 60_000) : maxima
}

/** Toda la biblioteca publicada. `null` solo durante el build, si el backend no respondio. */
export async function bibliotecaPublicada(): Promise<VistaPlantilla[] | null> {
  try {
    const servicio = clientes().expedientes.plantillas
    const todas: VistaPlantilla[] = []
    let token = ''
    for (let i = 0; i < MAX_PAGINAS; i++) {
      const pedido = token
      const { templates, pageInfo } = await conDespertar(
        (timeoutMs) =>
          servicio.listPublishedTemplates({ page: { pageSize: TAMANO_PAGINA, pageToken: pedido } }, { timeoutMs }),
        espera(),
      )
      todas.push(...templates.map(vistaPlantilla))
      token = pageInfo?.nextPageToken ?? ''
      if (!token) {
        break
      }
    }
    return todas
  } catch (error) {
    if (enConstruccion()) {
      console.warn('Biblioteca de plantillas no disponible durante el build; se regenerara con ISR.', error)
      return null
    }
    throw error
  }
}

/** Ultima version publicada por slug; `null` si no existe. */
export async function plantillaPublicada(slug: string): Promise<VistaPlantilla | null> {
  try {
    const { template } = await conDespertar(
      (timeoutMs) => clientes().expedientes.plantillas.getPublishedTemplate({ slug }, { timeoutMs }),
      espera(),
    )
    return template ? vistaPlantilla(template) : null
  } catch (error) {
    if (error instanceof ConnectError && (error.code === Code.NotFound || error.code === Code.InvalidArgument)) {
      return null
    }
    throw error
  }
}

// ------------------------------------------------------------------------------------ administracion

/** Plantillas de la organizacion de quien llama (version mas nueva de cada una, borradores incluidos). */
export async function plantillasDeMiOrganizacion(sesion: SesionActual): Promise<VistaPlantilla[]> {
  const servicio = clientes().expedientes.plantillas
  const todas: VistaPlantilla[] = []
  let token = ''
  for (let i = 0; i < MAX_PAGINAS; i++) {
    const { templates, pageInfo } = await servicio.listOrganizationTemplates(
      { page: { pageSize: TAMANO_PAGINA, pageToken: token } },
      comoPersona(sesion.tokenAcceso),
    )
    todas.push(...templates.map(vistaPlantilla))
    token = pageInfo?.nextPageToken ?? ''
    if (!token) {
      break
    }
  }
  return todas
}

/** Una plantilla propia para el editor: sus versiones y la elegida (la mas nueva si no se indica). */
export async function plantillaParaEditar(
  sesion: SesionActual,
  id: string,
  numero?: number,
): Promise<{ versiones: VistaPlantilla[]; actual: VistaPlantilla }> {
  const servicio = clientes().expedientes.plantillas
  try {
    const { versions } = await servicio.listTemplateVersions({ templateId: id }, comoPersona(sesion.tokenAcceso))
    const elegida = numero ?? versions[0]?.version
    if (!elegida) {
      notFound()
    }
    const { template } = await servicio.getTemplateVersion(
      { templateId: id, version: elegida },
      comoPersona(sesion.tokenAcceso),
    )
    if (!template) {
      notFound()
    }
    return { versiones: versions.map(vistaPlantilla), actual: vistaPlantilla(template) }
  } catch (error) {
    if (
      error instanceof ConnectError &&
      [Code.NotFound, Code.InvalidArgument, Code.PermissionDenied].includes(error.code)
    ) {
      notFound()
    }
    throw error
  }
}
