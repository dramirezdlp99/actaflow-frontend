import 'server-only'
import { timestampMs, type Timestamp } from '@bufbuild/protobuf/wkt'
import type { Session } from '@/gen/actaflow/identity/v1/auth_pb'

/**
 * Cookies de sesion del BFF. Los tokens solo existen en el servidor de Next y en estas cookies:
 * httpOnly (el JavaScript del navegador no puede leerlas), SameSite=Lax y, en produccion, Secure con
 * el prefijo __Host- (el navegador obliga a HTTPS, sin dominio y con path=/).
 */

const enProduccion = () => process.env.NODE_ENV === 'production'
const prefijo = () => (enProduccion() ? '__Host-' : '')

export const nombres = {
  acceso: () => `${prefijo()}actaflow-acceso`,
  renovacion: () => `${prefijo()}actaflow-renovacion`,
  desafio: () => `${prefijo()}actaflow-desafio`,
}

/** Margen para que la cookie desaparezca un poco antes de que venza el token. */
const MARGEN_SEGUNDOS = 30

export type OpcionesGalleta = {
  httpOnly: true
  secure: boolean
  sameSite: 'lax'
  path: '/'
  maxAge: number
}

export function opciones(maxAgeSegundos: number): OpcionesGalleta {
  return { httpOnly: true, secure: enProduccion(), sameSite: 'lax', path: '/', maxAge: Math.max(0, maxAgeSegundos) }
}

export function segundosHasta(vence: Timestamp | undefined, ahora: number = Date.now()): number {
  return vence ? Math.floor((timestampMs(vence) - ahora) / 1000) - MARGEN_SEGUNDOS : 0
}

export type GalletaNueva = { nombre: string; valor: string; opciones: OpcionesGalleta }

/** Las dos cookies que deja una sesion recien emitida o rotada. */
export function galletasDeSesion(sesion: Session, ahora: number = Date.now()): GalletaNueva[] {
  return [
    {
      nombre: nombres.acceso(),
      valor: sesion.accessToken,
      opciones: opciones(segundosHasta(sesion.accessTokenExpiresAt, ahora)),
    },
    {
      nombre: nombres.renovacion(),
      valor: sesion.refreshToken,
      opciones: opciones(segundosHasta(sesion.refreshTokenExpiresAt, ahora)),
    },
  ]
}

/** Interfaz minima comun a `cookies()` de next/headers y a `response.cookies` del proxy. */
export type Tarro = {
  get(nombre: string): { value: string } | undefined
  set(nombre: string, valor: string, opciones: OpcionesGalleta): unknown
}

/**
 * Borra una cookie venciendola con los MISMOS atributos con que se creo. Un `delete()` simple no
 * sirve: el navegador ignora cualquier Set-Cookie de una cookie __Host- que no lleve Secure y Path=/.
 */
export function borrarGalleta(tarro: Tarro, nombre: string): void {
  tarro.set(nombre, '', opciones(0))
}

export function guardarSesion(tarro: Tarro, sesion: Session): void {
  for (const galleta of galletasDeSesion(sesion)) {
    tarro.set(galleta.nombre, galleta.valor, galleta.opciones)
  }
}

export function borrarSesion(tarro: Tarro): void {
  for (const nombre of [nombres.acceso(), nombres.renovacion(), nombres.desafio()]) {
    borrarGalleta(tarro, nombre)
  }
}
