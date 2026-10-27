'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnilloAudio } from '@/lib/hilos/anillo'
import type { MensajeAlHilo, MensajeDelHilo, Sellado } from '@/lib/hilos/hiloAudio'

export type EstadoGrabadora =
  | 'inactiva'
  | 'pidiendo'
  | 'grabando'
  | 'denegada'
  | 'bloqueada-pagina'
  | 'sin-soporte'
  | 'error'

/** Como viaja el audio del worklet al Worker: memoria compartida o mensajes transferidos. */
export type CaminoAudio = 'anillo' | 'mensajes'

export type SegmentoSellado = { peticion: Uint8Array; duracionMs: number; hablante: string }

/** Chrome expone la Permissions-Policy del documento; los demas navegadores no (se asume permitida). */
function politicaPermite(): boolean {
  const politica: unknown = Reflect.get(document, 'permissionsPolicy') ?? Reflect.get(document, 'featurePolicy')
  if (typeof politica !== 'object' || politica === null) {
    return true
  }
  const permite: unknown = Reflect.get(politica, 'allowsFeature')
  return typeof permite === 'function' ? Boolean(permite.call(politica, 'microphone')) : true
}

/** 3 s de audio a 48 kHz: holgura de sobra para un Worker que lee cada 25 ms. */
const CAPACIDAD_ANILLO = 48_000 * 3

type Activa = {
  flujo: MediaStream
  contexto: AudioContext
  nodos: AudioNode[]
  hilo: Worker
  nodo: AudioWorkletNode
  /** Se cumple cuando el Worker entrego la ultima intervencion y se cerro. */
  fin: Promise<void>
}

/**
 * Microfono de la sala, en TRES hilos:
 *
 *   hilo de audio (AudioWorklet)  ── memoria compartida o MessagePort ──►  Web Worker  ──► sellado
 *                                                                              │
 *   hilo principal (React) ◄──────────── nivel y peticion ya sellada ─────────┘
 *
 * El hilo principal no toca el audio: solo pinta la barrita y envia lo sellado. Por eso la sala no
 * se congela aunque el remuestreo, el detector de voz, el WAV y el cifrado trabajen sin parar.
 * Con crossOriginIsolated (COOP + COEP, next.config.ts) el audio va por un SharedArrayBuffer; si no,
 * por un MessagePort conectado directo del worklet al Worker.
 */
export function useGrabadora(alSellar: (segmento: SegmentoSellado) => void, alFallar: (mensaje: string) => void) {
  const [estado, setEstado] = useState<EstadoGrabadora>('inactiva')
  const [nivel, setNivel] = useState(0)
  const [camino, setCamino] = useState<CaminoAudio | null>(null)
  const activa = useRef<Activa | null>(null)
  const sellado = useRef(alSellar)
  const fallo = useRef(alFallar)
  useEffect(() => {
    sellado.current = alSellar
    fallo.current = alFallar
  }, [alSellar, alFallar])

  const enviarAlHilo = (hilo: Worker, mensaje: MensajeAlHilo, transferir: Transferable[] = []) =>
    hilo.postMessage(mensaje, transferir)

  const soltarAudio = useCallback((a: Activa) => {
    a.nodo.port.postMessage({ tipo: 'detener' })
    for (const nodo of a.nodos) {
      nodo.disconnect()
    }
    for (const pista of a.flujo.getTracks()) {
      pista.stop()
    }
    void a.contexto.close().catch(() => undefined)
  }, [])

  const iniciar = useCallback(
    async (datos: Sellado) => {
      if (activa.current) {
        return
      }
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof AudioContext === 'undefined' ||
        typeof AudioWorkletNode === 'undefined' ||
        typeof Worker === 'undefined'
      ) {
        setEstado('sin-soporte')
        return
      }
      if (!politicaPermite()) {
        // Se llego a la sala sin recargar desde una pagina que no permite el microfono.
        setEstado('bloqueada-pagina')
        return
      }
      setEstado('pidiendo')
      let flujo: MediaStream
      try {
        flujo = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
      } catch (error) {
        setEstado(error instanceof DOMException && error.name === 'NotAllowedError' ? 'denegada' : 'error')
        return
      }
      try {
        const contexto = new AudioContext()
        await contexto.audioWorklet.addModule('/worklets/captura-audio.js')
        const fuente = contexto.createMediaStreamSource(flujo)
        // Una salida conectada al destino (escribe silencio): asi todos los navegadores procesan el nodo.
        const nodo = new AudioWorkletNode(contexto, 'captura-audio', { numberOfInputs: 1, numberOfOutputs: 1 })
        const hilo = new Worker(new URL('../../workers/audio.worker.ts', import.meta.url), { type: 'module' })
        let terminado = () => {}
        const fin = new Promise<void>((resolver) => {
          terminado = resolver
        })
        hilo.onmessage = (evento: MessageEvent<MensajeDelHilo>) => {
          const m = evento.data
          if (m.tipo === 'nivel') setNivel(m.valor)
          else if (m.tipo === 'segmento') sellado.current(m)
          else if (m.tipo === 'error') fallo.current(m.mensaje)
          else if (m.tipo === 'fin') {
            hilo.terminate()
            terminado()
          }
        }
        hilo.onerror = () => {
          fallo.current('El hilo de audio se detuvo. Apaga y vuelve a encender el micrófono.')
          terminado()
        }

        const frecuencia = contexto.sampleRate
        if (globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined') {
          const anillo = AnilloAudio.crear(CAPACIDAD_ANILLO)
          enviarAlHilo(hilo, { tipo: 'iniciar', frecuencia, ...datos, modo: 'anillo', memoria: anillo.memoria })
          nodo.port.postMessage({ tipo: 'anillo', memoria: anillo.memoria })
          setCamino('anillo')
        } else {
          const canal = new MessageChannel()
          enviarAlHilo(hilo, { tipo: 'iniciar', frecuencia, ...datos, modo: 'mensajes', puerto: canal.port2 }, [
            canal.port2,
          ])
          nodo.port.postMessage({ tipo: 'mensajes', puerto: canal.port1 }, [canal.port1])
          setCamino('mensajes')
        }
        fuente.connect(nodo)
        nodo.connect(contexto.destination)
        activa.current = { flujo, contexto, nodos: [fuente, nodo], hilo, nodo, fin }
        setEstado('grabando')
      } catch {
        for (const pista of flujo.getTracks()) {
          pista.stop()
        }
        setEstado('error')
      }
    },
    [],
  )

  /** Cambia quien habla: lo siguiente que se corte se sella con esa persona. */
  const cambiarHablante = useCallback((id: string) => {
    const a = activa.current
    if (a) enviarAlHilo(a.hilo, { tipo: 'hablante', id })
  }, [])

  /**
   * Detiene el microfono. El Worker entrega lo que se estaba diciendo y se cierra solo; la promesa se
   * cumple entonces (o a los 10 s, por si el hilo no responde).
   */
  const detener = useCallback(async (): Promise<void> => {
    const a = activa.current
    activa.current = null
    setNivel(0)
    setEstado('inactiva')
    if (!a) {
      return
    }
    soltarAudio(a)
    enviarAlHilo(a.hilo, { tipo: 'detener' })
    await Promise.race([a.fin, new Promise<void>((r) => setTimeout(r, 10_000))])
    a.hilo.terminate()
  }, [soltarAudio])

  useEffect(
    () => () => {
      const a = activa.current
      activa.current = null
      if (a) {
        soltarAudio(a)
        a.hilo.terminate()
      }
    },
    [soltarAudio],
  )

  return { estado, nivel, camino, iniciar, detener, cambiarHablante }
}
