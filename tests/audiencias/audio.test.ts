// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { codificarWav, FRECUENCIA, Remuestreador, Segmentador } from '@/lib/audiencias/audio'

const tono = (ms: number, amplitud = 0.3) =>
  Float32Array.from({ length: (FRECUENCIA * ms) / 1000 }, (_, i) => amplitud * Math.sin((2 * Math.PI * 200 * i) / FRECUENCIA))
const silencio = (ms: number) => new Float32Array((FRECUENCIA * ms) / 1000)

function unir(...partes: Float32Array[]): Float32Array {
  const total = new Float32Array(partes.reduce((n, p) => n + p.length, 0))
  let i = 0
  for (const p of partes) {
    total.set(p, i)
    i += p.length
  }
  return total
}

describe('segmentador de voz', () => {
  it('corta cada intervencion al quedar en silencio y conserva el inicio de la palabra', () => {
    const s = new Segmentador()
    const cortes = s.agregar(unir(silencio(1000), tono(2000), silencio(1200), tono(3000), silencio(1200)))
    expect(cortes.map((c) => Math.round(c.duracionMs / 100) * 100)).toEqual([3100, 4100])
    expect(s.cerrar()).toBeNull()
  })

  it('descarta lo que no tiene voz y los golpes muy cortos', () => {
    const s = new Segmentador()
    expect(s.agregar(unir(silencio(3000), tono(120), silencio(3000)))).toEqual([])
    expect(s.cerrar()).toBeNull()
  })

  it('nunca entrega mas de 28 s aunque la persona no pare', () => {
    const s = new Segmentador()
    const cortes = s.agregar(tono(35_000))
    expect(cortes).toHaveLength(1)
    expect(cortes[0]!.duracionMs).toBeLessThanOrEqual(28_000)
    const resto = s.cerrar()
    expect(resto?.duracionMs).toBeGreaterThan(6_000)
  })

  it('al detener entrega lo que se estaba diciendo', () => {
    const s = new Segmentador()
    expect(s.agregar(unir(silencio(500), tono(2500)))).toEqual([])
    expect(s.cerrar()?.duracionMs).toBeGreaterThan(2_500)
  })
})

describe('remuestreo y WAV', () => {
  it('pasa de 48 kHz a 16 kHz sin perder ni duplicar muestras entre bloques', () => {
    const r = new Remuestreador(48_000)
    let total = 0
    for (let i = 0; i < 100; i += 1) total += r.procesar(new Float32Array(4096).fill(0.5)).length
    expect(Math.abs(total - (4096 * 100) / 3)).toBeLessThanOrEqual(1)
  })

  it('escribe un WAV PCM16 mono de 16 kHz valido', () => {
    const wav = codificarWav(Float32Array.from([0, 1, -1, 0.5]))
    const v = new DataView(wav.buffer)
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE')
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(24, true)).toBe(16_000)
    expect(v.getUint32(40, true)).toBe(8)
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)]).toEqual([0, 32767, -32768])
    expect(wav.length).toBe(52)
  })
})
