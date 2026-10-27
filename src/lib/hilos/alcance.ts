/**
 * El `self` de un Web Worker, tipado sin mezclar las librerias "dom" y "webworker" de TypeScript
 * (chocan entre si) y sin aserciones `as`: se comprueba en tiempo de ejecucion.
 */
export type AlcanceWorker = {
  postMessage(mensaje: unknown, transferir: Transferable[]): void
  onmessage: ((evento: MessageEvent) => void) | null
}

function esAlcanceWorker(x: unknown): x is AlcanceWorker {
  return typeof x === 'object' && x !== null && 'importScripts' in x && 'postMessage' in x
}

export function alcanceWorker(): AlcanceWorker {
  const alcance: unknown = globalThis
  if (!esAlcanceWorker(alcance)) {
    throw new Error('Este modulo solo corre dentro de un Web Worker.')
  }
  return alcance
}
