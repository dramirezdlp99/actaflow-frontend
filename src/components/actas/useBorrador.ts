'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { enviarBorrador, traerBorrador } from '@/app/acciones/colaboracion'
import { GetDocumentStateResponseSchema } from '@/gen/actaflow/collaboration/v1/collaboration_pb'
import { BandejaIndexada } from '@/lib/actas/bandejaIndexada'
import {
  BandejaEnMemoria,
  Rechazado,
  SinConexion,
  SincronizadorBorrador,
  type ContextoBorrador,
  type EstadoBorrador,
  type Transporte,
} from '@/lib/actas/borrador'
import { pedirSincronizacion } from '@/components/sinConexion/ServiceWorker'
import { desdeTexto } from '@/lib/audiencias/protocolo'
import { aBase64Url } from '@/lib/cripto/bytes'

/** Cada cuanto se traen los cambios de los demas mientras la pestana esta a la vista. */
export const INTERVALO_BORRADOR_MS = 3_000

/** Las Server Actions como transporte: sin red lanzan SinConexion; un rechazo definitivo, Rechazado. */
const transporte: Transporte = {
  async traer(actaId, despues) {
    if (!navigator.onLine) throw new SinConexion()
    const r = await traerBorrador({ actaId, despues }).catch(() => {
      throw new SinConexion()
    })
    if (!r.ok) throw r.definitivo ? new Rechazado(r.mensaje) : new Error(r.mensaje)
    return desdeTexto(GetDocumentStateResponseSchema, r.respuesta)
  },
  async enviar(peticion) {
    if (!navigator.onLine) throw new SinConexion()
    const r = await enviarBorrador({ peticion: aBase64Url(peticion) }).catch(() => {
      throw new SinConexion()
    })
    if (!r.ok) throw r.definitivo ? new Rechazado(r.mensaje) : new Error(r.mensaje)
    return r.secuencias
  },
}

const VACIO: EstadoBorrador = { valores: {}, pendientes: 0, conexion: 'en-linea', aviso: null }

/**
 * El borrador colaborativo en React: arranca con lo guardado en este navegador (sirve sin red), se
 * pone al dia con el servidor y sigue los cambios de los demas. Editar nunca espera a la red.
 */
export function useBorrador(contexto: ContextoBorrador | null, activo: boolean) {
  const [estado, setEstado] = useState<EstadoBorrador>(VACIO)
  const sincronizador = useRef<SincronizadorBorrador | null>(null)

  useEffect(() => {
    if (!contexto || !activo) return
    const bandeja = typeof indexedDB === 'undefined' ? new BandejaEnMemoria() : new BandejaIndexada()
    const s = new SincronizadorBorrador(contexto, transporte, bandeja, setEstado)
    sincronizador.current = s
    void s.iniciar()
    const ponerseAlDia = () => {
      if (document.visibilityState === 'visible') void s.sincronizar()
    }
    const temporizador = setInterval(ponerseAlDia, INTERVALO_BORRADOR_MS)
    // Al volver la red (o cuando el Service Worker avisa), la bandeja de salida se envia sola.
    const alVolver = () => void s.sincronizar()
    const delServiceWorker = (e: MessageEvent) => {
      if (typeof e.data === 'object' && e.data !== null && Reflect.get(e.data, 'tipo') === 'sincronizar') alVolver()
    }
    window.addEventListener('online', alVolver)
    document.addEventListener('visibilitychange', ponerseAlDia)
    navigator.serviceWorker?.addEventListener('message', delServiceWorker)
    return () => {
      clearInterval(temporizador)
      window.removeEventListener('online', alVolver)
      document.removeEventListener('visibilitychange', ponerseAlDia)
      navigator.serviceWorker?.removeEventListener('message', delServiceWorker)
      sincronizador.current = null
    }
  }, [contexto, activo])

  const cambiar = useCallback((campo: string, valor: string | null) => {
    void sincronizador.current?.cambiar(campo, valor)
    // Sin red, el navegador avisara al Service Worker cuando vuelva (Background Sync).
    if (!navigator.onLine) pedirSincronizacion()
  }, [])

  return { ...estado, cambiar }
}
