/**
 * Modelo de la pagina /estado. Codigo puro (sin dependencias de servidor) para poder probarlo.
 *
 * Tipado de punta a punta: la entrada es `ServiceStatus`, el tipo GENERADO desde
 * actaflow-contracts. Si el contrato cambia, este archivo deja de compilar en vez de fallar en
 * produccion.
 */
import {
  HealthState,
  Transport,
  type ComponentStatus,
  type ServiceStatus,
} from '@/gen/actaflow/system/v1/service_status_pb'

export type EstadoCapa = 'OK' | 'DEGRADADO' | 'CAIDO' | 'DESCONOCIDO'

export type IdCapa = 'frontend' | 'identidad' | 'expedientes' | 'baseDatos' | 'motorIa'

export type Capa = {
  id: IdCapa
  nombre: string
  plataforma: string
  estado: EstadoCapa
  detalle: string
  latenciaMs: number | null
  version: string | null
  /** Transporte por el que el servicio dice haber recibido la llamada (served_via). */
  transporte: string | null
}

export type VistaEstado = {
  general: 'OK' | 'DEGRADADO'
  capas: Capa[]
  verificadoEn: string
}

/** Resultado de llamar a GetServiceStatus de un microservicio. */
export type ResultadoServicio =
  | { tipo: 'respondio'; estado: ServiceStatus; latenciaMs: number }
  | { tipo: 'fallo'; motivo: string }

export const NOMBRES: Record<IdCapa, { nombre: string; plataforma: string }> = {
  frontend: { nombre: 'Frontend y BFF', plataforma: 'Next.js en Vercel' },
  identidad: { nombre: 'Servicio de identidad', plataforma: 'Spring Boot + gRPC en Render' },
  expedientes: { nombre: 'Servicio de expedientes', plataforma: 'Spring Boot + gRPC en Render' },
  baseDatos: { nombre: 'Base de datos', plataforma: 'PostgreSQL en Neon (un esquema por servicio)' },
  motorIa: { nombre: 'Motor de IA', plataforma: 'Python + gRPC en Render' },
}

const ESTADOS: Record<HealthState, EstadoCapa> = {
  [HealthState.UNSPECIFIED]: 'DESCONOCIDO',
  [HealthState.OK]: 'OK',
  [HealthState.DEGRADED]: 'DEGRADADO',
  [HealthState.DOWN]: 'CAIDO',
}

const TRANSPORTES: Record<Transport, string | null> = {
  [Transport.UNSPECIFIED]: null,
  [Transport.GRPC]: 'gRPC (HTTP/2)',
  [Transport.GRPC_WEB]: 'gRPC-Web (HTTP/1.1)',
}

const GRAVEDAD: Record<EstadoCapa, number> = { OK: 0, DESCONOCIDO: 1, DEGRADADO: 2, CAIDO: 3 }

export function estadoCapa(estado: HealthState): EstadoCapa {
  return ESTADOS[estado]
}

export function nombreTransporte(transporte: Transport): string | null {
  return TRANSPORTES[transporte]
}

function capa(id: IdCapa, datos: Omit<Capa, 'id' | 'nombre' | 'plataforma'>): Capa {
  return { id, ...NOMBRES[id], ...datos }
}

function capaFrontend(versionFrontend: string | null): Capa {
  return capa('frontend', {
    estado: 'OK',
    detalle: 'El BFF está en línea',
    latenciaMs: null,
    version: versionFrontend,
    transporte: null,
  })
}

const SIN_DATOS = 'Sin datos: el servicio que lo verifica no respondió'

function capaServicio(id: 'identidad' | 'expedientes', resultado: ResultadoServicio): Capa {
  if (resultado.tipo === 'fallo') {
    return capa(id, { estado: 'CAIDO', detalle: resultado.motivo, latenciaMs: null, version: null, transporte: null })
  }
  return capa(id, {
    // Si responde y acepta la firma, el servicio esta operativo; sus dependencias van aparte.
    estado: 'OK',
    detalle: 'Responde y acepta la firma del BFF',
    latenciaMs: resultado.latenciaMs,
    version: resultado.estado.version || null,
    transporte: nombreTransporte(resultado.estado.servedVia),
  })
}

function componente(resultado: ResultadoServicio, id: string): ComponentStatus | undefined {
  return resultado.tipo === 'respondio' ? resultado.estado.components.find((c) => c.id === id) : undefined
}

function capaBaseDatos(identidad: ResultadoServicio, expedientes: ResultadoServicio): Capa {
  const partes = [componente(identidad, 'database'), componente(expedientes, 'database')].filter(
    (c): c is ComponentStatus => c !== undefined,
  )
  if (partes.length === 0) {
    return capa('baseDatos', { estado: 'DESCONOCIDO', detalle: SIN_DATOS, latenciaMs: null, version: null, transporte: null })
  }
  const peor = partes.map((c) => estadoCapa(c.state)).reduce((a, b) => (GRAVEDAD[b] > GRAVEDAD[a] ? b : a))
  return capa('baseDatos', {
    // Si solo respondio un servicio, la otra mitad de la base queda sin verificar.
    estado: partes.length === 2 ? peor : GRAVEDAD[peor] > GRAVEDAD.DESCONOCIDO ? peor : 'DESCONOCIDO',
    detalle: partes.map((c) => c.detail).join(' · '),
    latenciaMs: Math.max(...partes.map((c) => Number(c.latencyMs))),
    version: null,
    transporte: null,
  })
}

function capaMotor(expedientes: ResultadoServicio): Capa {
  const motor = componente(expedientes, 'ai-engine')
  if (!motor) {
    return capa('motorIa', { estado: 'DESCONOCIDO', detalle: SIN_DATOS, latenciaMs: null, version: null, transporte: null })
  }
  const anidado = motor.nested
  // Lo que el motor dice de si mismo (modelos instalados) es mas util que "responde".
  const modelos = anidado?.components.filter((c) => c.state !== HealthState.OK).map((c) => c.detail) ?? []
  return capa('motorIa', {
    estado: estadoCapa(anidado ? anidado.state : motor.state),
    detalle: modelos.length > 0 ? modelos.join(' · ') : motor.detail,
    latenciaMs: Number(motor.latencyMs),
    version: motor.version || null,
    transporte: anidado ? nombreTransporte(anidado.servedVia) : null,
  })
}

export function construirVista(
  identidad: ResultadoServicio,
  expedientes: ResultadoServicio,
  versionFrontend: string | null,
  ahora: Date,
): VistaEstado {
  const capas: Capa[] = [
    capaFrontend(versionFrontend),
    capaServicio('identidad', identidad),
    capaServicio('expedientes', expedientes),
    capaBaseDatos(identidad, expedientes),
    capaMotor(expedientes),
  ]
  return {
    general: capas.every((c) => c.estado === 'OK') ? 'OK' : 'DEGRADADO',
    capas,
    verificadoEn: ahora.toISOString(),
  }
}
