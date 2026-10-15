import { create, toBinary } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import { ModelSize, RunBenchmarkRequestSchema } from '@/gen/actaflow/engine/v1/engine_pb'
import { firmar, mensajeCanonico } from '@/lib/rpc/firma'
import { SECRETO_PRUEBA } from '../soporte/datos'

const TS = '1760000000'
const VACIO = new Uint8Array()

describe('firma HMAC de las llamadas gRPC', () => {
  it('serializa el benchmark igual que Java y Python', () => {
    const peticion = create(RunBenchmarkRequestSchema, { models: [ModelSize.TINY] })
    expect(Buffer.from(toBinary(RunBenchmarkRequestSchema, peticion)).toString('hex')).toBe('0a0101')
  })

  it('coincide con los vectores compartidos por los tres repos', () => {
    expect(firmar(SECRETO_PRUEBA, TS, '/actaflow.system.v1.ServiceStatusService/GetServiceStatus', VACIO)).toBe(
      '2464942d647557cdabd41b2f6cdc7dcb23a204184913160c1e5df4d7c284778d',
    )
    expect(
      firmar(SECRETO_PRUEBA, TS, '/actaflow.engine.v1.EngineDiagnosticsService/RunBenchmark', Buffer.from('0a0101', 'hex')),
    ).toBe('a58c8e638550007e92cb44c0e022ebe86c6fd260c7a310750a3080af78866cd3')
    expect(firmar(SECRETO_PRUEBA, TS, '/actaflow.engine.v1.TranscriptionService/StreamTranscription', VACIO)).toBe(
      '4c49b46fc8ed57ee5358b19be415110fbc39e3c74493f9ccf522de2401bf86e0',
    )
  })

  it('el mensaje canonico lleva la ruta con barra inicial, la ponga o no quien llama', () => {
    const esperado =
      `${TS}\nRPC\n/actaflow.system.v1.ServiceStatusService/GetServiceStatus\n` +
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    expect(mensajeCanonico(TS, 'actaflow.system.v1.ServiceStatusService/GetServiceStatus', VACIO)).toBe(esperado)
    expect(mensajeCanonico(TS, '/actaflow.system.v1.ServiceStatusService/GetServiceStatus', VACIO)).toBe(esperado)
  })
})
