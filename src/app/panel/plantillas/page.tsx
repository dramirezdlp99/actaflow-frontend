import { FilePlus2, Pencil } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Encabezado } from '@/components/marca/Encabezado'
import { PiePagina } from '@/components/marca/PiePagina'
import { PlatformRole } from '@/gen/actaflow/identity/v1/account_pb'
import { CATEGORIA, ESTADO_VERSION, TONO_VERSION } from '@/lib/plantillas/etiquetas'
import { bibliotecaPublicada, plantillasDeMiOrganizacion } from '@/lib/plantillas/servidor'
import { exigirSesion } from '@/lib/sesion/sesion'

export const metadata: Metadata = { title: 'Plantillas de la organización' }
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const fechaCorta = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export default async function PlantillasDeLaOrganizacion() {
  const sesion = await exigirSesion('/panel/plantillas')
  const esAdmin = sesion.cuenta.role === PlatformRole.ADMIN
  const [propias, biblioteca] = esAdmin
    ? await Promise.all([plantillasDeMiOrganizacion(sesion), bibliotecaPublicada()])
    : [[], []]
  const idsPropios = new Set(propias.map((p) => p.id))
  const ajenas = (biblioteca ?? []).filter((p) => !idsPropios.has(p.id))

  return (
    <>
      <Encabezado enSesion />
      <main id="contenido" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="folio entrada text-lacre">Administración</p>
            <h1 className="titular entrada mt-3 text-4xl sm:text-5xl" style={{ '--i': 1 }}>
              Plantillas
            </h1>
            <p className="entrada mt-3 max-w-2xl text-tinta-suave" style={{ '--i': 2 }}>
              Los borradores solo los ve tu organización. Al publicar una versión aparece en la biblioteca pública.
            </p>
          </div>
          {esAdmin ? (
            <Link
              href="/panel/plantillas/nueva"
              prefetch={false}
              className="entrada inline-flex items-center gap-2 rounded-lg bg-institucional px-5 py-3 text-sm font-semibold text-sobre-institucional shadow-suave transition hover:brightness-110"
              style={{ '--i': 2 }}
            >
              <FilePlus2 aria-hidden className="size-4" /> Nueva plantilla
            </Link>
          ) : null}
        </div>

        {!esAdmin ? (
          <div className="hoja mt-10 rounded-2xl py-12 pl-16 pr-8">
            <p className="titular text-2xl">Solo los administradores gestionan plantillas</p>
            <p className="mt-2 text-tinta-suave">
              Puedes consultar las publicadas en la{' '}
              <Link href="/plantillas" className="text-institucional underline underline-offset-4">
                biblioteca
              </Link>
              .
            </p>
          </div>
        ) : (
          <>
            <section aria-labelledby="titulo-propias" className="mt-10">
              <h2 id="titulo-propias" className="folio text-tinta-suave">
                De tu organización
              </h2>
              {propias.length === 0 ? (
                <p className="mt-4 text-tinta-suave">
                  Aún no hay plantillas propias. Crea una nueva o parte de una de la biblioteca.
                </p>
              ) : (
                <ul className="mt-4 grid gap-3" aria-label="Plantillas de tu organización">
                  {propias.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/panel/plantillas/${p.id}`}
                        prefetch={false}
                        className="group grid gap-2 rounded-2xl border border-linea bg-superficie p-5 shadow-suave transition hover:border-institucional sm:grid-cols-[1fr_auto] sm:items-center"
                      >
                        <div className="min-w-0">
                          <p className="font-semibold group-hover:text-institucional">{p.titulo}</p>
                          <p className="mt-1 text-sm text-tinta-suave">
                            {CATEGORIA[p.categoria]} · /plantillas/{p.slug}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-tinta-suave">
                          <span>
                            Versión {p.version} · {fechaCorta(p.actualizada)}
                          </span>
                          <span
                            className={`rounded-full border px-2.5 py-0.5 font-semibold uppercase tracking-wider ${TONO_VERSION[p.estado]}`}
                          >
                            {ESTADO_VERSION[p.estado]}
                          </span>
                          <Pencil aria-hidden className="size-4" />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="titulo-base" className="mt-12">
              <h2 id="titulo-base" className="folio text-tinta-suave">
                Partir de la biblioteca
              </h2>
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {ajenas.map((p) => (
                  <li key={p.id} className="rounded-2xl border border-linea bg-superficie p-5">
                    <p className="font-semibold">{p.titulo}</p>
                    <p className="mt-1 text-sm text-tinta-suave">{CATEGORIA[p.categoria]}</p>
                    <div className="mt-4 flex flex-wrap gap-4 text-sm">
                      <Link
                        href={`/panel/plantillas/nueva?base=${encodeURIComponent(p.slug)}`}
                        prefetch={false}
                        className="font-semibold text-institucional underline-offset-4 hover:underline"
                      >
                        Usar como base
                      </Link>
                      <Link
                        href={`/plantillas/${p.slug}`}
                        className="text-tinta-suave underline-offset-4 hover:underline"
                      >
                        Ver
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
      <PiePagina />
    </>
  )
}
