import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Encabezado } from '@/components/marca/Encabezado'
import { PiePagina } from '@/components/marca/PiePagina'
import { FuenteResaltada } from '@/components/plantillas/FuenteResaltada'
import { TablaVariables } from '@/components/plantillas/TablaVariables'
import { CATEGORIA } from '@/lib/plantillas/etiquetas'
import { bibliotecaPublicada, plantillaPublicada } from '@/lib/plantillas/servidor'

// ISR: las publicadas se generan en el build; una nueva se genera la primera vez que se pide
// (dynamicParams) y queda en cache. Publicar una version la revalida al instante.
export const revalidate = 600
export const dynamicParams = true
export const maxDuration = 120

type Parametros = { params: Promise<{ slug: string }> }

export async function generateStaticParams(): Promise<{ slug: string }[]> {
  const plantillas = await bibliotecaPublicada()
  return (plantillas ?? []).map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: Parametros): Promise<Metadata> {
  const plantilla = await plantillaPublicada((await params).slug)
  return plantilla ? { title: plantilla.titulo, description: plantilla.descripcion } : { title: 'Plantilla' }
}

const fechaLarga = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : null

export default async function Plantilla({ params }: Parametros) {
  const plantilla = await plantillaPublicada((await params).slug)
  if (!plantilla) {
    notFound()
  }
  return (
    <>
      <Encabezado />
      <main id="contenido" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <Link
          href="/plantillas"
          className="inline-flex items-center gap-1.5 text-sm text-institucional underline-offset-4 hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" /> Plantillas
        </Link>
        <p className="folio entrada mt-6 text-lacre">{CATEGORIA[plantilla.categoria]}</p>
        <h1 className="titular entrada mt-3 text-4xl sm:text-5xl" style={{ '--i': 1 }}>
          {plantilla.titulo}
        </h1>
        {plantilla.descripcion ? (
          <p className="entrada mt-4 max-w-3xl leading-relaxed text-tinta-suave" style={{ '--i': 2 }}>
            {plantilla.descripcion}
          </p>
        ) : null}
        <p className="entrada mt-3 text-sm text-tinta-suave" style={{ '--i': 2 }}>
          Versión {plantilla.version}
          {fechaLarga(plantilla.publicada) ? ` · publicada el ${fechaLarga(plantilla.publicada)}` : ''}
        </p>

        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section aria-labelledby="titulo-fuente">
            <h2 id="titulo-fuente" className="titular text-2xl">
              Texto de la plantilla
            </h2>
            <p className="mt-1 mb-4 text-sm text-tinta-suave">
              Lo resaltado se completa en cada acta: <code className="font-mono">{'{{ variables }}'}</code> y bloques{' '}
              <code className="font-mono">{'{% si %}'}</code> o <code className="font-mono">{'{% para cada %}'}</code>.
            </p>
            <FuenteResaltada fuente={plantilla.fuente} etiqueta={`Texto de ${plantilla.titulo}`} />
          </section>
          <section aria-labelledby="titulo-variables">
            <h2 id="titulo-variables" className="titular text-2xl">
              Variables
            </h2>
            <p className="mt-1 mb-4 text-sm text-tinta-suave">
              Deducidas del texto: su tipo sale del formato con que se usan.
            </p>
            <TablaVariables variables={plantilla.variables} />
          </section>
        </div>
      </main>
      <PiePagina />
    </>
  )
}
