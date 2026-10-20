import { resaltar } from '@/lib/plantillas/resaltar'

const CLASES = {
  texto: '',
  variable: 'rounded bg-institucional-suave px-0.5 font-semibold text-institucional',
  etiqueta: 'font-semibold text-lacre',
  comentario: 'italic text-tinta-suave',
} as const

/** Fuente de una plantilla con variables y etiquetas resaltadas (texto escapado por React). */
export function FuenteResaltada({ fuente, etiqueta }: { fuente: string; etiqueta: string }) {
  return (
    <pre
      aria-label={etiqueta}
      tabIndex={0}
      className="max-h-[36rem] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-linea bg-superficie p-5 font-mono text-[0.82rem] leading-relaxed text-tinta"
    >
      {resaltar(fuente).map((t, i) =>
        t.tipo === 'texto' ? (
          t.texto
        ) : (
          <span key={i} className={CLASES[t.tipo]}>
            {t.texto}
          </span>
        ),
      )}
    </pre>
  )
}
