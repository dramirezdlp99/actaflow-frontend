/**
 * Modelo de la pagina /estado. Codigo puro (sin dependencias de servidor) para poder probarlo.
 */

export type EstadoCapa = 'OK' | 'DEGRADADO' | 'CAIDO' | 'DESCONOCIDO'

export type IdCapa = 'frontend' | 'backend' | 'baseDatos' | 'motorIa'

export type Capa = {
  id: IdCapa
  nombre: string
  plataforma: string
  estado: EstadoCapa
  detalle: string
  latenciaMs: number | null
  version: string | null
}

export type VistaEstado = {
  general: 'OK' | 'DEGRADADO'
  capas: Capa[]
  verificadoEn: string
}

/** Contrato de GET /api/v1/status del backend. */
export type ComponenteBackend = {
  estado: 'OK' | 'DEGRADADO' | 'CAIDO'
  latenciaMs: number
  detalle: string | null
  version: string | null
}

export type RespuestaEstadoBackend = {
  servicio: string
  version: string
  estado: 'OK' | 'DEGRADADO'
  verificadoEn: string
  componentes: { baseDatos: ComponenteBackend; motorIa: ComponenteBackend }
}

const ESTADOS_COMPONENTE = new Set(['OK', 'DEGRADADO', 'CAIDO'])

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

function esComponente(valor: unknown): valor is ComponenteBackend {
  return (
    esObjeto(valor) &&
    typeof valor.estado === 'string' &&
    ESTADOS_COMPONENTE.has(valor.estado) &&
    typeof valor.latenciaMs === 'number' &&
    (valor.detalle === null || typeof valor.detalle === 'string') &&
    (valor.version === null || valor.version === undefined || typeof valor.version === 'string')
  )
}

/** Valida en tiempo de ejecucion lo que responde el backend antes de confiar en ello. */
export function esRespuestaEstado(valor: unknown): valor is RespuestaEstadoBackend {
  return (
    esObjeto(valor) &&
    valor.servicio === 'actaflow-backend' &&
    typeof valor.version === 'string' &&
    (valor.estado === 'OK' || valor.estado === 'DEGRADADO') &&
    typeof valor.verificadoEn === 'string' &&
    esObjeto(valor.componentes) &&
    esComponente(valor.componentes.baseDatos) &&
    esComponente(valor.componentes.motorIa)
  )
}

export const NOMBRES: Record<IdCapa, { nombre: string; plataforma: string }> = {
  frontend: { nombre: 'Frontend y BFF', plataforma: 'Next.js en Vercel' },
  backend: { nombre: 'Backend', plataforma: 'Spring Boot en Render' },
  baseDatos: { nombre: 'Base de datos', plataforma: 'PostgreSQL en Neon' },
  motorIa: { nombre: 'Motor de IA', plataforma: 'FastAPI en Render' },
}

function capa(id: IdCapa, datos: Omit<Capa, 'id' | 'nombre' | 'plataforma'>): Capa {
  return { id, ...NOMBRES[id], ...datos }
}

function capaFrontend(versionFrontend: string | null): Capa {
  return capa('frontend', { estado: 'OK', detalle: 'El BFF está en línea', latenciaMs: null, version: versionFrontend })
}

export function vistaDesdeBackend(
  respuesta: RespuestaEstadoBackend,
  latenciaBackendMs: number,
  versionFrontend: string | null,
): VistaEstado {
  const { baseDatos, motorIa } = respuesta.componentes
  const capas: Capa[] = [
    capaFrontend(versionFrontend),
    capa('backend', {
      estado: 'OK',
      detalle: 'Responde y acepta la firma del BFF',
      latenciaMs: latenciaBackendMs,
      version: respuesta.version,
    }),
    capa('baseDatos', {
      estado: baseDatos.estado,
      detalle: baseDatos.detalle ?? '',
      latenciaMs: baseDatos.latenciaMs,
      version: baseDatos.version ?? null,
    }),
    capa('motorIa', {
      estado: motorIa.estado,
      detalle: motorIa.detalle ?? '',
      latenciaMs: motorIa.latenciaMs,
      version: motorIa.version ?? null,
    }),
  ]
  return {
    general: capas.every((c) => c.estado === 'OK') ? 'OK' : 'DEGRADADO',
    capas,
    verificadoEn: respuesta.verificadoEn,
  }
}

/** Cuando el backend no responde, no se puede saber el estado de las capas que estan detras. */
export function vistaSinBackend(motivo: string, versionFrontend: string | null, ahora: Date): VistaEstado {
  const sinDatos = 'Sin datos: depende del backend'
  return {
    general: 'DEGRADADO',
    verificadoEn: ahora.toISOString(),
    capas: [
      capaFrontend(versionFrontend),
      capa('backend', { estado: 'CAIDO', detalle: motivo, latenciaMs: null, version: null }),
      capa('baseDatos', { estado: 'DESCONOCIDO', detalle: sinDatos, latenciaMs: null, version: null }),
      capa('motorIa', { estado: 'DESCONOCIDO', detalle: sinDatos, latenciaMs: null, version: null }),
    ],
  }
}
