import Link from 'next/link'
import { Encabezado } from '@/components/marca/Encabezado'

export default function NoEncontrado() {
  return (
    <>
      <Encabezado />
      <main id="contenido" className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
        <h1 className="font-serif text-3xl font-semibold">Página no encontrada</h1>
        <p className="mt-3 text-tinta-suave">La dirección que buscas no existe o no tienes acceso a ella.</p>
        <Link href="/" className="mt-6 inline-block font-medium text-institucional underline underline-offset-4">
          Volver al inicio
        </Link>
      </main>
    </>
  )
}
