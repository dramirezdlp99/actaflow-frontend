import { AlertTriangle, CheckCircle2, HelpCircle, XCircle, type LucideIcon } from 'lucide-react'
import type { Capa, EstadoCapa } from '@/lib/estado/modelo'

// El estado nunca se comunica solo con color: siempre va con icono y texto.
const PRESENTACION: Record<EstadoCapa, { etiqueta: string; icono: LucideIcon; clases: string }> = {
  OK: { etiqueta: 'Operativo', icono: CheckCircle2, clases: 'text-exito' },
  DEGRADADO: { etiqueta: 'Degradado', icono: AlertTriangle, clases: 'text-alerta' },
  CAIDO: { etiqueta: 'Sin respuesta', icono: XCircle, clases: 'text-error' },
  DESCONOCIDO: { etiqueta: 'Desconocido', icono: HelpCircle, clases: 'text-tinta-suave' },
}

export function etiquetaEstado(estado: EstadoCapa): string {
  return PRESENTACION[estado].etiqueta
}

export function TarjetaCapa({ capa }: { capa: Capa }) {
  const { etiqueta, icono: Icono, clases } = PRESENTACION[capa.estado]
  return (
    <li
      className="entrada @container relative overflow-hidden rounded-2xl border border-linea bg-superficie p-5 shadow-suave"
      data-capa={capa.id}
      data-estado={capa.estado}
    >
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 bg-current ${clases}`} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-serif text-lg font-semibold">{capa.nombre}</h3>
          <p className="text-sm text-tinta-suave">{capa.plataforma}</p>
        </div>
        <p className={`inline-flex shrink-0 items-center gap-1.5 text-sm font-medium ${clases}`}>
          <Icono aria-hidden="true" className="size-4" />
          {etiqueta}
        </p>
      </div>
      {capa.detalle ? <p className="mt-3 text-sm leading-relaxed">{capa.detalle}</p> : null}
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-tinta-suave">
        {capa.latenciaMs !== null ? (
          <div className="flex gap-1">
            <dt>Latencia:</dt>
            <dd>{capa.latenciaMs.toLocaleString('es-CO')} ms</dd>
          </div>
        ) : null}
        {capa.transporte ? (
          <div className="flex gap-1">
            <dt>Transporte:</dt>
            <dd>{capa.transporte}</dd>
          </div>
        ) : null}
        {capa.version ? (
          <div className="flex gap-1">
            <dt>Versión:</dt>
            <dd className="font-mono">{capa.version}</dd>
          </div>
        ) : null}
      </dl>
    </li>
  )
}
