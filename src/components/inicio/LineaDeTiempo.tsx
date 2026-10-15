import { AudioLines, FileCheck2, FileText, Mic, Sparkles, type LucideIcon } from 'lucide-react'

type Paso = { icono: LucideIcon; titulo: string; texto: string; ia?: boolean }

const PASOS: Paso[] = [
  {
    icono: Mic,
    titulo: 'La audiencia se graba en el navegador',
    texto:
      'El audio se captura y se prepara en segundo plano (AudioWorklet y Web Workers), cifrado en el equipo antes de salir.',
  },
  {
    icono: AudioLines,
    titulo: 'Se transcribe mientras se habla',
    texto: 'El motor de IA recibe el audio por streaming gRPC y devuelve el texto, distinguiendo a cada hablante.',
    ia: true,
  },
  {
    icono: Sparkles,
    titulo: 'La IA extrae lo que importa',
    texto: 'Partes e identificaciones, montos, fechas límite, compromisos de entrega y cláusulas penales.',
    ia: true,
  },
  {
    icono: FileText,
    titulo: 'La plantilla se autocompleta',
    texto: 'Lo extraído llena la plantilla legal elegida y la minuta se maqueta sola, lista para leer en la sala.',
  },
  {
    icono: FileCheck2,
    titulo: 'El abogado revisa y sella',
    texto: 'Nada se firma sin una persona: todo lo propuesto por la IA queda marcado en violeta hasta confirmarlo.',
  },
]

/** Recorrido de la audiencia; la linea se traza con el scroll (CSS animation-timeline, sin JavaScript). */
export function LineaDeTiempo() {
  return (
    <ol className="relative mt-10 space-y-10 pl-14 sm:pl-16">
      <span aria-hidden="true" className="absolute bottom-6 left-[1.2rem] top-6 w-px bg-linea sm:left-[1.45rem]" />
      <span
        aria-hidden="true"
        className="linea-tiempo-progreso absolute bottom-6 left-[1.2rem] top-6 w-px bg-gradient-to-b from-institucional via-ia to-lacre sm:left-[1.45rem]"
      />
      {PASOS.map(({ icono: Icono, titulo, texto, ia }, i) => (
        <li key={titulo} className="revelar relative">
          <span
            aria-hidden="true"
            className={`absolute -left-14 top-0 flex size-10 items-center justify-center rounded-full border bg-superficie shadow-suave sm:-left-16 sm:size-12 ${
              ia ? 'border-ia/40 text-ia' : 'border-linea text-institucional'
            }`}
          >
            <Icono className="size-5" strokeWidth={1.75} />
          </span>
          <p className="folio text-tinta-suave">
            Paso {i + 1}
            {ia ? <span className="ml-2 text-ia">· IA</span> : null}
          </p>
          <h3 className="mt-1.5 font-serif text-xl font-semibold sm:text-2xl">{titulo}</h3>
          <p className="mt-2 max-w-xl leading-relaxed text-tinta-suave">{texto}</p>
        </li>
      ))}
    </ol>
  )
}
