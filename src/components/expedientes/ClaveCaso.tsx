'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { leerClavePrivada } from '@/lib/cripto/almacen'
import { desenvolverClave } from '@/lib/cripto/casos'
import { textoAEnvoltura, type EnvolturaTexto } from '@/lib/expedientes/formato'

/**
 * La clave del caso, abierta en este navegador: la clave privada (IndexedDB, no exportable) desenvuelve
 * la envoltura de quien mira. Nada de esto viaja al servidor.
 */
export type EstadoClave =
  | { tipo: 'abriendo' }
  | { tipo: 'lista'; clave: CryptoKey }
  | { tipo: 'sin-clave' }
  | { tipo: 'sin-privada' }
  | { tipo: 'error' }

const Contexto = createContext<EstadoClave>({ tipo: 'abriendo' })

export function useClaveCaso(): EstadoClave {
  return useContext(Contexto)
}

export function ProveedorClaveCaso({
  cuentaId,
  envoltura,
  children,
}: {
  cuentaId: string
  envoltura: EnvolturaTexto | null
  children: React.ReactNode
}) {
  const [estado, setEstado] = useState<EstadoClave>(envoltura ? { tipo: 'abriendo' } : { tipo: 'sin-clave' })
  // La envoltura llega como objeto nuevo en cada render del servidor: se compara por contenido.
  const huella = envoltura ? `${envoltura.idDestinatario}.${envoltura.efimera}.${envoltura.envuelta}` : ''

  useEffect(() => {
    if (!envoltura) {
      return
    }
    let vigente = true
    const abrir = async (): Promise<EstadoClave> => {
      const privada = await leerClavePrivada(cuentaId)
      if (!privada) {
        return { tipo: 'sin-privada' }
      }
      try {
        return { tipo: 'lista', clave: await desenvolverClave(privada, textoAEnvoltura(envoltura)) }
      } catch (error) {
        console.warn('No se pudo abrir la clave del caso', error)
        return { tipo: 'error' }
      }
    }
    abrir()
      .catch(() => ({ tipo: 'error' }) satisfies EstadoClave)
      .then((resultado) => {
        if (vigente) {
          setEstado(resultado)
        }
      })
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `huella` resume la envoltura
  }, [cuentaId, huella])

  return <Contexto.Provider value={estado}>{children}</Contexto.Provider>
}

/** Mensaje para cuando el contenido cifrado no se puede abrir en este navegador. */
export function AvisoClave({ estado }: { estado: EstadoClave }) {
  const textos: Partial<Record<EstadoClave['tipo'], string>> = {
    'sin-clave':
      'Aún no tienes la clave de este expediente. Cualquier participante que ya la tenga puede entregártela desde la lista de participantes.',
    'sin-privada':
      'Tu clave privada no está abierta en este navegador. Cierra sesión y vuelve a ingresar aquí para leer el contenido cifrado.',
    error: 'No se pudo abrir la clave de este expediente en este navegador.',
  }
  const texto = textos[estado.tipo]
  return texto ? (
    <p role="status" className="rounded-lg border border-alerta/40 bg-superficie px-4 py-3 text-sm text-tinta-suave">
      {texto}
    </p>
  ) : null
}
