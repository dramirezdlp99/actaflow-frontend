'use client'

import { useEffect } from 'react'

/**
 * Los servicios gratuitos de Render se duermen tras 15 minutos sin trafico. Al abrir la
 * portada se lanza, en segundo plano y una sola vez, una consulta de estado que los despierta
 * mientras la persona lee. No muestra nada ni bloquea la pagina.
 */
export function DespertarServicios() {
  useEffect(() => {
    const controlador = new AbortController()
    fetch('/api/estado', { cache: 'no-store', signal: controlador.signal }).catch(() => {
      // Silencioso a proposito: es solo un "despertador".
    })
    return () => controlador.abort()
  }, [])
  return null
}
