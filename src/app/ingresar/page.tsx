import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { FormularioIngreso } from '@/components/cuenta/FormularioIngreso'
import { MarcoCuenta } from '@/components/cuenta/MarcoCuenta'
import { destinoSeguro, sesionActual } from '@/lib/sesion/sesion'

export const metadata: Metadata = { title: 'Ingresar' }
// Dinamica: lleva el nonce de la CSP de esta peticion y revisa si ya hay sesion.
export const dynamic = 'force-dynamic'
// La primera llamada puede esperar a que Render despierte identity-service.
export const maxDuration = 300

export default async function Ingresar({ searchParams }: { searchParams: Promise<{ siguiente?: string }> }) {
  const destino = destinoSeguro((await searchParams).siguiente)
  if (await sesionActual().catch(() => null)) {
    redirect(destino)
  }
  return (
    <MarcoCuenta
      folio="Ingreso"
      titulo="Bienvenido de vuelta"
      bajada="Ingresa con tu correo, tu contraseña y el código de tu app autenticadora."
    >
      <FormularioIngreso destino={destino} />
    </MarcoCuenta>
  )
}
