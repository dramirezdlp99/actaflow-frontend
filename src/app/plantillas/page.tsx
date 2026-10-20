import { FileText, Variable } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Encabezado } from '@/components/marca/Encabezado'
import { PiePagina } from '@/components/marca/PiePagina'
import { CATEGORIA, CATEGORIAS } from '@/lib/plantillas/etiquetas'
import { bibliotecaPublicada, type VistaPlantilla } from '@/lib/plantillas/servidor'

export const metadata: Metadata = {
  title: 'Plantillas',
  description: 'Biblioteca pública de plantillas de actas de conciliación, constancias de no acuerdo y mediación.',
}

// ISR: la biblioteca es publica y la misma para todos. Se regenera cada 10 minutos y, ademas, al
// instante cuando un administrador publica una version (revalidatePath en la Server Action).
export const revalidate = 600
export const maxDuration = 120

const fechaCorta = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : null

export default async function Plantillas() {
  const plantillas = await bibliotecaPublicada()
  return (
    <>
      <Encabezado />
      <main id="contenido" className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <p className="folio entrada text-lacre">Biblioteca</p>
        <h1 className="titular entrada mt-3 text-4xl sm:text-5xl" style={{ '--i': 1 }}>
          Plantillas
        </h1>
        <p className="entrada mt-4 max-w-3xl leading-relaxed text-tinta-suave" style={{ '--i': 2 }}>
          Modelos de actas y constancias con variables que la IA completa a partir de lo dicho en la audiencia. Son
          públicas porque no contienen datos de ningún caso.
        </p>
        {plantillas === null ? (
          <div className="hoja mt-10 rounded-2xl py-12 pl-16 pr-8">
            <p className="titular text-2xl">La biblioteca no está disponible en este momento</p>
            <p className="mt-2 text-tinta-suave">El servicio de expedientes está despertando. Vuelve en unos minutos.</p>
          </div>
        ) : plantillas.length === 0 ? (
          <div className="hoja mt-10 rounded-2xl py-12 pl-16 pr-8">
            <p className="titular text-2xl">Aún no hay plantillas publicadas</p>
          </div>
        ) : (
          CATEGORIAS.map(({ categoria }) => {
            const grupo = plantillas.filter((p) => p.categoria === categoria)
            return grupo.length === 0 ? null : (
              <section key={categoria} aria-labelledby={`categoria-${categoria}`} className="mt-12">
                <h2 id={`categoria-${categoria}`} className="folio text-tinta-suave">
                  {CATEGORIA[categoria]}
                </h2>
                <ul className="mt-4 grid gap-4 sm:grid-cols-2">
                  {grupo.map((p, i) => (
                    <Tarjeta key={p.id} plantilla={p} indice={i} />
                  ))}
                </ul>
              </section>
            )
          })
        )}
      </main>
      <PiePagina />
    </>
  )
}

function Tarjeta({ plantilla: p, indice }: { plantilla: VistaPlantilla; indice: number }) {
  return (
    <li className="entrada" style={{ '--i': Math.min(indice, 8) }}>
      <Link
        href={`/plantillas/${p.slug}`}
        className="group flex h-full flex-col rounded-2xl border border-linea bg-superficie p-6 shadow-suave transition hover:-translate-y-0.5 hover:border-institucional"
      >
        <FileText aria-hidden className="size-5 text-lacre" />
        <h3 className="titular mt-3 text-xl group-hover:text-institucional">{p.titulo}</h3>
        {p.descripcion ? <p className="mt-2 text-sm leading-relaxed text-tinta-suave">{p.descripcion}</p> : null}
        <p className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-5 text-xs text-tinta-suave">
          <span className="inline-flex items-center gap-1.5">
            <Variable aria-hidden className="size-3.5" /> {p.variables.length} variables
          </span>
          <span>Versión {p.version}</span>
          {fechaCorta(p.publicada) ? <span>Publicada el {fechaCorta(p.publicada)}</span> : null}
        </p>
      </Link>
    </li>
  )
}
