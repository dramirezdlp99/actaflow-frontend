'use client'

import { fromBinary } from '@bufbuild/protobuf'
import { useCallback, useEffect, useRef, useState } from 'react'
import { enviarBorrador } from '@/app/acciones/colaboracion'
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
import { aBase64Url } from '@/lib/cripto/bytes'
import { esErrorTraido, tiempoReal } from '@/lib/hilos/clienteTiempoReal'

/**
 * Leer pasa por la central de tiempo real (Shared Worker): una consulta por navegador, compartida por
 * todas las pestanas. Enviar va por Server Action. Sin red se lanza SinConexion; un rechazo
 * definitivo, Rechazado.
 */
const transporte = (casoId: string): Transporte => ({
  async traer(actaId, despues) {
    if (!navigator.onLine) throw new SinConexion()
    try {
      const bytes = await tiempoReal().traerBorrador(casoId, actaId, despues)
      return fromBinary(GetDocumentStateResponseSchema, bytes)
    } catch (e) {
      if (!esErrorTraido(e)) throw e
      if (e.sinConexion) throw new SinConexion()
      throw e.definitivo ? new Rechazado(e.mensaje) : new Error(e.mensaje)
    }
  },
  async enviar(peticion) {
    if (!navigator.onLine) throw new SinConexion()
    const r = await enviarBorrador({ peticion: aBase64Url(peticion) }).catch(() => {
      throw new SinConexion()
    })
    if (!r.ok) throw r.definitivo ? new Rechazado(r.mensaje) : new Error(r.mensaje)
    return r.secuencias
  },
})

const VACIO: EstadoBorrador = { valores: {}, pendientes: 0, conexion: 'en-linea', aviso: null }

/**
 * El borrador colaborativo en React: arranca con lo guardado en este navegador (sirve sin red), se
 * pone al dia con el servidor y sigue los cambios de los demas. Editar nunca espera a la red.
 */
export function useBorrador(contexto: ContextoBorrador | null, activo: boolean) {
  const [estado, setEstado] = useState<EstadoBorrador>(VACIO)
  const [pestanas, setPestanas] = useState(1)
  const sincronizador = useRef<SincronizadorBorrador | null>(null)

  useEffect(() => {
    if (!contexto || !activo) return
    const bandeja = typeof indexedDB === 'undefined' ? new BandejaEnMemoria() : new BandejaIndexada()
    const s = new SincronizadorBorrador(contexto, transporte(contexto.casoId), bandeja, setEstado)
    sincronizador.current = s
    void s.iniciar()
    const ponerseAlDia = () => {
      if (document.visibilityState === 'visible') void s.sincronizar()
    }
    // La central consulta cada 3 s (una vez por navegador) y avisa cuando hay cambios de otros.
    const dejar = tiempoReal().seguirBorrador(contexto.casoId, contexto.actaId, (pestanas) => {
      setPestanas(pestanas)
      void s.sincronizar()
    })
    // Al volver la red (o cuando el Service Worker avisa), la bandeja de salida se envia sola.
    const alVolver = () => void s.sincronizar()
    const delServiceWorker = (e: MessageEvent) => {
      if (typeof e.data === 'object' && e.data !== null && Reflect.get(e.data, 'tipo') === 'sincronizar') alVolver()
    }
    window.addEventListener('online', alVolver)
    document.addEventListener('visibilitychange', ponerseAlDia)
    navigator.serviceWorker?.addEventListener('message', delServiceWorker)
    return () => {
      dejar()
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

  return { ...estado, cambiar, pestanas }
}
