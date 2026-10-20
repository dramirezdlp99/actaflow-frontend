'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { cambiarEstadoExpediente } from '@/app/acciones/expedientes'
import { AvisoError } from '@/components/cuenta/Campo'
import { CaseStatus } from '@/gen/actaflow/cases/v1/case_pb'
import { TRANSICIONES } from '@/lib/expedientes/etiquetas'

const NOMBRE: Record<CaseStatus, 'OPEN' | 'IN_HEARING' | 'AGREEMENT' | 'NO_AGREEMENT' | 'ARCHIVED' | null> = {
  [CaseStatus.UNSPECIFIED]: null,
  [CaseStatus.OPEN]: 'OPEN',
  [CaseStatus.IN_HEARING]: 'IN_HEARING',
  [CaseStatus.AGREEMENT]: 'AGREEMENT',
  [CaseStatus.NO_AGREEMENT]: 'NO_AGREEMENT',
  [CaseStatus.ARCHIVED]: 'ARCHIVED',
}

/** Solo para conciliadores: los pasos validos desde el estado actual (los mismos que valida el servicio). */
export function AccionesEstado({ casoId, estado }: { casoId: string; estado: CaseStatus }) {
  const router = useRouter()
  const [ocupado, setOcupado] = useState<CaseStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pasos = TRANSICIONES[estado]
  if (pasos.length === 0) {
    return null
  }

  async function cambiar(destino: CaseStatus) {
    const nombre = NOMBRE[destino]
    if (!nombre) {
      return
    }
    if (
      destino === CaseStatus.ARCHIVED &&
      !window.confirm('Archivar deja el expediente en solo lectura. ¿Continuar?')
    ) {
      return
    }
    setOcupado(destino)
    setError(null)
    const respuesta = await cambiarEstadoExpediente({ casoId, estado: nombre, idempotencia: crypto.randomUUID() })
    setOcupado(null)
    if (!respuesta.ok) {
      setError(respuesta.mensaje)
      return
    }
    router.refresh()
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        {pasos.map(({ a, texto }, i) => (
          <button
            key={a}
            type="button"
            disabled={ocupado !== null}
            onClick={() => cambiar(a)}
            className={
              i === 0
                ? 'rounded-lg bg-institucional px-4 py-2 text-sm font-semibold text-sobre-institucional shadow-suave transition hover:brightness-110 disabled:opacity-60'
                : 'rounded-lg border border-linea bg-superficie px-4 py-2 text-sm font-medium transition hover:border-institucional disabled:opacity-60'
            }
          >
            {ocupado === a ? 'Guardando…' : texto}
          </button>
        ))}
      </div>
      <AvisoError mensaje={error} />
    </div>
  )
}
