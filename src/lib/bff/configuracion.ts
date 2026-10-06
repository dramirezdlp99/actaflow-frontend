import 'server-only'

/** Configuracion del BFF. Solo existe en el servidor: el navegador nunca ve estos valores. */
export type ConfiguracionBff = {
  urlBackend: string
  secretoHmac: string
  esperaMaxMs: number
}

export class ConfiguracionInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ConfiguracionInvalidaError'
  }
}

const LONGITUD_MINIMA_SECRETO = 32
const ESPERA_POR_DEFECTO_MS = 120_000
// Vercel Hobby corta las funciones a los 300 s: la espera debe quedar por debajo.
const ESPERA_MAXIMA_PERMITIDA_MS = 280_000

type Entorno = Record<string, string | undefined>

/**
 * Lee y valida la configuracion en el momento de la peticion (no al importar el modulo),
 * para que el build de produccion no necesite los secretos.
 */
export function leerConfiguracion(entorno: Entorno = process.env): ConfiguracionBff {
  const url = entorno.ACTAFLOW_BACKEND_URL?.trim()
  if (!url) {
    throw new ConfiguracionInvalidaError('Falta ACTAFLOW_BACKEND_URL')
  }
  let analizada: URL
  try {
    analizada = new URL(url)
  } catch {
    throw new ConfiguracionInvalidaError('ACTAFLOW_BACKEND_URL no es una URL valida')
  }
  if (analizada.protocol !== 'https:' && analizada.protocol !== 'http:') {
    throw new ConfiguracionInvalidaError('ACTAFLOW_BACKEND_URL debe usar http o https')
  }

  const secreto = entorno.ACTAFLOW_BFF_HMAC_SECRET ?? ''
  if (secreto.length < LONGITUD_MINIMA_SECRETO) {
    throw new ConfiguracionInvalidaError(
      `ACTAFLOW_BFF_HMAC_SECRET debe tener al menos ${LONGITUD_MINIMA_SECRETO} caracteres`,
    )
  }

  const esperaTexto = entorno.ACTAFLOW_BACKEND_WAIT_MS?.trim()
  const espera = esperaTexto ? Number(esperaTexto) : ESPERA_POR_DEFECTO_MS
  if (!Number.isInteger(espera) || espera < 1_000 || espera > ESPERA_MAXIMA_PERMITIDA_MS) {
    throw new ConfiguracionInvalidaError(
      `ACTAFLOW_BACKEND_WAIT_MS debe ser un entero entre 1000 y ${ESPERA_MAXIMA_PERMITIDA_MS}`,
    )
  }

  return {
    urlBackend: `${analizada.origin}${analizada.pathname.replace(/\/+$/, '')}`,
    secretoHmac: secreto,
    esperaMaxMs: espera,
  }
}
