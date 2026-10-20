'use server'

import { Code, ConnectError } from '@connectrpc/connect'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { FieldViolationsSchema } from '@/gen/actaflow/common/v1/errors_pb'
import { TemplateCategory, TemplateDiagnosticsSchema } from '@/gen/actaflow/templates/v1/template_pb'
import { valoresDeEjemplo } from '@/lib/plantillas/ejemplos'
import { sanearHtml } from '@/lib/plantillas/saneo'
import {
  vistaDiagnostico,
  vistaVariable,
  type VistaDiagnostico,
  type VistaVariable,
} from '@/lib/plantillas/servidor'
import { fallo, type Fallo } from '@/lib/rpc/errores'
import { camposConProblema } from '@/lib/sesion/esquemas'
import { clientes, comoPersona, sesionActual, type SesionActual } from '@/lib/sesion/sesion'

/**
 * Server Actions del editor de plantillas (solo administradores; legal-case lo vuelve a comprobar).
 * Publicar revalida al instante las paginas ISR de la biblioteca.
 */

type FalloPlantilla = Fallo & { diagnosticos?: VistaDiagnostico[] }
type Resultado<T> = ({ ok: true } & T) | FalloPlantilla

const MAX_FUENTE = 200_000
const fuente = z.string().min(1, { error: 'La plantilla está vacía' }).max(MAX_FUENTE)

/** Campos del contrato -> campos del formulario. */
const CAMPOS: Record<string, string> = {
  slug: 'slug',
  title: 'titulo',
  description: 'descripcion',
  category: 'categoria',
  source: 'fuente',
}

function falloPlantilla(error: unknown): FalloPlantilla {
  if (error instanceof ConnectError) {
    switch (error.code) {
      case Code.InvalidArgument: {
        const diagnosticos = error
          .findDetails(TemplateDiagnosticsSchema)
          .flatMap((d) => d.diagnostics.map(vistaDiagnostico))
        const campos: Record<string, string> = {}
        for (const detalle of error.findDetails(FieldViolationsSchema)) {
          for (const violacion of detalle.violations) {
            const campo = CAMPOS[violacion.field]
            if (campo) {
              campos[campo] = 'Revisa este campo'
            }
          }
        }
        return {
          ok: false,
          mensaje: diagnosticos.length > 0 ? `${error.rawMessage}.` : 'Hay datos que no cumplen el formato esperado.',
          ...(diagnosticos.length > 0 ? { diagnosticos } : {}),
          ...(Object.keys(campos).length > 0 ? { campos } : {}),
        }
      }
      case Code.NotFound:
      case Code.AlreadyExists:
      case Code.FailedPrecondition:
      case Code.PermissionDenied:
        return { ok: false, mensaje: `${error.rawMessage}.` }
      default:
        break
    }
  }
  return fallo(error)
}

async function conSesion<T>(trabajo: (sesion: SesionActual) => Promise<Resultado<T>>): Promise<Resultado<T>> {
  const sesion = await sesionActual().catch(() => null)
  if (!sesion) {
    return { ok: false, mensaje: 'Tu sesión venció. Recarga la página para volver a ingresar.' }
  }
  try {
    return await trabajo(sesion)
  } catch (error) {
    return falloPlantilla(error)
  }
}

type Analisis = { diagnosticos: VistaDiagnostico[]; variables: VistaVariable[]; html: string }

/** Diagnosticos, variables y vista previa con datos de ejemplo, en una sola ida al servidor. */
export async function analizarPlantilla(datos: { fuente: string }): Promise<Resultado<Analisis>> {
  const entrada = fuente.safeParse(datos.fuente)
  if (!entrada.success) {
    return { ok: false, mensaje: entrada.error.issues[0]?.message ?? 'Revisa la plantilla.' }
  }
  return conSesion<Analisis>(async (sesion) => {
    const servicio = clientes().expedientes.plantillas
    const { diagnostics, variables } = await servicio.validateTemplate(
      { source: entrada.data },
      comoPersona(sesion.tokenAcceso),
    )
    const { html } = await servicio.previewTemplate(
      { source: entrada.data, values: valoresDeEjemplo(variables) },
      comoPersona(sesion.tokenAcceso),
    )
    return {
      ok: true,
      diagnosticos: diagnostics.map(vistaDiagnostico),
      variables: variables.map(vistaVariable),
      html: sanearHtml(html),
    }
  })
}

const esquemaGuardar = z.object({
  id: z.uuid().optional(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .max(120)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, { error: 'Solo minúsculas, números y guiones, como acta-arrendamiento' }),
  titulo: z.string().trim().min(3, { error: 'Entre 3 y 160 caracteres' }).max(160, { error: 'Entre 3 y 160 caracteres' }),
  descripcion: z.string().trim().max(500, { error: 'Máximo 500 caracteres' }),
  categoria: z.enum(['CONCILIATION_AGREEMENT', 'NO_AGREEMENT_RECORD', 'MEDIATION_MINUTE', 'CONTRACT']),
  fuente,
})

type Guardado = { id: string; version: number }

export async function guardarPlantilla(datos: z.input<typeof esquemaGuardar>): Promise<Resultado<Guardado>> {
  const entrada = esquemaGuardar.safeParse(datos)
  if (!entrada.success) {
    return { ok: false, mensaje: 'Revisa los campos marcados.', campos: camposConProblema(entrada.error) }
  }
  const d = entrada.data
  return conSesion<Guardado>(async (sesion) => {
    const { template } = await clientes().expedientes.plantillas.saveTemplateDraft(
      {
        templateId: d.id ?? '',
        slug: d.slug,
        title: d.titulo,
        description: d.descripcion,
        category: TemplateCategory[d.categoria],
        source: d.fuente,
      },
      comoPersona(sesion.tokenAcceso),
    )
    return { ok: true, id: template?.id ?? '', version: template?.version ?? 0 }
  })
}

const esquemaPublicar = z.object({ id: z.uuid(), version: z.number().int().min(1) })

type Publicado = { slug: string }

export async function publicarPlantilla(datos: z.input<typeof esquemaPublicar>): Promise<Resultado<Publicado>> {
  const entrada = esquemaPublicar.safeParse(datos)
  if (!entrada.success) {
    return { ok: false, mensaje: 'Versión no válida.' }
  }
  return conSesion<Publicado>(async (sesion) => {
    const { template } = await clientes().expedientes.plantillas.publishTemplate(
      { templateId: entrada.data.id, version: entrada.data.version },
      comoPersona(sesion.tokenAcceso),
    )
    const slug = template?.slug ?? ''
    // ISR bajo demanda: la biblioteca y la pagina de la plantilla se regeneran ya, no en 10 minutos.
    revalidatePath('/plantillas')
    if (slug) {
      revalidatePath(`/plantillas/${slug}`)
    }
    return { ok: true, slug }
  })
}

let ultimaRegeneracion = 0
const ESPERA_REGENERACION_MS = 30_000

/**
 * Pide regenerar la biblioteca cuando quedo con el aviso de "no disponible" (por ejemplo, si el
 * build de Vercel encontro dormido a legal-case). Publica pero acotada: como mucho una vez cada
 * 30 s por instancia, para que nadie la use para martillar el backend.
 */
export async function regenerarBiblioteca(): Promise<{ pedida: boolean }> {
  const ahora = Date.now()
  if (ahora - ultimaRegeneracion < ESPERA_REGENERACION_MS) {
    return { pedida: false }
  }
  ultimaRegeneracion = ahora
  revalidatePath('/plantillas')
  return { pedida: true }
}
