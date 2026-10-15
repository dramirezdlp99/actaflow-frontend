import { Encabezado } from '@/components/marca/Encabezado'
import { PiePagina } from '@/components/marca/PiePagina'

export type Clausula = { titulo: string; parrafos: string[] }

/** Pagina legal estatica presentada como una hoja de expediente. */
export function DocumentoLegal({
  rotulo,
  titulo,
  vigencia,
  clausulas,
}: {
  rotulo: string
  titulo: string
  vigencia: string
  clausulas: Clausula[]
}) {
  return (
    <>
      <Encabezado />
      <main id="contenido" className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <article className="hoja rounded-2xl border border-linea px-6 py-10 sm:px-12 sm:pl-20">
          <p className="folio text-lacre">{rotulo}</p>
          <h1 className="titular mt-3 text-4xl sm:text-5xl">{titulo}</h1>
          <p className="mt-4 text-sm text-tinta-suave">{vigencia}</p>
          <ol className="mt-10 space-y-8">
            {clausulas.map(({ titulo: tituloClausula, parrafos }, i) => (
              <li key={tituloClausula}>
                <h2 className="font-serif text-xl font-semibold">
                  <span className="mr-2 text-lacre">{i + 1}.</span>
                  {tituloClausula}
                </h2>
                {parrafos.map((parrafo) => (
                  <p key={parrafo} className="mt-3 font-serif text-[1.05rem] leading-7">
                    {parrafo}
                  </p>
                ))}
              </li>
            ))}
          </ol>
        </article>
      </main>
      <PiePagina />
    </>
  )
}
