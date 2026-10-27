'use client'

import { useEffect, useRef, useState } from 'react'
import {
  WatchHearingEventsResponseSchema,
  type WatchHearingEventsResponse,
} from '@/gen/actaflow/hearings/v1/hearing_pb'
import { desdeTexto } from '@/lib/audiencias/protocolo'
import { tiempoReal } from '@/lib/hilos/clienteTiempoReal'
import type { Conexion } from '@/lib/hilos/tiempoReal'

export type { Conexion }

/**
 * Eventos en vivo de la audiencia. Los trae la central de tiempo real (Shared Worker): UNA conexion
 * por navegador aunque la sala este abierta en varias pestanas. Cada pedido dura a lo sumo ~50 s y la
 * central lo vuelve a pedir desde el ultimo evento, sin perder ninguno; una pestana nueva recibe
 * enseguida lo que ya paso.
 */
export function useEventosAudiencia(
  casoId: string,
  audienciaId: string | null,
  alEvento: (evento: WatchHearingEventsResponse) => void,
): { conexion: Conexion; pestanas: number } {
  const [conexion, setConexion] = useState<Conexion>('conectando')
  const [pestanas, setPestanas] = useState(1)
  const manejar = useRef(alEvento)
  useEffect(() => {
    manejar.current = alEvento
  }, [alEvento])

  useEffect(() => {
    if (!audienciaId) {
      return
    }
    return tiempoReal().suscribirAudiencia(
      casoId,
      audienciaId,
      (e) => manejar.current(desdeTexto(WatchHearingEventsResponseSchema, e)),
      (estado, n) => {
        setConexion(estado)
        setPestanas(n)
      },
    )
  }, [casoId, audienciaId])

  return { conexion: audienciaId ? conexion : 'cerrada', pestanas }
}
