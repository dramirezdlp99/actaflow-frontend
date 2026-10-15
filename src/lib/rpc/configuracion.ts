import 'server-only'
import { z } from 'zod'

/**
 * Configuracion del BFF. Solo existe en el servidor: el navegador nunca ve estos valores.
 *
 * TypeScript solo protege en tiempo de compilacion; las variables de entorno llegan como texto en
 * tiempo de ejecucion. Por eso se PARSEAN con Zod (no se "asumen" con un `as`): si algo no cumple,
 * se sabe aqui, con un mensaje claro, y no a mitad de una llamada.
 */

const LONGITUD_MINIMA_SECRETO = 32
// Vercel Hobby corta las funciones a los 300 s: la espera debe quedar por debajo.
const ESPERA_MAXIMA_PERMITIDA_MS = 280_000

const secreto = (variable: string) =>
  z.string({ error: `Falta ${variable}` }).min(LONGITUD_MINIMA_SECRETO, {
    error: `${variable} debe tener al menos ${LONGITUD_MINIMA_SECRETO} caracteres`,
  })

const url = (variable: string) =>
  z
    .url({ protocol: /^https?$/, error: `${variable} debe ser una URL http o https` })
    .transform((texto) => {
      const analizada = new URL(texto)
      return `${analizada.origin}${analizada.pathname.replace(/\/+$/, '')}`
    })

const servicio = (prefijo: 'IDENTITY' | 'LEGAL_CASE') =>
  z.object({
    url: url(`ACTAFLOW_${prefijo}_URL`),
    secreto: secreto(`ACTAFLOW_${prefijo}_HMAC_SECRET`),
  })

const esquemaEsperaMs = z.coerce
  .number({ error: 'ACTAFLOW_BACKEND_WAIT_MS debe ser un numero' })
  .int()
  .min(1_000)
  .max(ESPERA_MAXIMA_PERMITIDA_MS, {
    error: `ACTAFLOW_BACKEND_WAIT_MS debe estar entre 1000 y ${ESPERA_MAXIMA_PERMITIDA_MS}`,
  })
  .default(120_000)

const esquemaConfiguracion = z.discriminatedUnion('modo', [
  // Contract-First: con mocks tipados el frontend funciona sin ningun microservicio levantado.
  z.object({ modo: z.literal('mock'), esperaMaxMs: esquemaEsperaMs }),
  z
    .object({
      modo: z.literal('live'),
      // grpc: nativo sobre HTTP/2 (local). grpc-web: HTTP/1.1 (Render Free no expone HTTP/2).
      transporte: z.enum(['grpc', 'grpc-web']).default('grpc-web'),
      identidad: servicio('IDENTITY'),
      expedientes: servicio('LEGAL_CASE'),
      esperaMaxMs: esquemaEsperaMs,
    })
    .refine((c) => c.identidad.secreto !== c.expedientes.secreto, {
      error: 'ACTAFLOW_IDENTITY_HMAC_SECRET y ACTAFLOW_LEGAL_CASE_HMAC_SECRET deben ser distintos (uno por par)',
    }),
])

export type ConfiguracionBff = z.infer<typeof esquemaConfiguracion>
export type ConfiguracionEnVivo = Extract<ConfiguracionBff, { modo: 'live' }>
export type TransporteRpc = ConfiguracionEnVivo['transporte']

export class ConfiguracionInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ConfiguracionInvalidaError'
  }
}

type Entorno = Record<string, string | undefined>

const vacioComoAusente = (valor: string | undefined) => {
  const limpio = valor?.trim()
  return limpio ? limpio : undefined
}

/**
 * Lee y valida la configuracion en el momento de la peticion (no al importar el modulo), para que
 * el build de produccion no necesite los secretos.
 */
export function leerConfiguracion(entorno: Entorno = process.env): ConfiguracionBff {
  const resultado = esquemaConfiguracion.safeParse({
    modo: vacioComoAusente(entorno.ACTAFLOW_RPC_MODE) ?? 'live',
    transporte: vacioComoAusente(entorno.ACTAFLOW_RPC_TRANSPORT),
    identidad: { url: vacioComoAusente(entorno.ACTAFLOW_IDENTITY_URL), secreto: entorno.ACTAFLOW_IDENTITY_HMAC_SECRET },
    expedientes: {
      url: vacioComoAusente(entorno.ACTAFLOW_LEGAL_CASE_URL),
      secreto: entorno.ACTAFLOW_LEGAL_CASE_HMAC_SECRET,
    },
    esperaMaxMs: vacioComoAusente(entorno.ACTAFLOW_BACKEND_WAIT_MS),
  })
  if (!resultado.success) {
    const mensajes = resultado.error.issues.map((problema) =>
      problema.code === 'invalid_union' ? 'ACTAFLOW_RPC_MODE debe ser live o mock' : problema.message,
    )
    throw new ConfiguracionInvalidaError([...new Set(mensajes)].join('; '))
  }
  return resultado.data
}
