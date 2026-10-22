'use client'

import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import {
  WatchHearingEventsResponseSchema,
  type WatchHearingEventsResponse,
} from '@/gen/actaflow/hearings/v1/hearing_pb'
import { desdeTexto } from '@/lib/audiencias/protocolo'

const LINEA = z.object({ e: z.string().optional(), fin: z.boolean().optional(), error: z.string().optional() })

export type Conexion = 'conectando' | 'en-vivo' | 'reintentando' | 'cerrada'

const dormir = (ms: number, senal: AbortSignal) =>
  new Promise<void>((resolver) => {
    const t = setTimeout(resolver, ms)
    senal.addEventListener('abort', () => {
      clearTimeout(t)
      resolver()
    })
  })

/**
 * Eventos en vivo de la audiencia. Cada pedido dura a lo sumo ~50 s; al cerrarse se vuelve a pedir
 * desde el ultimo evento recibido, asi que una caida de red o un reinicio no pierden nada. Termina
 * al recibir el fin de la audiencia.
 */
export function useEventosAudiencia(
  casoId: string,
  audienciaId: string | null,
  alEvento: (evento: WatchHearingEventsResponse) => void,
): Conexion {
  const [conexion, setConexion] = useState<Conexion>('conectando')
  const manejar = useRef(alEvento)
  useEffect(() => {
    manejar.current = alEvento
  }, [alEvento])

  useEffect(() => {
    if (!audienciaId) {
      return
    }
    const corte = new AbortController()
    let despues = 0n
    let terminada = false
    let fallos = 0

    const una = async () => {
      const respuesta = await fetch(
        `/expedientes/${casoId}/audiencia/eventos?audiencia=${audienciaId}&despues=${despues}`,
        { signal: corte.signal, cache: 'no-store' },
      )
      if (!respuesta.ok || !respuesta.body || !respuesta.headers.get('content-type')?.includes('ndjson')) {
        throw new Error(`HTTP ${respuesta.status}`)
      }
      setConexion('en-vivo')
      const lector = respuesta.body.getReader()
      const decodificador = new TextDecoder()
      let resto = ''
      while (true) {
        const { value, done } = await lector.read()
        if (done) {
          return
        }
        resto += decodificador.decode(value, { stream: true })
        const lineas = resto.split('\n')
        resto = lineas.pop() ?? ''
        for (const linea of lineas) {
          if (!linea) {
            continue
          }
          const dato = LINEA.parse(JSON.parse(linea))
          if (dato.error) {
            throw new Error(dato.error)
          }
          if (dato.e) {
            const evento = desdeTexto(WatchHearingEventsResponseSchema, dato.e)
            despues = evento.eventSequence > despues ? evento.eventSequence : despues
            fallos = 0
            if (evento.event.case === 'hearingEnded') {
              terminada = true
            }
            manejar.current(evento)
          }
        }
      }
    }

    void (async () => {
      while (!corte.signal.aborted && !terminada) {
        try {
          await una()
        } catch (error) {
          if (corte.signal.aborted) {
            return
          }
          fallos += 1
          console.warn('Eventos de la audiencia: se reintenta', error)
          setConexion('reintentando')
          await dormir(Math.min(15_000, 1_000 * 2 ** Math.min(fallos, 4)), corte.signal)
        }
      }
      if (terminada) {
        setConexion('cerrada')
      }
    })()

    return () => corte.abort()
  }, [casoId, audienciaId])

  return audienciaId ? conexion : 'cerrada'
}
