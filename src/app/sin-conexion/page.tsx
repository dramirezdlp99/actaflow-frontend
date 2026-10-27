import type { Metadata } from 'next'
import { CloudOff } from 'lucide-react'
import Link from 'next/link'
import { Encabezado } from '@/components/marca/Encabezado'
import { PiePagina } from '@/components/marca/PiePagina'

export const metadata: Metadata = { title: 'Sin conexión' }
// SSG: el Service Worker la guarda al instalarse y la muestra cuando no hay red ni copia de la pagina.
export const dynamic = 'force-static'

export default function SinConexion() {
  return (
    <>
      <Encabezado />
      <main id="contenido" className="mx-auto max-w-2xl px-4 py-20 text-center sm:px-6">
        <CloudOff aria-hidden className="mx-auto size-12 text-alerta" strokeWidth={1.5} />
        <h1 className="titular mt-6 text-4xl">Sin conexión</h1>
        <p className="mt-4 text-tinta-suave">
          Esta página aún no estaba guardada en este navegador. Las que ya abriste con conexión (expedientes,
          plantillas, el acta) siguen disponibles, y lo que cambies en el borrador del acta se envía solo al volver la
          red.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/expedientes" className="rounded-full bg-institucional px-5 py-2.5 font-medium text-sobre-institucional">
            Mis expedientes
          </Link>
          <Link href="/plantillas" className="rounded-full border border-linea bg-superficie px-5 py-2.5 font-medium">
            Plantillas
          </Link>
        </div>
      </main>
      <PiePagina />
    </>
  )
}
