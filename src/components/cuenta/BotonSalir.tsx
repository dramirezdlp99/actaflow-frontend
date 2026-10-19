'use client'

import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { cerrarSesion } from '@/app/acciones/identidad'
import { borrarClaves } from '@/lib/cripto/almacen'

/** Cierra la sesion en el servidor y borra las claves abiertas de este navegador. */
export function BotonSalir() {
  const router = useRouter()
  const [saliendo, setSaliendo] = useState(false)
  return (
    <button
      type="button"
      disabled={saliendo}
      onClick={async () => {
        setSaliendo(true)
        await borrarClaves()
        try {
          await cerrarSesion()
        } finally {
          router.replace('/ingresar')
          router.refresh()
        }
      }}
      className="inline-flex items-center gap-2 rounded-lg border border-linea bg-superficie px-4 py-2 text-sm font-medium transition hover:border-lacre hover:text-lacre disabled:opacity-60"
    >
      <LogOut aria-hidden className="size-4" />
      {saliendo ? 'Saliendo…' : 'Cerrar sesión'}
    </button>
  )
}
