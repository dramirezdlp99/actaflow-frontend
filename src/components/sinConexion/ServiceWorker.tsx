'use client'

import { CloudOff } from 'lucide-react'
import { useEffect, useSyncExternalStore } from 'react'

function suscribir(avisar: () => void) {
  window.addEventListener('online', avisar)
  window.addEventListener('offline', avisar)
  return () => {
    window.removeEventListener('online', avisar)
    window.removeEventListener('offline', avisar)
  }
}

/**
 * Registra el Service Worker (public/sw.js) y avisa cuando no hay red. Solo en produccion: en
 * desarrollo la cache confundiria la recarga en caliente.
 */
export function ServiceWorker() {
  const enLinea = useSyncExternalStore(
    suscribir,
    () => navigator.onLine,
    () => true,
  )

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error: unknown) => {
      console.warn('No se pudo registrar el Service Worker', error)
    })
  }, [])

  if (enLinea) return null
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit max-w-[calc(100%-2rem)] items-center gap-2 rounded-full border border-alerta/40 bg-superficie px-4 py-2 text-sm shadow-suave"
    >
      <CloudOff aria-hidden className="size-4 text-alerta" />
      Sin conexión: ves lo guardado en este navegador y lo que cambies se enviará al volver la red.
    </div>
  )
}

/** Pide al navegador que avise cuando vuelva la red (Background Sync, donde exista). */
export function pedirSincronizacion(): void {
  if (!('serviceWorker' in navigator)) return
  void navigator.serviceWorker.ready
    .then((registro) => {
      const sync: unknown = Reflect.get(registro, 'sync')
      const registrar: unknown = typeof sync === 'object' && sync !== null ? Reflect.get(sync, 'register') : null
      if (typeof registrar === 'function') return registrar.call(sync, 'actaflow-borrador')
    })
    .catch(() => undefined)
}
