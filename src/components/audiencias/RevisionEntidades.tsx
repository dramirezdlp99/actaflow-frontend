'use client'

import { Check, Pencil, X } from 'lucide-react'
import { ReviewState, type EntityExtractionResult } from '@/gen/actaflow/legal/v1/entities_pb'
import { describir, FAMILIAS, type Decision } from '@/lib/audiencias/entidades'

const BOTON =
  'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition disabled:opacity-60'

/**
 * Cada entidad propuesta por el motor, con lo que dijo la persona (el fragmento) y tres decisiones:
 * confirmar, corregir el dato principal o descartar. Quien no revisa (las partes) solo la ve.
 */
export function RevisionEntidades({
  resultado,
  decisiones,
  editable,
  alDecidir,
}: {
  resultado: EntityExtractionResult
  decisiones: Map<string, Decision>
  editable: boolean
  alDecidir: (id: string, decision: Decision | null) => void
}) {
  const familias = FAMILIAS.filter(({ clave }) => resultado[clave].length > 0)
  if (familias.length === 0) {
    return <p className="mt-4 text-sm text-tinta-suave">El motor no encontró partes, montos, plazos ni compromisos.</p>
  }
  return (
    <div className="mt-4 grid gap-6">
      {familias.map(({ clave, titulo }) => (
        <section key={clave} aria-label={titulo}>
          <h4 className="folio text-lacre">{titulo}</h4>
          <ul className="mt-2 grid gap-2">
            {resultado[clave].map((e) => {
              const d = describir(e, resultado.parties)
              const decision = decisiones.get(e.id)
              const estado = decision?.estado ?? ReviewState.UNSPECIFIED
              const descartada = estado === ReviewState.REJECTED
              return (
                <li
                  key={e.id}
                  className={`rounded-xl border px-4 py-3 ${
                    estado === ReviewState.CONFIRMED || estado === ReviewState.CORRECTED
                      ? 'border-exito/40 bg-superficie'
                      : 'border-linea bg-superficie'
                  } ${descartada ? 'opacity-60' : ''}`}
                >
                  <p className={`font-semibold ${descartada ? 'line-through' : ''}`}>
                    {estado === ReviewState.CORRECTED && decision?.correccion ? decision.correccion : d.titulo}
                  </p>
                  {d.detalle ? <p className="text-sm text-tinta-suave">{d.detalle}</p> : null}
                  {e.source?.fragment ? (
                    <p className="mt-1 text-xs italic text-tinta-suave">«{e.source.fragment}»</p>
                  ) : null}
                  {e.requiresConfirmation && estado === ReviewState.UNSPECIFIED ? (
                    <p className="mt-1 text-xs font-medium text-alerta">El motor no está seguro: revísala.</p>
                  ) : null}
                  {editable ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        aria-pressed={estado === ReviewState.CONFIRMED}
                        onClick={() =>
                          alDecidir(e.id, estado === ReviewState.CONFIRMED ? null : { estado: ReviewState.CONFIRMED })
                        }
                        className={`${BOTON} ${estado === ReviewState.CONFIRMED ? 'border-exito bg-exito/10 text-exito' : 'border-linea hover:border-exito'}`}
                      >
                        <Check aria-hidden className="size-3.5" /> Confirmar
                      </button>
                      <button
                        type="button"
                        aria-pressed={estado === ReviewState.CORRECTED}
                        onClick={() =>
                          alDecidir(
                            e.id,
                            estado === ReviewState.CORRECTED ? null : { estado: ReviewState.CORRECTED, correccion: d.editable },
                          )
                        }
                        className={`${BOTON} ${estado === ReviewState.CORRECTED ? 'border-institucional bg-institucional-suave text-institucional' : 'border-linea hover:border-institucional'}`}
                      >
                        <Pencil aria-hidden className="size-3.5" /> Corregir
                      </button>
                      <button
                        type="button"
                        aria-pressed={descartada}
                        onClick={() => alDecidir(e.id, descartada ? null : { estado: ReviewState.REJECTED })}
                        className={`${BOTON} ${descartada ? 'border-error bg-lacre-suave text-error' : 'border-linea hover:border-error'}`}
                      >
                        <X aria-hidden className="size-3.5" /> Descartar
                      </button>
                      {estado === ReviewState.CORRECTED ? (
                        <label className="flex min-w-56 flex-1 items-center gap-2 text-xs">
                          <span className="sr-only">Valor corregido</span>
                          <input
                            value={decision?.correccion ?? ''}
                            maxLength={500}
                            inputMode={e.value.case === 'amount' ? 'numeric' : 'text'}
                            onChange={(ev) =>
                              alDecidir(e.id, { estado: ReviewState.CORRECTED, correccion: ev.target.value })
                            }
                            className="w-full rounded-lg border border-linea bg-papel px-3 py-1.5 text-sm"
                          />
                        </label>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
