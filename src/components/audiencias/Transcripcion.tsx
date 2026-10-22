'use client'

import { LoaderCircle, TriangleAlert } from 'lucide-react'
import { ProcessingState, type AudioSegment } from '@/gen/actaflow/hearings/v1/hearing_pb'
import type { TranscriptionResult } from '@/gen/actaflow/legal/v1/transcript_pb'

export type Abierta = TranscriptionResult | 'error'

const ESTADO: Record<ProcessingState, string> = {
  [ProcessingState.UNSPECIFIED]: '',
  [ProcessingState.QUEUED]: 'En cola',
  [ProcessingState.PROCESSING]: 'Transcribiendo',
  [ProcessingState.DONE]: 'Lista',
  [ProcessingState.FAILED]: 'No se pudo transcribir',
}

const segundos = (ms: bigint) => {
  const s = Math.round(Number(ms) / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** La transcripcion en el orden en que se hablo. El texto se descifro en este navegador. */
export function Transcripcion({
  segmentos,
  abiertas,
  nombres,
  pendientes,
}: {
  segmentos: AudioSegment[]
  abiertas: Map<string, Abierta>
  nombres: Map<string, string>
  pendientes: number
}) {
  if (segmentos.length === 0 && pendientes === 0) {
    return (
      <p className="mt-4 text-sm text-tinta-suave">
        Aún no hay intervenciones. Cuando alguien hable con el micrófono encendido, aparecerán aquí.
      </p>
    )
  }
  // Minuto en que empieza cada intervencion: la suma de las anteriores.
  const inicios = segmentos.reduce<bigint[]>((lista, s, i) => [...lista, i === 0 ? 0n : (lista[i - 1] ?? 0n) + (segmentos[i - 1]?.durationMs ?? 0n)], [])
  return (
    <ol className="mt-4 grid gap-3" aria-live="polite">
      {segmentos.map((s, i) => {
        const desde = inicios[i] ?? 0n
        const abierta = abiertas.get(s.id)
        const texto =
          abierta && abierta !== 'error'
            ? abierta.segments
                .map((x) => x.text.trim())
                .filter(Boolean)
                .join(' ')
            : ''
        return (
          <li key={s.id} className="rounded-xl border border-linea bg-superficie px-4 py-3">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tinta-suave">
              <span className="font-semibold text-tinta">{nombres.get(s.speakerParticipantId) ?? 'Participante'}</span>
              <span className="font-mono">{segundos(desde)}</span>
              {s.state !== ProcessingState.DONE ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-ia-suave px-2 py-0.5 font-medium text-ia">
                  {s.state === ProcessingState.FAILED ? (
                    <TriangleAlert aria-hidden className="size-3" />
                  ) : (
                    <LoaderCircle aria-hidden className="size-3 animate-spin" />
                  )}
                  {ESTADO[s.state]}
                </span>
              ) : null}
            </p>
            {s.state === ProcessingState.DONE ? (
              <p className="mt-1.5 leading-relaxed">
                {abierta === 'error'
                  ? 'No se pudo descifrar en este navegador.'
                  : abierta
                    ? texto || <span className="text-tinta-suave">(sin palabras reconocidas)</span>
                    : '…'}
              </p>
            ) : null}
          </li>
        )
      })}
      {pendientes > 0 ? (
        <li className="flex items-center gap-2 rounded-xl border border-dashed border-linea px-4 py-3 text-sm text-tinta-suave">
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          {pendientes === 1 ? 'Sellando y enviando 1 intervención…' : `Sellando y enviando ${pendientes} intervenciones…`}
        </li>
      ) : null}
    </ol>
  )
}
