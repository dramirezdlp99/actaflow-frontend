// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { abrirClaveContenido, abrirResultado, PROPOSITO, procesarComoMotor, sellar, TIPO } from '@/lib/audiencias/sellado'

const CASO = '0f8c3a52-5b8e-4d2c-9a51-2a7f0c1d9e11'
const RECURSO = '6a1f9d0e-3c42-4b7a-8e5d-1b2c3d4e5f60'

async function preparar() {
  const claveCaso = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
  const motor = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const publica = new Uint8Array(await crypto.subtle.exportKey('raw', motor.publicKey))
  const sobre = await sellar({
    claveCaso,
    idClaveCaso: 'caso:prueba:v1',
    motor: { idClave: 'motor:0123456789abcdef', publica },
    proposito: PROPOSITO.audio,
    casoId: CASO,
    recursoId: RECURSO,
    datos: new TextEncoder().encode('audio'),
    tipo: TIPO.audio,
  })
  return { claveCaso, motor, sobre }
}

describe('sellado para el motor', () => {
  it('el motor abre el sobre y el caso abre su resultado', async () => {
    const { claveCaso, motor, sobre } = await preparar()
    const resultado = await procesarComoMotor(motor.privateKey, sobre, { proposito: PROPOSITO.audio, tipo: TIPO.audio }, CASO, RECURSO, (d) =>
      new TextEncoder().encode(`oido: ${new TextDecoder().decode(d)}`),
    )
    const k = await abrirClaveContenido(claveCaso, sobre.contentKeyForCase!, CASO, RECURSO)
    const claro = await abrirResultado(k, resultado, PROPOSITO.transcripcion, CASO, RECURSO)
    expect(new TextDecoder().decode(claro)).toBe('oido: audio')
    expect(sobre.payload?.plaintextType).toBe(TIPO.audio)
    expect(sobre.processorKey?.recipientKeyId).toBe('motor:0123456789abcdef')
  })

  it('un sobre no se puede usar en otro caso ni en otro recurso', async () => {
    const { claveCaso, motor, sobre } = await preparar()
    const otroCaso = '9e8d7c6b-5a49-4382-a716-151413121110'
    await expect(
      procesarComoMotor(motor.privateKey, sobre, { proposito: PROPOSITO.audio, tipo: TIPO.audio }, otroCaso, RECURSO, (d) => d),
    ).rejects.toThrow()
    await expect(abrirClaveContenido(claveCaso, sobre.contentKeyForCase!, CASO, otroCaso)).rejects.toThrow()
    await expect(
      procesarComoMotor(motor.privateKey, sobre, { proposito: PROPOSITO.entrada, tipo: TIPO.audio }, CASO, RECURSO, (d) => d),
    ).rejects.toThrow()
  })

  it('otra clave de caso no abre la clave de contenido', async () => {
    const { sobre } = await preparar()
    const ajena = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    await expect(abrirClaveContenido(ajena, sobre.contentKeyForCase!, CASO, RECURSO)).rejects.toThrow()
  })
})
