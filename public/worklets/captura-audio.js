/*
 * ActaFlow · AudioWorklet de captura (hilo de AUDIO del navegador, no el principal).
 *
 * Recibe bloques de 128 muestras del microfono y los entrega al Web Worker que procesa y sella:
 *  - modo "anillo": los escribe en memoria compartida (SharedArrayBuffer + Atomics). Requiere que la
 *    pagina este en crossOriginIsolated (COOP + COEP). Cero copias y cero mensajes.
 *  - modo "mensajes": si no hay aislamiento, junta 2048 muestras y las TRANSFIERE (postMessage con
 *    transferencia) por un MessagePort conectado directo al Worker.
 * En ningun caso el audio pasa por el hilo principal de la pagina.
 *
 * La distribucion del anillo es la de src/lib/hilos/anillo.ts: Int32Array(4) [ESCRITURA, LECTURA,
 * PERDIDAS, DETENER] y despues Float32Array(capacidad).
 */
const CONTROL = 4
const ESCRITURA = 0
const LECTURA = 1
const PERDIDAS = 2
const DETENER = 3
const LOTE = 2048

class CapturaAudio extends AudioWorkletProcessor {
  constructor() {
    super()
    this.control = null
    this.datos = null
    this.capacidad = 0
    this.puerto = null
    this.lote = new Float32Array(LOTE)
    this.llenas = 0
    this.vivo = true
    this.port.onmessage = (evento) => {
      const m = evento.data
      if (m.tipo === 'anillo') {
        this.capacidad = (m.memoria.byteLength - CONTROL * 4) / 4
        this.control = new Int32Array(m.memoria, 0, CONTROL)
        this.datos = new Float32Array(m.memoria, CONTROL * 4, this.capacidad)
      } else if (m.tipo === 'mensajes') {
        this.puerto = m.puerto
      } else if (m.tipo === 'detener') {
        this.enviarLote()
        this.vivo = false
      }
    }
  }

  escribirAnillo(muestras) {
    const w = Atomics.load(this.control, ESCRITURA)
    const r = Atomics.load(this.control, LECTURA)
    const libres = (r - w - 1 + this.capacidad) % this.capacidad
    const n = Math.min(libres, muestras.length)
    for (let i = 0; i < n; i += 1) {
      this.datos[(w + i) % this.capacidad] = muestras[i]
    }
    if (n < muestras.length) {
      Atomics.add(this.control, PERDIDAS, muestras.length - n)
    }
    Atomics.store(this.control, ESCRITURA, (w + n) % this.capacidad)
  }

  enviarLote() {
    if (!this.puerto || this.llenas === 0) {
      return
    }
    const listo = this.lote.slice(0, this.llenas)
    this.puerto.postMessage(listo, [listo.buffer])
    this.llenas = 0
  }

  process(entradas) {
    if (!this.vivo || (this.control && Atomics.load(this.control, DETENER) === 1)) {
      return false
    }
    const canal = entradas[0] && entradas[0][0]
    if (!canal) {
      return true
    }
    if (this.control) {
      this.escribirAnillo(canal)
    } else if (this.puerto) {
      for (let i = 0; i < canal.length; i += 1) {
        this.lote[this.llenas] = canal[i]
        this.llenas += 1
        if (this.llenas === LOTE) {
          this.enviarLote()
        }
      }
    }
    return true
  }
}

registerProcessor('captura-audio', CapturaAudio)
