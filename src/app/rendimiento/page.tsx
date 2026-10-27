import type { Metadata } from 'next'
import { Laboratorio } from '@/components/rendimiento/Laboratorio'
import { Encabezado } from '@/components/marca/Encabezado'
import { PiePagina } from '@/components/marca/PiePagina'

export const metadata: Metadata = { title: 'Rendimiento: Event Loop e INP' }
// SSG para la carcasa; todo lo que se mide y se ejecuta pasa en el navegador (CSR).
export const dynamic = 'force-static'

export default function Rendimiento() {
  return (
    <>
      <Encabezado />
      <main id="contenido" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <p className="folio entrada text-lacre">Laboratorio de rendimiento</p>
        <h1 className="entrada mt-3 text-4xl font-semibold sm:text-5xl" style={{ '--i': 1 }}>
          Event Loop, hilos e INP
        </h1>
        <p className="entrada mt-4 max-w-3xl text-tinta-suave" style={{ '--i': 2 }}>
          Lo que hace ActaFlow por debajo para que la audiencia, el cifrado y el acta nunca congelen la pantalla,
          demostrado en vivo en tu navegador.
        </p>
        <div className="entrada mt-8" style={{ '--i': 3 }}>
          <Laboratorio />
        </div>
      </main>
      <PiePagina />
    </>
  )
}
