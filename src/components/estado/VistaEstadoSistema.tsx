import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { VistaEstado } from '@/lib/estado/modelo'
import { ReintentarEstado } from './ReintentarEstado'
import { TarjetaCapa } from './TarjetaCapa'

const FORMATO_FECHA = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'long',
  timeStyle: 'medium',
  timeZone: 'America/Bogota',
})

export function formatearVerificadoEn(iso: string): string {
  const fecha = new Date(iso)
  return Number.isNaN(fecha.getTime()) ? iso : FORMATO_FECHA.format(fecha)
}

export function VistaEstadoSistema({ vista }: { vista: VistaEstado }) {
  const operativo = vista.general === 'OK'
  return (
    <section aria-labelledby="titulo-resultado" className="mt-8">
      <div
        className={`flex items-start gap-3 rounded-2xl border p-5 shadow-suave ${
          operativo ? 'border-exito/40 bg-superficie' : 'border-alerta/40 bg-superficie'
        }`}
      >
        {operativo ? (
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-exito" />
        ) : (
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-alerta" />
        )}
        <div>
          <h2 id="titulo-resultado" className="text-lg font-semibold">
            {operativo ? 'Todas las capas están operativas' : 'Hay capas que no están operativas'}
          </h2>
          <p className="mt-1 text-sm text-tinta-suave">
            Verificado el <time dateTime={vista.verificadoEn}>{formatearVerificadoEn(vista.verificadoEn)}</time> (hora de
            Colombia).
          </p>
        </div>
      </div>

      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {vista.capas.map((capa) => (
          <TarjetaCapa key={capa.id} capa={capa} />
        ))}
      </ul>

      <div className="mt-6">
        <ReintentarEstado todoOperativo={operativo} />
      </div>
    </section>
  )
}
