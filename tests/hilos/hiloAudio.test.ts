// @vitest-environment node
import { fromBinary } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import { SealedAudioSegmentSchema } from '@/gen/actaflow/engine/v1/engine_pb'
import { SubmitAudioSegmentRequestSchema } from '@/gen/actaflow/hearings/v1/hearing_pb'
import { PROPOSITO, procesarComoMotor, TIPO } from '@/lib/audiencias/sellado'
import { AnilloAudio } from '@/lib/hilos/anillo'
import { HiloAudio, type MensajeDelHilo } from '@/lib/hilos/hiloAudio'

const CASO = '11111111-1111-4111-8111-111111111111'
const AUDIENCIA = '22222222-2222-4222-8222-222222222222'
const ANA = '33333333-3333-4333-8333-333333333333'
const BRUNO = '44444444-4444-4444-8444-444444444444'
const FRECUENCIA = 48_000

const tono = (ms: number) =>
  Float32Array.from({ length: (FRECUENCIA * ms) / 1000 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / FRECUENCIA))
const silencio = (ms: number) => new Float32Array((FRECUENCIA * ms) / 1000)

describe('anillo de memoria compartida (SharedArrayBuffer + Atomics)', () => {
  it('entrega en orden lo escrito, aunque de la vuelta', () => {
    const a = AnilloAudio.crear(8)
    a.escribir(Float32Array.from([1, 2, 3, 4, 5]))
    expect([...a.leer()]).toEqual([1, 2, 3, 4, 5])
    a.escribir(Float32Array.from([6, 7, 8, 9, 10, 11]))
    expect([...a.leer()]).toEqual([6, 7, 8, 9, 10, 11])
    expect(a.leer()).toHaveLength(0)
  })

  it('si el lector se atrasa, cuenta lo perdido en vez de pisar lo no leido', () => {
    const a = AnilloAudio.crear(4)
    expect(a.escribir(Float32Array.from([1, 2, 3, 4, 5, 6]))).toBe(3)
    expect(a.perdidas).toBe(3)
    expect([...a.leer()]).toEqual([1, 2, 3])
  })

  it('cualquier hilo puede pedir que se detenga (la bandera vive en la memoria compartida)', () => {
    const a = AnilloAudio.crear(4)
    const otraVista = new AnilloAudio(a.memoria)
    otraVista.detener()
    expect(a.detenido).toBe(true)
  })
})

describe('hilo de audio (lo que corre dentro del Web Worker)', () => {
  it('lee del anillo, corta, sella para el motor y cambia de hablante sin pasar por el hilo principal', async () => {
    const claveCaso = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const motor = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
    const publica = new Uint8Array(await crypto.subtle.exportKey('raw', motor.publicKey))
    const mensajes: MensajeDelHilo[] = []
    const fin = new Promise<void>((listo) => {
      const hilo = new HiloAudio((m) => {
        mensajes.push(m)
        if (m.tipo === 'fin') listo()
      })
      const anillo = AnilloAudio.crear(FRECUENCIA * 10)
      hilo.recibir({
        tipo: 'iniciar',
        frecuencia: FRECUENCIA,
        modo: 'anillo',
        memoria: anillo.memoria,
        contexto: { claveCaso, idClaveCaso: 'caso:1', casoId: CASO },
        motor: { idClave: 'motor:1', publica },
        audienciaId: AUDIENCIA,
        nombres: ['Ana', 'Bruno'],
        hablante: ANA,
      })
      // Esto lo haria el AudioWorklet desde el hilo de audio.
      anillo.escribir(tono(2000))
      anillo.escribir(silencio(1200))
      hilo.agregar(anillo.leer())
      hilo.recibir({ tipo: 'hablante', id: BRUNO })
      anillo.escribir(tono(1800))
      hilo.recibir({ tipo: 'detener' })
    })
    await fin

    expect(mensajes[0]).toEqual({ tipo: 'listo', modo: 'anillo' })
    // Si algo falla al sellar, que la prueba diga que fue y no solo 'no hubo segmentos'.
    expect(mensajes.filter((m) => m.tipo === 'error')).toEqual([])
    const segmentos = mensajes.flatMap((m) => (m.tipo === 'segmento' ? [m] : []))
    expect(segmentos.map((s) => s.hablante)).toEqual([ANA, BRUNO])
    for (const s of segmentos) {
      const peticion = fromBinary(SubmitAudioSegmentRequestSchema, s.peticion)
      expect(peticion.hearingId).toBe(AUDIENCIA)
      // El motor (y solo el motor) abre el audio sellado.
      let abierto: Uint8Array = new Uint8Array()
      await procesarComoMotor(motor.privateKey, peticion.audio!, { proposito: PROPOSITO.audio, tipo: TIPO.audio }, CASO, peticion.segmentId, (d) => {
        abierto = d
        return new Uint8Array()
      })
      const audio = fromBinary(SealedAudioSegmentSchema, abierto)
      expect(audio.speakerParticipantId).toBe(s.hablante)
      expect(new TextDecoder().decode(audio.audio.slice(0, 4))).toBe('RIFF')
    }
    expect(mensajes.at(-1)).toEqual({ tipo: 'fin', perdidas: 0 })
  })
})
