import type { TemplateValue, TemplateVariable } from '@/gen/actaflow/templates/v1/template_pb'
import { sanearHtml } from '@/lib/plantillas/saneo'
import { analizar, html, type Analisis } from '@/lib/rpc/lenguajeSimulado'

/**
 * El llenado del acta en un Web Worker (src/workers/plantillas.worker.ts): analizar la plantilla y
 * volcar en ella lo que la IA extrajo y una persona reviso. Con cada tecla del formulario se arma el
 * acta otra vez; en un hilo aparte la escritura nunca espera al armado.
 *
 * El protocolo es pedido/respuesta con un id, como una llamada remota (RPC) entre hilos.
 */

export type PedidoPlantilla =
  | { id: number; tipo: 'analizar'; fuente: string }
  | { id: number; tipo: 'armar'; fuente: string; valores: Record<string, TemplateValue> }

export type RespuestaPlantilla =
  | { id: number; tipo: 'analizar'; variables: TemplateVariable[]; errores: number }
  | { id: number; tipo: 'armar'; html: string; faltan: number }
  | { id: number; tipo: 'fallo'; mensaje: string }

/** La logica del hilo, sin Worker (se prueba en Node y sirve de respaldo si no hay Workers). */
export class ProcesadorPlantillas {
  /** La plantilla del acta no cambia mientras se llena: se analiza una vez. */
  private cache: { fuente: string; analisis: Analisis } | null = null

  private analisis(fuente: string): Analisis {
    if (this.cache?.fuente !== fuente) {
      this.cache = { fuente, analisis: analizar(fuente) }
    }
    return this.cache.analisis
  }

  responder(p: PedidoPlantilla): RespuestaPlantilla {
    try {
      const a = this.analisis(p.fuente)
      if (p.tipo === 'analizar') {
        return { id: p.id, tipo: 'analizar', variables: a.variables, errores: a.diagnosticos.length }
      }
      const salida = sanearHtml(html(a.nodos, p.valores))
      return { id: p.id, tipo: 'armar', html: salida, faltan: (salida.match(/class="falta"/g) ?? []).length }
    } catch (e) {
      return { id: p.id, tipo: 'fallo', mensaje: e instanceof Error ? e.message : 'No se pudo armar el acta.' }
    }
  }
}

type SinId<T> = T extends { id: number } ? Omit<T, 'id'> : never

/**
 * Lado del hilo principal: manda pedidos y resuelve cada promesa cuando llega su respuesta. Si el
 * navegador no tiene Workers (o en las pruebas con jsdom), atiende en el mismo hilo.
 */
export class ClientePlantillas {
  private siguiente = 1
  private readonly esperando = new Map<number, (r: RespuestaPlantilla) => void>()
  private readonly local = new ProcesadorPlantillas()
  private hilo: Worker | null = null

  /** `crear` arma el Worker la primera vez que hace falta (y otra vez despues de `cerrar`). */
  constructor(private readonly crear: (() => Worker) | null) {}

  get enOtroHilo(): boolean {
    return this.crear !== null
  }

  private worker(): Worker | null {
    if (!this.hilo && this.crear) {
      const hilo = this.crear()
      hilo.onmessage = (e: MessageEvent<RespuestaPlantilla>) => {
        this.esperando.get(e.data.id)?.(e.data)
        this.esperando.delete(e.data.id)
      }
      this.hilo = hilo
    }
    return this.hilo
  }

  pedir(pedido: SinId<PedidoPlantilla>): Promise<RespuestaPlantilla> {
    const completo: PedidoPlantilla = { ...pedido, id: this.siguiente++ }
    const hilo = this.worker()
    if (!hilo) {
      return Promise.resolve(this.local.responder(completo))
    }
    return new Promise((resolver) => {
      this.esperando.set(completo.id, resolver)
      hilo.postMessage(completo)
    })
  }

  /** Termina el Worker (las respuestas pendientes ya no llegan: quien las espera se desmonto). */
  cerrar(): void {
    this.hilo?.terminate()
    this.hilo = null
    this.esperando.clear()
  }
}
