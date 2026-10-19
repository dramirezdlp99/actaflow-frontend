import 'server-only'
import { Code, ConnectError } from '@connectrpc/connect'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import type { Account } from '@/gen/actaflow/identity/v1/account_pb'
import { crearClientes, type ClientesRpc } from '@/lib/rpc/clientes'
import { leerConfiguracion } from '@/lib/rpc/configuracion'
import { nombres } from './galletas'

/** Un juego de clientes por peticion (la configuracion se lee y valida en el momento). */
export const clientes = cache((): ClientesRpc => crearClientes(leerConfiguracion()))

/** Cabeceras de una llamada en nombre de la persona: su token de acceso, nunca visible en el navegador. */
export function comoPersona(tokenAcceso: string): { headers: Record<string, string> } {
  return { headers: { authorization: `Bearer ${tokenAcceso}` } }
}

export type SesionActual = { cuenta: Account; tokenAcceso: string }

/**
 * La sesion de esta peticion, comprobada por identity-service. El proxy ya renovo el token si
 * hacia falta; aqui solo se lee. Devuelve null si no hay sesion valida.
 */
export const sesionActual = cache(async (): Promise<SesionActual | null> => {
  const tokenAcceso = (await cookies()).get(nombres.acceso())?.value
  if (!tokenAcceso) {
    return null
  }
  try {
    const { account } = await clientes().identidad.cuenta.getCurrentAccount({}, comoPersona(tokenAcceso))
    return account ? { cuenta: account, tokenAcceso } : null
  } catch (error) {
    if (error instanceof ConnectError && error.code === Code.Unauthenticated) {
      return null
    }
    throw error
  }
})

/** Para paginas protegidas: sin sesion, a ingresar (y volver aqui despues). */
export async function exigirSesion(volverA: string): Promise<SesionActual> {
  const sesion = await sesionActual()
  if (!sesion) {
    redirect(`/ingresar?siguiente=${encodeURIComponent(volverA)}`)
  }
  return sesion
}

/** Solo rutas internas: evita que ?siguiente= mande a otro sitio (redireccion abierta). */
export function destinoSeguro(siguiente: string | null | undefined): string {
  return siguiente && /^\/(?!\/)[\w\-/?=&%.]*$/.test(siguiente) && !siguiente.startsWith('/\\') ? siguiente : '/panel'
}
