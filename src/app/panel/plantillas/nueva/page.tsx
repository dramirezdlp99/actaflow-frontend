import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Encabezado } from '@/components/marca/Encabezado'
import { PiePagina } from '@/components/marca/PiePagina'
import { EditorPlantilla, type DatosEditor } from '@/components/plantillas/EditorPlantilla'
import { PlatformRole } from '@/gen/actaflow/identity/v1/account_pb'
import { CATEGORIAS } from '@/lib/plantillas/etiquetas'
import { plantillaPublicada } from '@/lib/plantillas/servidor'
import { exigirSesion } from '@/lib/sesion/sesion'

export const metadata: Metadata = { title: 'Nueva plantilla' }
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const FUENTE_INICIAL = `# ACTA No. {{ caso.radicado }}

En la ciudad de {{ caso.ciudad }}, el {{ audiencia.fecha | fecha_en_letras }}, comparecieron **{{ partes.convocante.nombre }}** y **{{ partes.convocado.nombre }}**.

## Acuerdo

{% si acuerdo.monto %}
Las partes acuerdan el pago de {{ acuerdo.monto | moneda_en_letras }}.
{% fin %}
`

export default async function NuevaPlantilla({ searchParams }: { searchParams: Promise<{ base?: string }> }) {
  const sesion = await exigirSesion('/panel/plantillas/nueva')
  if (sesion.cuenta.role !== PlatformRole.ADMIN) {
    redirect('/panel/plantillas')
  }
  const { base } = await searchParams
  const origen = base ? await plantillaPublicada(base) : null
  const categoria = CATEGORIAS.find((c) => c.categoria === origen?.categoria)?.valor ?? 'CONCILIATION_AGREEMENT'
  const inicial: DatosEditor = origen
    ? {
        slug: `${origen.slug}-propia`.slice(0, 120),
        titulo: `${origen.titulo} (propia)`.slice(0, 160),
        descripcion: origen.descripcion,
        categoria,
        fuente: origen.fuente,
      }
    : { slug: '', titulo: '', descripcion: '', categoria, fuente: FUENTE_INICIAL }

  return (
    <>
      <Encabezado enSesion />
      <main id="contenido" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <Link
          href="/panel/plantillas"
          prefetch={false}
          className="inline-flex items-center gap-1.5 text-sm text-institucional underline-offset-4 hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" /> Plantillas
        </Link>
        <h1 className="titular mt-6 text-4xl">Nueva plantilla</h1>
        {origen ? (
          <p className="mt-2 text-tinta-suave">
            A partir de «{origen.titulo}», versión {origen.version}. La original no cambia.
          </p>
        ) : null}
        <EditorPlantilla inicial={inicial} />
      </main>
      <PiePagina />
    </>
  )
}
