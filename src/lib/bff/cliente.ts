import 'server-only'
import { leerConfiguracion, type ConfiguracionBff } from './configuracion'
import { cabecerasFirmadas } from './firma'

export type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type RespuestaBackend = {
  estado: number
  datos: unknown
  intentos: number
}

export class BackendNoDisponibleError extends Error {
  constructor(
    readonly intentos: number,
    readonly esperadoMs: number,
  ) {
    super(`El backend no respondio tras ${intentos} intentos (${Math.round(esperadoMs / 1000)} s)`)
    this.name = 'BackendNoDisponibleError'
  }
}

export type OpcionesLlamada = {
  metodo?: Metodo
  cuerpo?: unknown
  /** Solo se reintenta automaticamente lo que es seguro repetir. */
  idempotente?: boolean
  esperaMaxMs?: number
}

export type Dependencias = {
  fetch?: typeof fetch
  dormir?: (ms: number) => Promise<void>
  ahora?: () => number
  configuracion?: ConfiguracionBff
}

/** Render responde estos codigos mientras el servicio se despierta o se reinicia. */
const ESTADOS_TRANSITORIOS = new Set([502, 503, 504])
const TIMEOUT_POR_INTENTO_MS = 30_000
const ESPERA_INICIAL_MS = 2_000
const ESPERA_TOPE_MS = 10_000

const dormirReal = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms))

export function esperaEntreIntentos(intento: number): number {
  return Math.min(ESPERA_INICIAL_MS * 1.5 ** (intento - 1), ESPERA_TOPE_MS)
}

/**
 * Llama al backend desde el BFF: firma cada intento con HMAC, oculta la URL real y espera
 * hasta `esperaMaxMs` a un backend dormido (Render Free tarda cerca de un minuto en despertar).
 */
export async function llamarBackend(
  ruta: string,
  opciones: OpcionesLlamada = {},
  dependencias: Dependencias = {},
): Promise<RespuestaBackend> {
  if (!ruta.startsWith('/api/')) {
    throw new Error('El BFF solo puede llamar rutas /api/ del backend')
  }
  const config = dependencias.configuracion ?? leerConfiguracion()
  const hacerFetch = dependencias.fetch ?? fetch
  const dormir = dependencias.dormir ?? dormirReal
  const ahora = dependencias.ahora ?? Date.now

  const metodo = opciones.metodo ?? 'GET'
  const reintentable = metodo === 'GET' || opciones.idempotente === true
  const esperaMax = opciones.esperaMaxMs ?? config.esperaMaxMs
  const cuerpo =
    opciones.cuerpo === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(opciones.cuerpo))

  const inicio = ahora()
  let intentos = 0

  while (true) {
    intentos += 1
    const restante = esperaMax - (ahora() - inicio)
    try {
      const respuesta = await hacerFetch(`${config.urlBackend}${ruta}`, {
        method: metodo,
        headers: {
          Accept: 'application/json',
          ...(cuerpo.length > 0 ? { 'Content-Type': 'application/json' } : {}),
          ...cabecerasFirmadas(config.secretoHmac, metodo, ruta, cuerpo, ahora()),
        },
        body: cuerpo.length > 0 ? cuerpo : undefined,
        cache: 'no-store',
        redirect: 'manual',
        signal: AbortSignal.timeout(Math.max(1_000, Math.min(TIMEOUT_POR_INTENTO_MS, restante))),
      })
      if (!(reintentable && ESTADOS_TRANSITORIOS.has(respuesta.status))) {
        return { estado: respuesta.status, datos: await leerJson(respuesta), intentos }
      }
    } catch (error) {
      if (!reintentable || !esErrorDeRed(error)) {
        throw error
      }
    }

    const pausa = esperaEntreIntentos(intentos)
    if (ahora() - inicio + pausa >= esperaMax) {
      throw new BackendNoDisponibleError(intentos, ahora() - inicio)
    }
    await dormir(pausa)
  }
}

async function leerJson(respuesta: Response): Promise<unknown> {
  const tipo = respuesta.headers.get('content-type') ?? ''
  if (!tipo.includes('application/json')) {
    return null
  }
  try {
    return await respuesta.json()
  } catch {
    return null
  }
}

function esErrorDeRed(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true // fetch lanza TypeError cuando no hay conexion
  }
  return error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')
}
