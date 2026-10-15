import { describe, expect, it } from 'vitest'
import { ConfiguracionInvalidaError, leerConfiguracion } from '@/lib/rpc/configuracion'
import { OTRO_SECRETO, SECRETO_PRUEBA } from '../soporte/datos'

const COMPLETA = {
  ACTAFLOW_IDENTITY_URL: 'https://identity.prueba/',
  ACTAFLOW_IDENTITY_HMAC_SECRET: SECRETO_PRUEBA,
  ACTAFLOW_LEGAL_CASE_URL: 'https://legal-case.prueba',
  ACTAFLOW_LEGAL_CASE_HMAC_SECRET: OTRO_SECRETO,
}

function falla(entorno: Record<string, string | undefined>, fragmento: string) {
  expect(() => leerConfiguracion(entorno)).toThrow(ConfiguracionInvalidaError)
  expect(() => leerConfiguracion(entorno)).toThrow(fragmento)
}

describe('leerConfiguracion (Zod: se parsea, no se asume)', () => {
  it('por defecto es en vivo, por gRPC-Web, con URLs normalizadas', () => {
    expect(leerConfiguracion(COMPLETA)).toEqual({
      modo: 'live',
      transporte: 'grpc-web',
      identidad: { url: 'https://identity.prueba', secreto: SECRETO_PRUEBA },
      expedientes: { url: 'https://legal-case.prueba', secreto: OTRO_SECRETO },
      esperaMaxMs: 120_000,
    })
  })

  it('acepta gRPC nativo y una espera propia', () => {
    const config = leerConfiguracion({ ...COMPLETA, ACTAFLOW_RPC_TRANSPORT: 'grpc', ACTAFLOW_BACKEND_WAIT_MS: '5000' })
    expect(config).toMatchObject({ transporte: 'grpc', esperaMaxMs: 5000 })
  })

  it('en modo mock no exige URLs ni secretos', () => {
    expect(leerConfiguracion({ ACTAFLOW_RPC_MODE: 'mock' })).toEqual({ modo: 'mock', esperaMaxMs: 120_000 })
  })

  it('explica que variable falta o esta mal', () => {
    falla({ ...COMPLETA, ACTAFLOW_IDENTITY_URL: '' }, 'ACTAFLOW_IDENTITY_URL')
    falla({ ...COMPLETA, ACTAFLOW_LEGAL_CASE_URL: 'ftp://x.prueba' }, 'ACTAFLOW_LEGAL_CASE_URL')
    falla({ ...COMPLETA, ACTAFLOW_IDENTITY_HMAC_SECRET: 'corto' }, 'ACTAFLOW_IDENTITY_HMAC_SECRET')
    falla({ ...COMPLETA, ACTAFLOW_RPC_TRANSPORT: 'rest' }, 'grpc')
    falla({ ...COMPLETA, ACTAFLOW_BACKEND_WAIT_MS: '999999' }, 'ACTAFLOW_BACKEND_WAIT_MS')
    falla({ ...COMPLETA, ACTAFLOW_RPC_MODE: 'quizas' }, 'ACTAFLOW_RPC_MODE')
  })

  it('exige un secreto distinto por par de servicios', () => {
    falla({ ...COMPLETA, ACTAFLOW_LEGAL_CASE_HMAC_SECRET: SECRETO_PRUEBA }, 'deben ser distintos')
  })
})
