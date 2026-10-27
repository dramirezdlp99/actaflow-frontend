import { CentralTiempoReal, ENTORNO_NAVEGADOR, type MensajeAlCentral, type Puerto } from '@/lib/hilos/tiempoReal'

/**
 * SHARED WORKER de tiempo real: un solo hilo para todas las pestanas de ActaFlow en este navegador.
 * Cada pestana se conecta por su MessagePort; la central (src/lib/hilos/tiempoReal.ts) mantiene una
 * conexion de red por audiencia y una consulta por borrador, y reparte lo que llega.
 */
type AlcanceCompartido = { onconnect: ((evento: MessageEvent) => void) | null }

function esCompartido(x: unknown): x is AlcanceCompartido {
  return typeof x === 'object' && x !== null && 'onconnect' in x
}

const alcance: unknown = globalThis
if (!esCompartido(alcance)) {
  throw new Error('Este modulo solo corre dentro de un Shared Worker.')
}
const central = new CentralTiempoReal(ENTORNO_NAVEGADOR)
setInterval(() => central.revisarSilencios(), 10_000)

alcance.onconnect = (evento: MessageEvent) => {
  const puerto = evento.ports[0]
  if (!puerto) return
  const destino: Puerto = { postMessage: (m) => puerto.postMessage(m) }
  puerto.onmessage = (m: MessageEvent<MensajeAlCentral>) => central.recibir(destino, m.data)
  puerto.start()
}
