import { HiloAudio, type MensajeAlHilo } from '@/lib/hilos/hiloAudio'
import { alcanceWorker } from '@/lib/hilos/alcance'

/**
 * Web Worker de la sala: remuestrea, corta las intervenciones, codifica el WAV y lo sella para el
 * motor de IA, fuera del hilo principal. La logica vive en HiloAudio (se prueba en Node).
 */
const alcance = alcanceWorker()
const hilo = new HiloAudio((mensaje, transferir) => alcance.postMessage(mensaje, transferir ?? []))
alcance.onmessage = (evento: MessageEvent<MensajeAlHilo>) => hilo.recibir(evento.data)
