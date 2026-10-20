import { CalendarClock, History, Users } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { AccionesEstado } from '@/components/expedientes/AccionesEstado'
import { ProveedorClaveCaso } from '@/components/expedientes/ClaveCaso'
import { DetallesCaso } from '@/components/expedientes/DetallesCaso'
import { PersonasCaso } from '@/components/expedientes/PersonasCaso'
import { Encabezado } from '@/components/marca/Encabezado'
import { PiePagina } from '@/components/marca/PiePagina'
import { CaseRole, CaseStatus } from '@/gen/actaflow/cases/v1/case_pb'
import { ESTADO, EVENTO, ROL, TIPO, TONO_ESTADO } from '@/lib/expedientes/etiquetas'
import { listarEventos, listarPersonas, obtenerCaso, type VistaMembresia } from '@/lib/expedientes/servidor'
import { exigirSesion, type SesionActual } from '@/lib/sesion/sesion'

export const metadata: Metadata = { title: 'Expediente' }
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const fechaHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' }) : null

/**
 * Streaming SSR: el encabezado (metadatos en claro) sale de inmediato; los participantes y la linea
 * de tiempo llegan despues, cada uno en su Suspense. El titulo y el resumen se descifran en el navegador.
 */
export default async function Expediente({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sesion = await exigirSesion(`/expedientes/${UUID.test(id) ? id : ''}`)
  const { caso, membresia } = await obtenerCaso(sesion, id)
  const yo: VistaMembresia = membresia ?? { participanteId: '', rol: CaseRole.UNSPECIFIED, clave: null }
  const archivado = caso.estado === CaseStatus.ARCHIVED
  const puedeEditar = !archivado && yo.rol !== CaseRole.PARTY

  return (
    <>
      <Encabezado enSesion />
      <main id="contenido" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <Link href="/expedientes" prefetch={false} className="text-sm font-medium text-institucional hover:underline">
          ← Expedientes
        </Link>
        <ProveedorClaveCaso cuentaId={sesion.cuenta.id} envoltura={yo.clave}>
          <header className="mt-6 flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="folio entrada text-lacre">
                {TIPO[caso.tipo]} · Tu rol: {ROL[yo.rol]}
              </p>
              <h1
                className="entrada mt-3 font-mono text-4xl font-semibold tracking-wide sm:text-5xl"
                style={{ '--i': 1 }}
              >
                {caso.radicado}
              </h1>
              <div
                className="entrada mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-tinta-suave"
                style={{ '--i': 2 }}
              >
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${TONO_ESTADO[caso.estado]}`}
                >
                  {ESTADO[caso.estado]}
                </span>
                {fechaHora(caso.audiencia) ? (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarClock aria-hidden className="size-4" /> Audiencia: {fechaHora(caso.audiencia)}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1.5">
                  <Users aria-hidden className="size-4" /> {caso.participantes} participantes
                </span>
              </div>
            </div>
            {yo.rol === CaseRole.CONCILIATOR ? (
              <div className="entrada" style={{ '--i': 3 }}>
                <AccionesEstado casoId={caso.id} estado={caso.estado} />
              </div>
            ) : null}
          </header>

          <div className="mt-10 grid items-start gap-8 lg:grid-cols-[1.25fr_1fr]">
            <section
              aria-label="Contenido del expediente"
              className="hoja entrada rounded-2xl py-8 pl-14 pr-6 sm:pl-16 sm:pr-10"
              style={{ '--i': 3 }}
            >
              <DetallesCaso
                casoId={caso.id}
                revision={caso.revision}
                detalles={caso.detalles}
                puedeEditar={puedeEditar}
              />
            </section>
            <section
              aria-labelledby="titulo-personas"
              className="entrada rounded-2xl border border-linea bg-superficie p-6 shadow-suave"
              style={{ '--i': 4 }}
            >
              <h2 id="titulo-personas" className="titular flex items-center gap-2 text-2xl">
                <Users aria-hidden className="size-5 text-institucional" /> Participantes
              </h2>
              <Suspense fallback={<Esqueleto filas={3} />}>
                <Personas sesion={sesion} casoId={caso.id} yo={yo} editable={!archivado} />
              </Suspense>
            </section>
          </div>
        </ProveedorClaveCaso>

        <section
          aria-labelledby="titulo-linea"
          className="entrada mt-8 rounded-2xl border border-linea bg-superficie p-6 shadow-suave"
          style={{ '--i': 5 }}
        >
          <h2 id="titulo-linea" className="titular flex items-center gap-2 text-2xl">
            <History aria-hidden className="size-5 text-institucional" /> Línea de tiempo
          </h2>
          <Suspense fallback={<Esqueleto filas={4} />}>
            <LineaDeTiempo sesion={sesion} casoId={caso.id} />
          </Suspense>
        </section>
      </main>
      <PiePagina />
    </>
  )
}

async function Personas({
  sesion,
  casoId,
  yo,
  editable,
}: {
  sesion: SesionActual
  casoId: string
  yo: VistaMembresia
  editable: boolean
}) {
  const personas = await listarPersonas(sesion, casoId)
  return (
    <div className="mt-4">
      <PersonasCaso
        casoId={casoId}
        personas={personas}
        yo={{ participanteId: yo.participanteId, rol: yo.rol }}
        editable={editable}
      />
    </div>
  )
}

async function LineaDeTiempo({ sesion, casoId }: { sesion: SesionActual; casoId: string }) {
  const eventos = await listarEventos(sesion, casoId)
  return (
    <ol className="relative mt-5 grid gap-5 border-l-2 border-linea pl-6">
      {eventos.map((e) => (
        <li key={e.id} className="relative">
          <span
            aria-hidden
            className="absolute -left-[1.95rem] top-1.5 size-3 rounded-full border-2 border-superficie bg-lacre"
          />
          <p className="text-sm">
            <span className="font-semibold">{e.actor || 'Alguien'}</span> {EVENTO[e.tipo]}
          </p>
          <p className="text-xs text-tinta-suave">{fechaHora(e.cuando)}</p>
        </li>
      ))}
    </ol>
  )
}

function Esqueleto({ filas }: { filas: number }) {
  return (
    <div aria-busy className="mt-4 grid gap-3">
      <span className="sr-only">Cargando…</span>
      {Array.from({ length: filas }, (_, i) => (
        <span key={i} className="h-10 animate-pulse rounded-lg bg-papel-hondo" />
      ))}
    </div>
  )
}
