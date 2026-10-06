import { describe, expect, it } from 'vitest'
import { CABECERA_FIRMA, CABECERA_TIMESTAMP, cabecerasFirmadas, firmar, mensajeCanonico } from '@/lib/bff/firma'
import { SECRETO_PRUEBA } from '../soporte/datos'

const TS = '1760000000'
const texto = (s: string) => new TextEncoder().encode(s)

describe('firma HMAC del BFF', () => {
  it.each([
    ['GET', '/api/v1/status', '', 'fcd686a749c71724bde4a22b49a4f0efb6804679c254cb1666ddbf112c023f49'],
    [
      'POST',
      '/v1/diagnostico/benchmark',
      '{"modelos":["tiny"]}',
      '79b879931374cba8459f058a45e64a75ca976a02f3c9d5fa1fc2764db1e5e7dc',
    ],
    ['GET', '/health', '', '4db3ff880b724cc566f52626e2f1315b187eae83d8ef69b271079ad3df3eee7c'],
  ])('coincide con el vector compartido %s %s', (metodo, ruta, cuerpo, esperada) => {
    expect(firmar(SECRETO_PRUEBA, TS, metodo, ruta, texto(cuerpo))).toBe(esperada)
  })

  it('normaliza el metodo a mayusculas e incluye el hash del cuerpo', () => {
    expect(mensajeCanonico(TS, 'get', '/x', new Uint8Array())).toBe(
      `${TS}\nGET\n/x\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`,
    )
  })

  it('cambiar un solo byte del cuerpo cambia la firma', () => {
    expect(firmar(SECRETO_PRUEBA, TS, 'POST', '/r', texto('{"a":1}'))).not.toBe(
      firmar(SECRETO_PRUEBA, TS, 'POST', '/r', texto('{"a":2}')),
    )
  })

  it('genera cabeceras con el timestamp en segundos', () => {
    const cabeceras = cabecerasFirmadas(SECRETO_PRUEBA, 'GET', '/api/v1/status', new Uint8Array(), 1_760_000_000_999)
    expect(cabeceras[CABECERA_TIMESTAMP]).toBe(TS)
    expect(cabeceras[CABECERA_FIRMA]).toBe('fcd686a749c71724bde4a22b49a4f0efb6804679c254cb1666ddbf112c023f49')
  })
})
