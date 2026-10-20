'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

const INTENTOS = 12
const CADA_MS = 10_000

/**
 * Se muestra solo dentro del aviso de "biblioteca no disponible": pide regenerar la pagina ISR y la
 * vuelve a cargar cada 10 s, asi la biblioteca aparece sola cuando legal-case termina de despertar.
 */
export function RecuperarBiblioteca() {
  const router = useRouter()
  const [intento, setIntento] = useState(0)

  useEffect(() => {
    // fetch y no una Server Action: React no las permite mientras hidrata la pagina (error #441).
    fetch('/api/plantillas/regenerar', { method: 'POST' }).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (intento >= INTENTOS) {
      return
    }
    const espera = setTimeout(() => {
      router.refresh()
      setIntento((n) => n + 1)
    }, CADA_MS)
    return () => clearTimeout(espera)
  }, [intento, router])

  return (
    <p role="status" className="mt-4 text-sm text-tinta-suave">
      {intento < INTENTOS ? 'Reintentando automáticamente…' : 'Recarga la página en unos minutos.'}
    </p>
  )
}
