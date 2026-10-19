import type { Metadata } from 'next'
import { FormularioRegistro } from '@/components/cuenta/FormularioRegistro'
import { MarcoCuenta } from '@/components/cuenta/MarcoCuenta'

export const metadata: Metadata = { title: 'Crear cuenta' }
// Dinamica: lleva el nonce de la CSP de esta peticion.
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export default function Registro() {
  return (
    <MarcoCuenta
      folio="Alta por invitación"
      titulo="Crea tu cuenta"
      bajada="Tu contraseña y tus claves se crean en este navegador. Al final recibirás un kit de recuperación: guárdalo bien."
    >
      <FormularioRegistro />
    </MarcoCuenta>
  )
}
