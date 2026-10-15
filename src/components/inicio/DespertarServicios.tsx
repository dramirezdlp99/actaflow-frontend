'use client'

import { useEffect } from 'react'
import { despertarServicios } from '@/app/acciones/despertar'

/**
 * Los servicios gratuitos de Render se duermen tras 15 minutos sin trafico. Al abrir la
 * portada se invoca, en segundo plano y una sola vez, una Server Action que los despierta
 * mientras la persona lee. No muestra nada ni bloquea la pagina.
 */
export function DespertarServicios() {
  useEffect(() => {
    despertarServicios().catch(() => {
      // Silencioso a proposito: es solo un "despertador".
    })
  }, [])
  return null
}
