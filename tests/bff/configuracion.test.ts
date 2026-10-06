import { describe, expect, it } from 'vitest'
import { ConfiguracionInvalidaError, leerConfiguracion } from '@/lib/bff/configuracion'
import { SECRETO_PRUEBA } from '../soporte/datos'

const base = { ACTAFLOW_BACKEND_URL: 'https://actaflow-backend.onrender.com', ACTAFLOW_BFF_HMAC_SECRET: SECRETO_PRUEBA }

describe('configuracion del BFF', () => {
  it('lee la configuracion valida con la espera por defecto de 2 minutos', () => {
    expect(leerConfiguracion(base)).toEqual({
      urlBackend: 'https://actaflow-backend.onrender.com',
      secretoHmac: SECRETO_PRUEBA,
      esperaMaxMs: 120_000,
    })
  })

  it('quita las barras finales de la URL', () => {
    expect(leerConfiguracion({ ...base, ACTAFLOW_BACKEND_URL: 'http://localhost:9097///' }).urlBackend).toBe(
      'http://localhost:9097',
    )
  })

  it.each([
    [{ ...base, ACTAFLOW_BACKEND_URL: undefined }, 'Falta ACTAFLOW_BACKEND_URL'],
    [{ ...base, ACTAFLOW_BACKEND_URL: 'no es url' }, 'no es una URL valida'],
    [{ ...base, ACTAFLOW_BACKEND_URL: 'ftp://servidor' }, 'http o https'],
    [{ ...base, ACTAFLOW_BFF_HMAC_SECRET: 'corto' }, 'al menos 32'],
    [{ ...base, ACTAFLOW_BACKEND_WAIT_MS: '500' }, 'ACTAFLOW_BACKEND_WAIT_MS'],
    [{ ...base, ACTAFLOW_BACKEND_WAIT_MS: '300000' }, 'ACTAFLOW_BACKEND_WAIT_MS'],
    [{ ...base, ACTAFLOW_BACKEND_WAIT_MS: 'abc' }, 'ACTAFLOW_BACKEND_WAIT_MS'],
  ])('rechaza configuraciones invalidas (%#)', (entorno, mensaje) => {
    expect(() => leerConfiguracion(entorno)).toThrow(ConfiguracionInvalidaError)
    expect(() => leerConfiguracion(entorno)).toThrow(mensaje)
  })
})
