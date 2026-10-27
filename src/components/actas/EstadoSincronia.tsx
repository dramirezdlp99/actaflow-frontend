import { CloudCheck, CloudOff, RefreshCw, TriangleAlert } from 'lucide-react'
import type { EstadoBorrador } from '@/lib/actas/borrador'

/** Si el borrador esta guardado en el servidor, esperando la red o con un aviso. */
export function EstadoSincronia({ estado }: { estado: Pick<EstadoBorrador, 'conexion' | 'pendientes' | 'aviso'> }) {
  const { conexion, pendientes, aviso } = estado
  return (
    <div className="mt-3 grid gap-1 text-xs" aria-live="polite" data-sincronia={conexion}>
      {conexion === 'sin-conexion' ? (
        <p className="flex items-center gap-1.5 font-medium text-alerta">
          <CloudOff aria-hidden className="size-3.5" />
          Sin conexión: sigues trabajando con lo guardado en este navegador.
          {pendientes > 0 ? ` ${pendientes === 1 ? 'Un cambio se enviará' : `${pendientes} cambios se enviarán`} al volver la red.` : ''}
        </p>
      ) : pendientes > 0 ? (
        <p className="flex items-center gap-1.5 text-tinta-suave">
          <RefreshCw aria-hidden className="size-3.5 animate-spin" /> Guardando {pendientes === 1 ? 'un cambio' : `${pendientes} cambios`}…
        </p>
      ) : (
        <p className="flex items-center gap-1.5 text-exito">
          <CloudCheck aria-hidden className="size-3.5" /> Borrador guardado y al día con los demás.
        </p>
      )}
      {aviso ? (
        <p className="flex items-center gap-1.5 text-error">
          <TriangleAlert aria-hidden className="size-3.5" /> {aviso}
        </p>
      ) : null}
    </div>
  )
}
