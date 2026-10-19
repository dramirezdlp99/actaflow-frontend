// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { aBase32, aBase64Url, buffer, desdeBase32, desdeBase64Url } from '@/lib/cripto/bytes'
import {
  abrirConContrasena,
  abrirConRecuperacion,
  crearKit,
  derivarClaves,
  ITERACIONES_KDF,
  revisarContrasena,
} from '@/lib/cripto/claves'
import { abrirKit, prepararIngreso, prepararRegistro, textoKitRecuperacion } from '@/lib/cuenta/navegador'
import { esquemaRegistro } from '@/lib/sesion/esquemas'

const SAL = new Uint8Array(16).fill(7)
// Pocas iteraciones solo donde se prueba la logica; el registro real usa 600 000 (se prueba abajo).
const RAPIDO = 1_000

describe('bytes', () => {
  it('base64url ida y vuelta, sin relleno', () => {
    const bytes = Uint8Array.from({ length: 33 }, (_, i) => i * 7)
    const texto = aBase64Url(bytes)
    expect(texto).not.toMatch(/[+/=]/)
    expect(desdeBase64Url(texto)).toEqual(bytes)
  })

  it('rechaza base64url invalido en lugar de devolver basura', () => {
    expect(() => desdeBase64Url('no valido!')).toThrow()
    expect(() => desdeBase64Url('a')).toThrow()
  })

  it('base32 RFC 4648 ignorando guiones, espacios y minusculas', () => {
    const rfc = new TextEncoder().encode('12345678901234567890')
    expect(aBase32(rfc)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
    expect(desdeBase32('gezd-gnbv gy3t qojq-GEZDGNBVGY3TQOJQ')).toEqual(rfc)
    expect(() => desdeBase32('1111')).toThrow()
  })
})

describe('claves del navegador', () => {
  it('la misma contrasena y sal dan el mismo verificador; otra contrasena, otro', async () => {
    const a = await derivarClaves('una frase bastante larga', SAL, RAPIDO)
    const b = await derivarClaves('una frase bastante larga', SAL, RAPIDO)
    const c = await derivarClaves('otra frase bastante larga', SAL, RAPIDO)
    expect(a.verificador).toHaveLength(32)
    expect(a.verificador).toEqual(b.verificador)
    expect(a.verificador).not.toEqual(c.verificador)
  })

  it('normaliza la contrasena (NFC): la misma frase escrita con otro teclado entra igual', async () => {
    const compuesta = await derivarClaves('contraseña-larga-1', SAL, RAPIDO)
    const descompuesta = await derivarClaves('contraseña-larga-1', SAL, RAPIDO)
    expect(compuesta.verificador).toEqual(descompuesta.verificador)
  })

  it('la clave que cifra la privada no se puede exportar', async () => {
    const { kek } = await derivarClaves('una frase bastante larga', SAL, RAPIDO)
    expect(kek.extractable).toBe(false)
  })

  it('el kit se abre con la contrasena y con la clave de recuperacion, no con otra contrasena', async () => {
    const { kek } = await derivarClaves('una frase bastante larga', SAL, RAPIDO)
    const kit = await crearKit(kek)
    expect(kit.clavePublica).toHaveLength(65)
    expect(kit.clavePublica[0]).toBe(0x04)
    expect(kit.huella).toMatch(/^[0-9a-f]{64}$/)
    expect(kit.claveRecuperacion).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/)

    const privada = await abrirConContrasena(kek, kit.porContrasena)
    expect(privada.type).toBe('private')
    expect(privada.extractable).toBe(false)
    expect((await abrirConRecuperacion(kit.claveRecuperacion, kit.porRecuperacion)).type).toBe('private')

    const otra = await derivarClaves('otra frase bastante larga', SAL, RAPIDO)
    await expect(abrirConContrasena(otra.kek, kit.porContrasena)).rejects.toThrow()
    // Un blob no se puede pasar por el otro: el id de la clave va autenticado.
    await expect(abrirConContrasena(kek, { ...kit.porContrasena, idClave: 'kek:recuperacion:v1' })).rejects.toThrow()
  })

  it('la clave abierta sirve para ECDH con la publica de otra cuenta', async () => {
    const { kek } = await derivarClaves('una frase bastante larga', SAL, RAPIDO)
    const kit = await crearKit(kek)
    const otra = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    const privada = await abrirConContrasena(kek, kit.porContrasena)
    const publicaMia = await crypto.subtle.importKey(
      'raw',
      buffer(kit.clavePublica),
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      [],
    )
    const desdeAqui = await crypto.subtle.deriveBits({ name: 'ECDH', public: otra.publicKey }, privada, 256)
    const desdeAlla = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicaMia }, otra.privateKey, 256)
    expect(new Uint8Array(desdeAqui)).toEqual(new Uint8Array(desdeAlla))
  })

  it('revisa la contrasena antes de derivar nada', () => {
    expect(revisarContrasena('corta', 'corta')).toBe('corta')
    expect(revisarContrasena('x'.repeat(129), 'x'.repeat(129))).toBe('larga')
    expect(revisarContrasena('una frase larga', 'una frase largA')).toBe('distintas')
    expect(revisarContrasena('una frase larga', 'una frase larga')).toBeNull()
  })
})

describe('flujo del navegador', () => {
  it('el registro preparado cumple el contrato (600 000 iteraciones) y el ingreso abre su kit', async () => {
    const preparado = await prepararRegistro({
      invitacion: 'i'.repeat(48),
      correo: 'Ana@Prueba.test',
      nombre: 'Ana',
      contrasena: 'una frase bastante larga',
      idempotencia: crypto.randomUUID(),
    })
    expect(preparado.datos.iteraciones).toBe(ITERACIONES_KDF)
    expect(esquemaRegistro.safeParse(preparado.datos).success).toBe(true)

    const ingreso = await prepararIngreso('una frase bastante larga', {
      sal: preparado.datos.sal,
      iteraciones: preparado.datos.iteraciones,
    })
    expect(ingreso.verificador).toBe(preparado.datos.verificador)
    const privada = await abrirKit(ingreso.claves, preparado.datos.porContrasena)
    expect(privada.type).toBe('private')
  }, 30_000)

  it('el kit de recuperacion descargable trae clave, 10 codigos y huella', () => {
    const texto = textoKitRecuperacion({
      correo: 'ana@prueba.test',
      claveRecuperacion: 'AAAA-BBBB',
      codigos: Array.from({ length: 10 }, (_, i) => `CODIG-${String(i).padStart(5, '0')}`),
      huella: 'f'.repeat(64),
      fecha: new Date('2026-10-19T12:00:00Z'),
    })
    expect(texto).toContain('AAAA-BBBB')
    expect(texto).toContain('10. CODIG-00009')
    expect(texto).toContain('2026-10-19')
    expect(texto).toContain('f'.repeat(64))
  })
})
