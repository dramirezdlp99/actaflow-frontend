'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Remuestreador, Segmentador, type Intervencion } from '@/lib/audiencias/audio'

export type EstadoGrabadora =
  | 'inactiva'
  | 'pidiendo'
  | 'grabando'
  | 'denegada'
  | 'bloqueada-pagina'
  | 'sin-soporte'
  | 'error'

/** Chrome expone la Permissions-Policy del documento; los demas navegadores no (se asume permitida). */
function politicaPermite(): boolean {
  const politica: unknown = Reflect.get(document, 'permissionsPolicy') ?? Reflect.get(document, 'featurePolicy')
  if (typeof politica !== 'object' || politica === null) {
    return true
  }
  const permite: unknown = Reflect.get(politica, 'allowsFeature')
  return typeof permite === 'function' ? Boolean(permite.call(politica, 'microphone')) : true
}

type Activa = { flujo: MediaStream; contexto: AudioContext; nodos: AudioNode[]; segmentador: Segmentador }

/**
 * Microfono de la sala. El audio crudo nunca sale de esta pestana: se remuestrea a 16 kHz, el
 * Segmentador lo corta en intervenciones y cada una se entrega a `alCortar` (que la sella).
 *
 * Usa ScriptProcessorNode y no AudioWorklet a proposito: el worklet se carga como un script aparte,
 * y la CSP estricta (nonce + 'strict-dynamic') de las paginas con sesion no lo dejaria cargar.
 */
export function useGrabadora(alCortar: (intervencion: Intervencion) => void) {
  const [estado, setEstado] = useState<EstadoGrabadora>('inactiva')
  const [nivel, setNivel] = useState(0)
  const activa = useRef<Activa | null>(null)
  const cortar = useRef(alCortar)
  useEffect(() => {
    cortar.current = alCortar
  }, [alCortar])

  const liberar = useCallback(() => {
    const a = activa.current
    activa.current = null
    if (!a) {
      return
    }
    for (const nodo of a.nodos) {
      nodo.disconnect()
    }
    for (const pista of a.flujo.getTracks()) {
      pista.stop()
    }
    void a.contexto.close().catch(() => undefined)
  }, [])

  const iniciar = useCallback(async () => {
    if (activa.current) {
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
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
      const fuente = contexto.createMediaStreamSource(flujo)
      const procesador = contexto.createScriptProcessor(4096, 1, 1)
      const remuestreador = new Remuestreador(contexto.sampleRate)
      const segmentador = new Segmentador()
      let ultimoNivel = 0
      procesador.onaudioprocess = (evento) => {
        const muestras = remuestreador.procesar(evento.inputBuffer.getChannelData(0))
        for (const intervencion of segmentador.agregar(muestras)) {
          cortar.current(intervencion)
        }
        const ahora = performance.now()
        if (ahora - ultimoNivel > 120) {
          ultimoNivel = ahora
          setNivel(segmentador.nivel)
        }
      }
      fuente.connect(procesador)
      // Chrome solo procesa un nodo conectado a la salida; escribe silencio (no se oye nada).
      procesador.connect(contexto.destination)
      activa.current = { flujo, contexto, nodos: [fuente, procesador], segmentador }
      setEstado('grabando')
    } catch {
      for (const pista of flujo.getTracks()) {
        pista.stop()
      }
      setEstado('error')
    }
  }, [])

  /** Detiene y entrega lo que se estaba diciendo en ese momento. */
  const detener = useCallback(() => {
    const ultima = activa.current?.segmentador.cerrar()
    liberar()
    setNivel(0)
    setEstado('inactiva')
    if (ultima) {
      cortar.current(ultima)
    }
  }, [liberar])

  useEffect(() => liberar, [liberar])

  return { estado, nivel, iniciar, detener }
}
