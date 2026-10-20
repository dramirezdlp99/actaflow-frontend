import { CalendarClock, FolderPlus, Users } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { Encabezado } from '@/components/marca/Encabezado'
import { PiePagina } from '@/components/marca/PiePagina'
import { PlatformRole } from '@/gen/actaflow/identity/v1/account_pb'
import { ESTADO, FILTROS, ROL, TIPO, TONO_ESTADO, filtroDe } from '@/lib/expedientes/etiquetas'
import { listarCasos } from '@/lib/expedientes/servidor'
import { exigirSesion, type SesionActual } from '@/lib/sesion/sesion'

export const metadata: Metadata = { title: 'Expedientes' }
// SSR por persona: cada quien ve solo sus casos; nunca en una cache compartida.
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const TAMANO = 20
const fechaCorta = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const fechaHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : null

export default async function Expedientes({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; pagina?: string }>
}) {
  const sesion = await exigirSesion('/expedientes')
  const { estado, pagina } = await searchParams
  const filtro = filtroDe(estado)
  const puedeCrear = sesion.cuenta.role !== PlatformRole.EXTERNAL

  return (
    <>
      <Encabezado enSesion />
      <main id="contenido" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="folio entrada text-lacre">Archivo</p>
            <h1 className="titular entrada mt-3 text-4xl sm:text-5xl" style={{ '--i': 1 }}>
              Expedientes
            </h1>
            <p className="entrada mt-3 max-w-2xl text-tinta-suave" style={{ '--i': 2 }}>
              Solo ves los casos donde participas. El título y el resumen de cada uno se abren dentro del expediente, en
              tu navegador.
            </p>
          </div>
          {puedeCrear ? (
            <Link
              href="/expedientes/nuevo"
              prefetch={false}
              className="entrada inline-flex items-center gap-2 rounded-lg bg-institucional px-5 py-3 text-sm font-semibold text-sobre-institucional shadow-suave transition hover:brightness-110"
              style={{ '--i': 2 }}
            >
              <FolderPlus aria-hidden className="size-4" /> Nuevo expediente
            </Link>
          ) : null}
        </div>

        <nav aria-label="Filtrar por estado" className="entrada mt-8 flex flex-wrap gap-2" style={{ '--i': 3 }}>
          {FILTROS.map((f) => (
            <Link
              key={f.valor}
              href={f.valor ? `/expedientes?estado=${f.valor}` : '/expedientes'}
              prefetch={false}
              aria-current={f.valor === filtro.valor ? 'page' : undefined}
              className="rounded-full border border-linea px-3.5 py-1.5 text-sm transition hover:border-institucional aria-[current=page]:border-institucional aria-[current=page]:bg-institucional aria-[current=page]:text-sobre-institucional"
            >
              {f.texto}
            </Link>
          ))}
        </nav>

        <Suspense key={`${filtro.valor}/${pagina ?? ''}`} fallback={<EsqueletoLista />}>
          <Lista sesion={sesion} filtro={filtro} pagina={pagina ?? ''} />
        </Suspense>
      </main>
      <PiePagina />
    </>
  )
}

async function Lista({
  sesion,
  filtro,
  pagina,
}: {
  sesion: SesionActual
  filtro: ReturnType<typeof filtroDe>
  pagina: string
}) {
  const { casos, siguiente } = await listarCasos(sesion, filtro.estado, TAMANO, pagina)
  if (casos.length === 0) {
    return (
      <div className="hoja mt-8 rounded-2xl py-12 pl-16 pr-8 text-center">
        <p className="titular text-2xl">{pagina ? 'No hay más expedientes' : 'Aún no hay expedientes aquí'}</p>
        <p className="mt-2 text-tinta-suave">
          Cuando crees uno o alguien te invite a un caso, aparecerá en esta lista.
        </p>
      </div>
    )
  }
  return (
    <>
      <ul className="mt-8 grid gap-3" aria-label="Expedientes">
        {casos.map(({ caso, rol }, i) => (
          <li key={caso.id} className="entrada" style={{ '--i': Math.min(i, 8) }}>
            <Link
              href={`/expedientes/${caso.id}`}
              prefetch={false}
              className="group grid gap-3 rounded-2xl border border-linea bg-superficie p-5 shadow-suave transition hover:-translate-y-0.5 hover:border-institucional sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-lg font-semibold tracking-wide group-hover:text-institucional">
                    {caso.radicado}
                  </span>
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${TONO_ESTADO[caso.estado]}`}
                  >
                    {ESTADO[caso.estado]}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-tinta-suave">
                  {TIPO[caso.tipo]} · Tu rol: <span className="text-tinta">{ROL[rol]}</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-tinta-suave sm:justify-end">
                {fechaHora(caso.audiencia) ? (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarClock aria-hidden className="size-3.5" /> {fechaHora(caso.audiencia)}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1.5">
                  <Users aria-hidden className="size-3.5" /> {caso.participantes}
                </span>
                <span>Actividad: {fechaCorta(caso.actividad)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <nav aria-label="Páginas" className="mt-6 flex justify-between text-sm">
        {pagina ? (
          <Link
            href={filtro.valor ? `/expedientes?estado=${filtro.valor}` : '/expedientes'}
            prefetch={false}
            className="font-medium text-institucional hover:underline"
          >
            ← Primera página
          </Link>
        ) : (
          <span />
        )}
        {siguiente ? (
          <Link
            href={`/expedientes?${new URLSearchParams({ ...(filtro.valor ? { estado: filtro.valor } : {}), pagina: siguiente })}`}
            prefetch={false}
            className="font-medium text-institucional hover:underline"
          >
            Siguientes →
          </Link>
        ) : null}
      </nav>
    </>
  )
}

function EsqueletoLista() {
  return (
    <ul aria-busy className="mt-8 grid gap-3">
      <li className="sr-only">Cargando expedientes…</li>
      {[0, 1, 2].map((i) => (
        <li key={i} className="h-24 animate-pulse rounded-2xl border border-linea bg-papel-hondo/60" />
      ))}
    </ul>
  )
}
