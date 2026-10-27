import { toBinary } from '@bufbuild/protobuf'
import { SubmitAudioSegmentRequestSchema } from '@/gen/actaflow/hearings/v1/hearing_pb'
import { codificarWav, Remuestreador, Segmentador, type Intervencion } from '@/lib/audiencias/audio'
import { prepararSegmento, type Contexto } from '@/lib/audiencias/navegador'
import type { ClaveMotor } from '@/lib/audiencias/sellado'
import { AnilloAudio } from './anillo'

/**
 * Lo que hace el Web Worker de la sala (src/workers/audio.worker.ts), separado aqui para probarlo en
 * Node sin un Worker real. Todo el trabajo pesado del audio ocurre en este hilo:
 *
 *   muestras ──Remuestreador──► 16 kHz ──Segmentador──► intervencion ──WAV──► sellar (WebCrypto) ──► bytes
 *
 * El hilo principal solo recibe el nivel del microfono (para la barrita) y la peticion ya sellada,
 * lista para enviar. Ni el audio crudo ni el WAV en claro cruzan al hilo principal.
 */

export type Sellado = {
  contexto: Contexto
  motor: ClaveMotor
  audienciaId: string
  nombres: string[]
  hablante: string
}

export type MensajeAlHilo =
  | ({ tipo: 'iniciar'; frecuencia: number } & Sellado &
      ({ modo: 'anillo'; memoria: SharedArrayBuffer } | { modo: 'mensajes'; puerto: MessagePort }))
  | { tipo: 'hablante'; id: string }
  | { tipo: 'detener' }

export type MensajeDelHilo =
  | { tipo: 'listo'; modo: 'anillo' | 'mensajes' }
  | { tipo: 'nivel'; valor: number }
  | { tipo: 'segmento'; peticion: Uint8Array; duracionMs: number; hablante: string }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'fin'; perdidas: number }

/** Cada cuanto el Worker vacia el anillo (el worklet escribe 128 muestras cada ~2,7 ms). */
export const INTERVALO_LECTURA_MS = 25

export class HiloAudio {
  private sellado: Sellado | null = null
  private remuestreador: Remuestreador | null = null
  private segmentador = new Segmentador()
  private anillo: AnilloAudio | null = null
  private temporizador: ReturnType<typeof setInterval> | null = null
  private ultimoNivel = 0
  /** Sella en orden: cada intervencion espera a la anterior. */
  private cola: Promise<void> = Promise.resolve()

  constructor(
    private readonly publicar: (m: MensajeDelHilo, transferir?: Transferable[]) => void,
    private readonly ahora: () => number = () => performance.now(),
  ) {}

  recibir(m: MensajeAlHilo): void {
    switch (m.tipo) {
      case 'iniciar': {
        const { frecuencia, contexto, motor, audienciaId, nombres, hablante } = m
        this.sellado = { contexto, motor, audienciaId, nombres, hablante }
        this.remuestreador = new Remuestreador(frecuencia)
        this.segmentador = new Segmentador()
        if (m.modo === 'anillo') {
          this.anillo = new AnilloAudio(m.memoria)
          this.temporizador = setInterval(() => this.vaciarAnillo(), INTERVALO_LECTURA_MS)
        } else {
          m.puerto.onmessage = (e: MessageEvent<Float32Array>) => this.agregar(e.data)
        }
        this.publicar({ tipo: 'listo', modo: m.modo })
        return
      }
      case 'hablante':
        if (this.sellado) this.sellado.hablante = m.id
        return
      case 'detener':
        void this.detener()
        return
    }
  }

  /** Muestras crudas del microfono (de cualquiera de los dos caminos). */
  agregar(crudas: Float32Array): void {
    if (!this.remuestreador || crudas.length === 0) return
    for (const intervencion of this.segmentador.agregar(this.remuestreador.procesar(crudas))) {
      this.encolar(intervencion)
    }
    const t = this.ahora()
    if (t - this.ultimoNivel > 120) {
      this.ultimoNivel = t
      this.publicar({ tipo: 'nivel', valor: this.segmentador.nivel })
    }
  }

  private vaciarAnillo(): void {
    if (this.anillo) this.agregar(this.anillo.leer())
  }

  private encolar(intervencion: Intervencion): void {
    const s = this.sellado
    if (!s) return
    const hablante = s.hablante
    this.cola = this.cola.then(async () => {
      try {
        const peticion = await prepararSegmento({
          ...s.contexto,
          motor: s.motor,
          audienciaId: s.audienciaId,
          // El numero de orden lo pone el hilo principal al enviar (depende de lo que ya hay en el servidor).
          secuencia: 0,
          hablanteId: hablante,
          wav: codificarWav(intervencion.muestras),
          duracionMs: intervencion.duracionMs,
          nombres: s.nombres,
        })
        const bytes = toBinary(SubmitAudioSegmentRequestSchema, peticion)
        this.publicar({ tipo: 'segmento', peticion: bytes, duracionMs: intervencion.duracionMs, hablante }, [
          bytes.buffer,
        ])
      } catch (e) {
        this.publicar({ tipo: 'error', mensaje: e instanceof Error ? e.message : 'No se pudo sellar el audio.' })
      }
    })
  }

  /** Vacia lo que quede, entrega la ultima intervencion y avisa cuando todo quedo sellado. */
  async detener(): Promise<void> {
    if (this.temporizador) clearInterval(this.temporizador)
    this.temporizador = null
    this.vaciarAnillo()
    this.anillo?.detener()
    const ultima = this.segmentador.cerrar()
    if (ultima) this.encolar(ultima)
    await this.cola
    this.publicar({ tipo: 'fin', perdidas: this.anillo?.perdidas ?? 0 })
    this.remuestreador = null
  }
}
