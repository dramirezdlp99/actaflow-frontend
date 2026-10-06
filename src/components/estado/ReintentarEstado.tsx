'use client'

import { RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useTransition } from 'react'

const REINTENTO_AUTOMATICO_MS = 20_000

/**
 * Boton para volver a consultar el estado. Si algo no esta operativo (por ejemplo, un servicio
 * de Render que se esta despertando), vuelve a consultar solo cada 20 segundos.
 */
export function ReintentarEstado({ todoOperativo }: { todoOperativo: boolean }) {
  const router = useRouter()
  const [consultando, iniciar] = useTransition()

  useEffect(() => {
    if (todoOperativo) {
      return
    }
    const temporizador = setTimeout(() => iniciar(() => router.refresh()), REINTENTO_AUTOMATICO_MS)
    return () => clearTimeout(temporizador)
  }, [todoOperativo, router])

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => iniciar(() => router.refresh())}
        disabled={consultando}
        className="inline-flex items-center gap-2 rounded-md border border-linea bg-superficie px-4 py-2 text-sm font-medium text-institucional hover:bg-institucional-suave disabled:opacity-60"
      >
        <RefreshCw aria-hidden="true" className={`size-4 ${consultando ? 'animate-spin' : ''}`} />
        {consultando ? 'Consultando…' : 'Volver a consultar'}
      </button>
      {!todoOperativo ? (
        <p className="text-sm text-tinta-suave" role="status">
          Se volverá a consultar automáticamente en 20 segundos.
        </p>
      ) : null}
    </div>
  )
}
