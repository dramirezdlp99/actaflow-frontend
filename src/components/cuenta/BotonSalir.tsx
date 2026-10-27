'use client'

import { LogOut } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { cerrarSesion } from '@/app/acciones/identidad'
import { borrarDatosSinConexion } from '@/lib/actas/bandejaIndexada'
import { borrarClaves } from '@/lib/cripto/almacen'

/**
 * Cierra la sesion en el servidor y borra de este navegador las claves abiertas, las paginas que
 * guardo el Service Worker y los borradores sin conexion.
 */
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
        await borrarDatosSinConexion()
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
