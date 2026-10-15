import Link from 'next/link'
import { Encabezado } from '@/components/marca/Encabezado'
import { PiePagina } from '@/components/marca/PiePagina'

export default function NoEncontrado() {
  return (
    <>
      <Encabezado />
      <main id="contenido" className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <div className="hoja relative rounded-2xl border border-linea px-6 py-12 sm:pl-20">
          <p className="folio text-lacre">Folio no encontrado</p>
          <h1 className="titular mt-3 text-5xl">Esta página no está en el expediente.</h1>
          <p className="mt-4 leading-relaxed text-tinta-suave">
            La dirección que buscas no existe o no tienes acceso a ella.
          </p>
          <Link
            href="/"
            className="mt-8 inline-flex rounded-full bg-institucional px-6 py-3 font-medium text-sobre-institucional"
          >
            Volver al inicio
          </Link>
          <span
            aria-hidden="true"
            className="absolute right-8 top-8 flex size-20 rotate-12 items-center justify-center rounded-full border-[3px] border-double border-lacre text-lacre"
          >
            <span className="font-serif text-2xl font-semibold">404</span>
          </span>
        </div>
      </main>
      <PiePagina />
    </>
  )
}
