/**
 * Enlace de invitacion: /registro#invitacion=<token>. El token va en el fragmento para que nunca
 * llegue al servidor web, a los logs ni a la cabecera Referer.
 */

const TOKEN = /^[A-Za-z0-9_-]{32,128}$/

export function enlaceInvitacion(origen: string, token: string): string {
  return `${origen.replace(/\/+$/, '')}/registro#invitacion=${encodeURIComponent(token)}`
}

/** Token del fragmento, o null si falta o no tiene el formato esperado. */
export function leerInvitacion(fragmento: string): string | null {
  const parametros = new URLSearchParams(fragmento.replace(/^#/, ''))
  const token = parametros.get('invitacion')?.trim() ?? ''
  return TOKEN.test(token) ? token : null
}
