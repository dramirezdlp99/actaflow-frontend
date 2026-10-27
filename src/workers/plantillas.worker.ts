import { alcanceWorker } from '@/lib/hilos/alcance'
import { ProcesadorPlantillas, type PedidoPlantilla } from '@/lib/hilos/hiloPlantillas'

/** Web Worker del acta: analiza la plantilla y la llena con los valores, fuera del hilo principal. */
const alcance = alcanceWorker()
const procesador = new ProcesadorPlantillas()
alcance.onmessage = (evento: MessageEvent<PedidoPlantilla>) =>
  alcance.postMessage(procesador.responder(evento.data), [])
