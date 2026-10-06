import type { ConfiguracionBff } from '@/lib/bff/configuracion'
import type { RespuestaEstadoBackend } from '@/lib/estado/modelo'

/** Secreto falso y publico con el que se calcularon los vectores compartidos por los tres repos. */
export const SECRETO_PRUEBA = 'secreto-de-prueba-publico-solo-para-tests-0123456789'

export const CONFIG_PRUEBA: ConfiguracionBff = {
  urlBackend: 'https://backend.prueba',
  secretoHmac: SECRETO_PRUEBA,
  esperaMaxMs: 120_000,
}

export function respuestaEstadoOk(): RespuestaEstadoBackend {
  return {
    servicio: 'actaflow-backend',
    version: '0.1.0',
    estado: 'OK',
    verificadoEn: '2026-10-06T15:00:00Z',
    componentes: {
      baseDatos: { estado: 'OK', latenciaMs: 12, detalle: 'PostgreSQL responde; esquema v1', version: '1' },
      motorIa: { estado: 'OK', latenciaMs: 40, detalle: 'Modelo de voz tiny listo', version: '0.1.0' },
    },
  }
}

export function respuestaJson(cuerpo: unknown, estado = 200): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } })
}

/** Reloj falso: cada `dormir` avanza el tiempo sin esperar de verdad. */
export function relojFalso(inicio = 1_760_000_000_000) {
  let ahora = inicio
  return {
    ahora: () => ahora,
    dormir: async (ms: number) => {
      ahora += ms
    },
    avanzar: (ms: number) => {
      ahora += ms
    },
  }
}
