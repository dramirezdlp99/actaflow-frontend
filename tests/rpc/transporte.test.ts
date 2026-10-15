// @vitest-environment node
import * as http from 'node:http'
import * as http2 from 'node:http2'
import type { AddressInfo } from 'node:net'
import { create, toBinary, type DescMessage, type MessageShape } from '@bufbuild/protobuf'
import { Code, ConnectError, createClient, type ConnectRouter, type HandlerContext } from '@connectrpc/connect'
import { connectNodeAdapter } from '@connectrpc/connect-node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JobSchema, JobService, JobState, WatchJobRequestSchema } from '@/gen/actaflow/jobs/v1/job_pb'
import {
  GetServiceStatusRequestSchema,
  ServiceStatusSchema,
  ServiceStatusService,
  Transport,
} from '@/gen/actaflow/system/v1/service_status_pb'
import { crearTransporte } from '@/lib/rpc/clientes'
import { firmar, METADATO_FIRMA, METADATO_TIMESTAMP } from '@/lib/rpc/firma'
import { OTRO_SECRETO, SECRETO_PRUEBA } from '../soporte/datos'

/**
 * Servidores reales (gRPC sobre HTTP/2 y gRPC-Web sobre HTTP/1.1) que verifican la firma igual que
 * los servicios Java y el motor Python: sobre los bytes protobuf exactos de la peticion.
 */
function verificar<D extends DescMessage>(esquema: D, mensaje: MessageShape<D>, contexto: HandlerContext): void {
  const ts = contexto.requestHeader.get(METADATO_TIMESTAMP) ?? ''
  const recibida = contexto.requestHeader.get(METADATO_FIRMA) ?? ''
  const procedimiento = `/${contexto.service.typeName}/${contexto.method.name}`
  const esperada = firmar(SECRETO_PRUEBA, ts, procedimiento, toBinary(esquema, mensaje))
  if (recibida !== esperada || Math.abs(Date.now() / 1000 - Number(ts)) > 300) {
    throw new ConnectError('Llamada no autorizada', Code.Unauthenticated)
  }
}

function rutas(router: ConnectRouter) {
  router.service(ServiceStatusService, {
    getServiceStatus(peticion, contexto) {
      verificar(GetServiceStatusRequestSchema, peticion, contexto)
      return {
        status: create(ServiceStatusSchema, {
          serviceName: 'servicio-falso',
          servedVia: contexto.protocolName === 'grpc-web' ? Transport.GRPC_WEB : Transport.GRPC,
        }),
      }
    },
  })
  router.service(JobService, {
    async *watchJob(peticion, contexto) {
      verificar(WatchJobRequestSchema, peticion, contexto)
      for (const state of [JobState.QUEUED, JobState.RUNNING, JobState.DONE]) {
        yield { job: create(JobSchema, { id: peticion.jobId, state }) }
      }
    },
  })
}

let servidorGrpc: http2.Http2Server
let servidorWeb: http.Server
const sesiones = new Set<http2.ServerHttp2Session>()
const urls = { grpc: '', 'grpc-web': '' }

beforeAll(async () => {
  const adaptador = connectNodeAdapter({ routes: rutas })
  servidorGrpc = http2.createServer(adaptador)
  servidorWeb = http.createServer(adaptador)
  servidorGrpc.on('session', (sesion) => {
    sesiones.add(sesion)
    sesion.on('close', () => sesiones.delete(sesion))
  })
  await Promise.all([
    new Promise<void>((listo) => servidorGrpc.listen(0, '127.0.0.1', listo)),
    new Promise<void>((listo) => servidorWeb.listen(0, '127.0.0.1', listo)),
  ])
  const puerto = (s: { address(): AddressInfo | string | null }) => {
    const direccion = s.address()
    if (direccion === null || typeof direccion === 'string') throw new Error('sin puerto')
    return direccion.port
  }
  urls.grpc = `http://127.0.0.1:${puerto(servidorGrpc)}`
  urls['grpc-web'] = `http://127.0.0.1:${puerto(servidorWeb)}`
})

afterAll(async () => {
  // Los clientes mantienen vivas sus conexiones (HTTP/2 y keep-alive): se cierran a mano.
  sesiones.forEach((sesion) => sesion.destroy())
  servidorWeb.closeAllConnections()
  await Promise.all([
    new Promise((listo) => servidorGrpc.close(listo)),
    new Promise((listo) => servidorWeb.close(listo)),
  ])
})

describe.each(['grpc', 'grpc-web'] as const)('transporte %s', (transporte) => {
  it('una llamada unaria firmada llega y el servidor sabe por donde llego', async () => {
    const cliente = createClient(ServiceStatusService, crearTransporte(transporte, urls[transporte], SECRETO_PRUEBA))
    const respuesta = await cliente.getServiceStatus({})
    expect(respuesta.status?.serviceName).toBe('servicio-falso')
    expect(respuesta.status?.servedVia).toBe(transporte === 'grpc' ? Transport.GRPC : Transport.GRPC_WEB)
  })

  it('con el secreto de otro par se rechaza', async () => {
    const cliente = createClient(ServiceStatusService, crearTransporte(transporte, urls[transporte], OTRO_SECRETO))
    await expect(cliente.getServiceStatus({})).rejects.toMatchObject({ code: Code.Unauthenticated })
  })

  it('el streaming del servidor firma su unico mensaje de peticion', async () => {
    const cliente = createClient(JobService, crearTransporte(transporte, urls[transporte], SECRETO_PRUEBA))
    const estados: JobState[] = []
    for await (const evento of cliente.watchJob({ jobId: 't-1' })) {
      estados.push(evento.job?.state ?? JobState.UNSPECIFIED)
    }
    expect(estados).toEqual([JobState.QUEUED, JobState.RUNNING, JobState.DONE])
  })
})
