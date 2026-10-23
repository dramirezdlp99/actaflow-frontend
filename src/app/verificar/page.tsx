import type { Metadata } from 'next'
import { VerificarActa } from '@/components/actas/VerificarActa'
import { Encabezado } from '@/components/marca/Encabezado'
import { PiePagina } from '@/components/marca/PiePagina'

export const metadata: Metadata = { title: 'Verificar un acta' }
// SSG: la pagina es igual para todos; la comprobacion es una Server Action publica.
export const dynamic = 'force-static'
// La Server Action puede esperar a que legal-case despierte.
export const maxDuration = 300

export default function Verificar() {
  return (
    <>
      <Encabezado />
      <main id="contenido" className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="folio entrada text-lacre">Público · sin cuenta</p>
        <h1 className="entrada mt-3 text-4xl font-semibold sm:text-5xl" style={{ '--i': 1 }}>
          Verificar un acta
        </h1>
        <p className="entrada mt-4 text-tinta-suave" style={{ '--i': 2 }}>
          Elige el PDF que recibiste. Tu navegador calcula su huella SHA-256 y solo esa huella se consulta: el
          documento no sale de tu equipo. Si alguien cambió una sola letra, la huella ya no coincide.
        </p>
        <div className="entrada mt-8" style={{ '--i': 3 }}>
          <VerificarActa />
        </div>
      </main>
      <PiePagina />
    </>
  )
}
