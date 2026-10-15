import type { Metadata } from 'next'
import { Suspense } from 'react'
import { EsqueletoEstado, PanelEstado } from '@/components/estado/PanelEstado'
import { Encabezado } from '@/components/marca/Encabezado'
import { PiePagina } from '@/components/marca/PiePagina'

export const metadata: Metadata = { title: 'Estado del sistema' }

// Renderizado dinamico con streaming: el encabezado sale de inmediato y el resultado llega
// cuando el backend responde (puede tardar si Render lo estaba despertando).
export const maxDuration = 300

export default function PaginaEstado() {
  return (
    <>
      <Encabezado />
      <main id="contenido" className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <h1 className="font-serif text-3xl font-semibold tracking-tight">Estado del sistema</h1>
        <p className="mt-3 max-w-3xl leading-relaxed text-tinta-suave">
          Esta página consulta cada capa de ActaFlow a través del BFF: el navegador solo habla con el servidor de Next,
          que llama por gRPC a cada microservicio con una firma HMAC distinta por servicio. El servicio de expedientes,
          a su vez, llama por gRPC al motor de IA.
        </p>
        <Suspense fallback={<EsqueletoEstado />}>
          <PanelEstado />
        </Suspense>
      </main>
      <PiePagina />
    </>
  )
}
