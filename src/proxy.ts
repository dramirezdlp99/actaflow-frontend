import { createHash } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { crearClientes, mientrasDespierta } from '@/lib/rpc/clientes'
import { leerConfiguracion } from '@/lib/rpc/configuracion'
import { politicaSeguridad } from '@/lib/seguridad/csp'
import { borrarSesion, galletasDeSesion, nombres } from '@/lib/sesion/galletas'
import { SCRIPT_TEMA_INICIAL } from '@/lib/tema/tema'

/**
 * Proxy de Next (antes "middleware"), solo en las rutas de cuenta:
 *
 * 1. Pone una CSP estricta con un nonce nuevo en cada peticion.
 * 2. En /panel y /expedientes, si el token de acceso ya vencio pero hay token de renovacion, lo rota con
 *    identity-service ANTES de renderizar, y deja las cookies nuevas en la respuesta. Asi las paginas
 *    y las Server Actions siempre ven un token de acceso vigente.
 */

const HASH_TEMA = createHash('sha256').update(SCRIPT_TEMA_INICIAL).digest('base64')
/** Rutas que exigen sesion: aqui se renueva el token de acceso antes de renderizar. */
const RUTAS_CON_SESION = ['/panel', '/expedientes']

function aIngresar(peticion: NextRequest): NextResponse {
  const destino = new URL('/ingresar', peticion.url)
  destino.searchParams.set('siguiente', peticion.nextUrl.pathname)
  const respuesta = NextResponse.redirect(destino)
  borrarSesion(respuesta.cookies)
  return respuesta
}

export async function proxy(peticion: NextRequest): Promise<NextResponse> {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const csp = politicaSeguridad({
    nonce,
    hashTema: HASH_TEMA,
    desarrollo: process.env.NODE_ENV === 'development',
    // Vercel termina TLS antes y avisa con x-forwarded-proto.
    https: peticion.nextUrl.protocol === 'https:' || peticion.headers.get('x-forwarded-proto') === 'https',
  })
  let renovada: ReturnType<typeof galletasDeSesion> = []

  const protegida = RUTAS_CON_SESION.some((ruta) => peticion.nextUrl.pathname.startsWith(ruta))
  if (protegida && !peticion.cookies.has(nombres.acceso())) {
    const renovacion = peticion.cookies.get(nombres.renovacion())?.value
    if (!renovacion) {
      return aIngresar(peticion)
    }
    try {
      const configuracion = leerConfiguracion()
      const auth = crearClientes(configuracion).identidad.auth
      // Tras 15 min sin uso Render duerme identity-service justo cuando vence el token de acceso.
      const { session } = await mientrasDespierta(
        () => auth.refreshSession({ refreshToken: renovacion }),
        configuracion.esperaMaxMs,
      )
      if (!session) {
        return aIngresar(peticion)
      }
      renovada = galletasDeSesion(session)
      // La pagina que se renderiza ahora debe ver ya el token nuevo.
      for (const galleta of renovada) {
        peticion.cookies.set(galleta.nombre, galleta.valor)
      }
    } catch (error) {
      console.warn('No se pudo renovar la sesion', error instanceof Error ? error.message : error)
      return aIngresar(peticion)
    }
  }

  const cabeceras = new Headers(peticion.headers)
  cabeceras.set('x-nonce', nonce)
  // Next lee el nonce de esta cabecera de la PETICION y se lo pone a sus propios scripts.
  cabeceras.set('content-security-policy', csp)
  const respuesta = NextResponse.next({ request: { headers: cabeceras } })
  respuesta.headers.set('content-security-policy', csp)
  respuesta.headers.set('cache-control', 'private, no-store')
  for (const galleta of renovada) {
    respuesta.cookies.set(galleta.nombre, galleta.valor, galleta.opciones)
  }
  return respuesta
}

export const config = {
  matcher: ['/ingresar', '/registro', '/panel/:path*', '/expedientes/:path*'],
}
