import { Mic, Sparkles } from 'lucide-react'

type Renglon = { id: string; contenido: React.ReactNode }

// Ejemplo ficticio: nombres, montos y fechas inventados para ilustrar, no son datos reales.
const RENGLONES: Renglon[] = [
  { id: 'apertura', contenido: <>En Bogotá D.C., ante el conciliador, comparecen:</> },
  {
    id: 'convocante',
    contenido: (
      <>
        Convocante: <span className="marca-ia">Laura Méndez (ejemplo)</span>
      </>
    ),
  },
  {
    id: 'convocado',
    contenido: (
      <>
        Convocado: <span className="marca-ia">Taller Andino S.A.S.</span>
      </>
    ),
  },
  {
    id: 'monto',
    contenido: (
      <>
        Acuerdan el pago de <span className="marca-ia">$ 4.500.000</span> en{' '}
        <span className="marca-ia">tres cuotas</span>,
      </>
    ),
  },
  {
    id: 'fecha',
    contenido: (
      <>
        la última a más tardar el <span className="marca-ia">30 de noviembre</span>,
      </>
    ),
  },
  {
    id: 'penal',
    contenido: (
      <>
        con <span className="marca-ia">cláusula penal</span> por incumplimiento.
      </>
    ),
  },
]

const ALTURAS_AUDIO = [0.45, 0.8, 0.6, 1, 0.7, 0.9, 0.5, 0.75, 0.55, 0.85, 0.4, 0.65]

/**
 * Ilustracion de la portada: una minuta que se escribe sola mientras la audiencia ocurre. La IA
 * marca en violeta lo que extrae y, al final, el abogado la sella. Solo CSS: no usa JavaScript.
 */
export function MinutaViva() {
  return (
    <figure className="relative mx-auto w-full max-w-[34rem]" aria-labelledby="descripcion-minuta">
      <figcaption id="descripcion-minuta" className="sr-only">
        Ejemplo ficticio de una minuta que se redacta durante la audiencia: la inteligencia artificial resalta en
        violeta las partes, el monto, las cuotas, la fecha límite y la cláusula penal, y el abogado la sella al
        revisarla.
      </figcaption>

      <div aria-hidden="true" className="hoja relative rounded-xl border border-linea px-6 pb-28 pt-6 sm:pl-16 sm:pr-8">
        <div className="flex items-center justify-between gap-4 border-b border-linea pb-4">
          <div>
            <p className="folio text-lacre">Acta de conciliación</p>
            <p className="mt-1 font-serif text-sm text-tinta-suave">Expediente de ejemplo · folio 1</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-linea bg-papel px-3 py-1.5">
            <span className="en-vivo size-2 rounded-full bg-lacre" />
            <Mic className="size-3.5 text-tinta-suave" strokeWidth={2} />
            <span className="flex h-4 items-end gap-[2px]">
              {ALTURAS_AUDIO.map((altura, i) => (
                <span
                  key={i}
                  className="barra-audio w-[3px] rounded-full bg-institucional/70"
                  style={{ height: `${altura * 100}%`, '--i': i }}
                />
              ))}
            </span>
          </div>
        </div>

        <ol className="mt-5 space-y-[0.55rem] font-serif text-[1.02rem] leading-7 sm:text-[1.08rem]">
          {RENGLONES.map(({ id, contenido }, i) => (
            <li key={id} className="renglon" style={{ '--i': i }}>
              {contenido}
            </li>
          ))}
        </ol>

        <div
          className="entrada absolute -bottom-4 left-6 inline-flex items-center gap-1.5 rounded-full border border-ia/30 bg-ia-suave px-3 py-1.5 text-xs font-medium text-ia shadow-suave sm:left-16"
          style={{ '--i': 30 }}
        >
          <Sparkles className="size-3.5" />
          Entidades extraídas por la IA
        </div>

        <div className="sello absolute bottom-6 right-6 flex size-[5.5rem] items-center justify-center rounded-full border-[3px] border-double border-lacre text-center text-lacre">
          <span className="folio leading-tight tracking-[0.12em]">
            Revisada
            <br />y firmada
          </span>
        </div>
      </div>
    </figure>
  )
}
