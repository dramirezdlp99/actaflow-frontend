/**
 * Content-Security-Policy estricta de las rutas de cuenta (ingreso, registro, panel): ahi se
 * escribe la contrasena y se abre la clave privada, asi que solo corre JavaScript propio.
 *
 * - script-src: solo los scripts que llevan el nonce de ESTA peticion (Next se lo pone a los suyos)
 *   y el script del tema por su hash. 'strict-dynamic' deja cargar los chunks que esos scripts piden.
 * - Sin 'unsafe-inline' para scripts. Los estilos si lo permiten: React usa atributos style.
 * - En desarrollo React necesita eval (solo ahi) y el recargado en caliente usa WebSocket.
 * - upgrade-insecure-requests solo si la peticion llego por HTTPS (en `next start` local por http
 *   mandaria los recursos a https://localhost, que no existe).
 */
export function politicaSeguridad({
  nonce,
  hashTema,
  desarrollo,
  https,
}: {
  nonce: string
  hashTema: string
  desarrollo: boolean
  https: boolean
}): string {
  const directivas = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'sha256-${hashTema}' 'strict-dynamic'${desarrollo ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    // Web Workers y Service Worker propios (los chunks de Next salen de este mismo origen).
    "worker-src 'self'",
    "font-src 'self'",
    `connect-src 'self'${desarrollo ? ' ws: wss:' : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ]
  return directivas.join('; ')
}
