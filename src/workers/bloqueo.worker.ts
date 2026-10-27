import { alcanceWorker } from '@/lib/hilos/alcance'
import { CANAL_DESBLOQUEO, HiloBloqueo, type MensajeAlBloqueo } from '@/lib/rendimiento/bloqueo'

/**
 * Web Worker del laboratorio de rendimiento: hace el calculo pesado fuera del hilo principal y es
 * quien DESBLOQUEA el hilo principal escribiendo en la memoria compartida cuando otra pestana se lo
 * pide por BroadcastChannel (o cuando vence su temporizador).
 */
const alcance = alcanceWorker()
const hilo = new HiloBloqueo((m) => alcance.postMessage(m, []))
alcance.onmessage = (evento: MessageEvent<MensajeAlBloqueo>) => hilo.recibir(evento.data)
new BroadcastChannel(CANAL_DESBLOQUEO).onmessage = () => hilo.desbloquear('otra-pestana')
