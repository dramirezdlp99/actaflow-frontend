'use client'

import { ExternalLink, Send } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { publicarPlantilla } from '@/app/acciones/plantillas'
import { AvisoError } from '@/components/cuenta/Campo'
import { VersionState } from '@/gen/actaflow/templates/v1/template_pb'
import { ESTADO_VERSION, TONO_VERSION } from '@/lib/plantillas/etiquetas'

export type VistaVersion = {
  numero: number
  estado: VersionState
  actualizada: string | null
  publicada: string | null
}

const fechaHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

/** Versiones de una plantilla, la mas nueva primero; el borrador se publica desde aqui. */
export function VersionesPlantilla({
  id,
  slug,
  versiones,
  enEdicion,
}: {
  id: string
  slug: string
  versiones: VistaVersion[]
  enEdicion: number
}) {
  const router = useRouter()
  const [publicando, setPublicando] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [publicada, setPublicada] = useState<string | null>(null)
  const hayPublicada = versiones.some((v) => v.estado === VersionState.PUBLISHED)

  async function publicar(numero: number) {
    const aviso = hayPublicada
      ? `¿Publicar la versión ${numero}? Reemplazará a la versión publicada en la biblioteca.`
      : `¿Publicar la versión ${numero}? Quedará visible para todos en la biblioteca.`
    if (!window.confirm(aviso)) {
      return
    }
    setPublicando(numero)
    setError(null)
    const respuesta = await publicarPlantilla({ id, version: numero })
    setPublicando(null)
    if (!respuesta.ok) {
      setError(respuesta.mensaje)
      return
    }
    setPublicada(respuesta.slug)
    router.refresh()
  }

  return (
    <section aria-labelledby="titulo-versiones" className="rounded-2xl border border-linea bg-superficie p-5 shadow-suave">
      <h2 id="titulo-versiones" className="titular text-xl">
        Versiones
      </h2>
      <ol className="mt-4 grid gap-3">
        {versiones.map((v) => (
          <li key={v.numero} className="flex flex-wrap items-center justify-between gap-3 border-t border-linea pt-3">
            <div>
              <p className="text-sm font-semibold">
                Versión {v.numero}
                {v.numero === enEdicion ? <span className="font-normal text-tinta-suave"> · en el editor</span> : null}
              </p>
              <p className="text-xs text-tinta-suave">
                {v.publicada ? `Publicada: ${fechaHora(v.publicada)}` : `Guardada: ${fechaHora(v.actualizada)}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${TONO_VERSION[v.estado]}`}
              >
                {ESTADO_VERSION[v.estado]}
              </span>
              {v.estado === VersionState.DRAFT ? (
                <button
                  type="button"
                  onClick={() => publicar(v.numero)}
                  disabled={publicando !== null}
                  aria-busy={publicando === v.numero || undefined}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-institucional px-3 py-1.5 text-xs font-semibold text-sobre-institucional transition hover:brightness-110 disabled:opacity-70"
                >
                  <Send aria-hidden className="size-3.5" /> {publicando === v.numero ? 'Publicando…' : 'Publicar'}
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4 grid gap-3">
        <AvisoError mensaje={error} />
        {publicada ? (
          <p role="status" className="rounded-lg border border-exito/30 px-4 py-3 text-sm font-medium text-exito">
            Publicada. La biblioteca ya muestra esta versión.
          </p>
        ) : null}
        {hayPublicada || publicada ? (
          <Link
            href={`/plantillas/${slug}`}
            className="inline-flex items-center gap-1.5 text-sm text-institucional underline-offset-4 hover:underline"
          >
            Ver en la biblioteca <ExternalLink aria-hidden className="size-3.5" />
          </Link>
        ) : null}
      </div>
    </section>
  )
}
