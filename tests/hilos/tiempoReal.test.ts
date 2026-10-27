// @vitest-environment node
import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import {
  EncryptedUpdateSchema,
  GetDocumentStateResponseSchema,
  SequencedUpdateSchema,
} from '@/gen/actaflow/collaboration/v1/collaboration_pb'
import { WatchHearingEventsResponseSchema } from '@/gen/actaflow/hearings/v1/hearing_pb'
import { aTexto } from '@/lib/audiencias/protocolo'
import { CentralTiempoReal, type Entorno, type MensajeDelCentral, type Puerto } from '@/lib/hilos/tiempoReal'

const CASO = '11111111-1111-4111-8111-111111111111'
const AUD = '22222222-2222-4222-8222-222222222222'
const ACTA = '33333333-3333-4333-8333-333333333333'

function pestana(): Puerto & { recibidos: MensajeDelCentral[] } {
  const recibidos: MensajeDelCentral[] = []
  return { recibidos, postMessage: (m) => recibidos.push(m) }
}

const evento = (n: number, fin = false) =>
  JSON.stringify({
    e: aTexto(
      WatchHearingEventsResponseSchema,
      create(WatchHearingEventsResponseSchema, {
        eventSequence: BigInt(n),
        event: fin ? { case: 'hearingEnded', value: {} } : { case: 'heartbeat', value: {} },
      }),
    ),
  }) + '\n'

const esperar = () => new Promise((r) => setTimeout(r, 20))

describe('central de tiempo real (lo que corre en el Shared Worker)', () => {
  it('tres pestanas con la misma audiencia: UNA conexion, todas reciben, la nueva recibe lo pasado', async () => {
    const pedidos: string[] = []
    const entorno: Entorno = {
      fetch: async (url) => {
        pedidos.push(String(url))
        return new Response(evento(1) + evento(2) + evento(3, true), { headers: { 'content-type': 'application/x-ndjson' } })
      },
      ahora: () => 0,
      dormir: async () => {},
      cadaTanto: () => () => {},
    }
    const central = new CentralTiempoReal(entorno)
    const [a, b] = [pestana(), pestana()]
    central.recibir(a, { tipo: 'audiencia', casoId: CASO, audienciaId: AUD })
    central.recibir(b, { tipo: 'audiencia', casoId: CASO, audienciaId: AUD })
    await esperar()
    expect(pedidos).toHaveLength(1)
    const eventos = (p: ReturnType<typeof pestana>) => p.recibidos.filter((m) => m.tipo === 'evento').length
    expect([eventos(a), eventos(b)]).toEqual([3, 3])
    expect(b.recibidos.some((m) => m.tipo === 'conexion' && m.pestanas === 2)).toBe(true)

    const c = pestana()
    central.recibir(c, { tipo: 'audiencia', casoId: CASO, audienciaId: AUD })
    expect(eventos(c)).toBe(3)
    expect(pedidos, 'la tercera no abre otra conexion').toHaveLength(1)
    expect(c.recibidos.at(-1)).toMatchObject({ tipo: 'conexion', estado: 'cerrada', pestanas: 3 })

    for (const p of [a, b, c]) central.recibir(p, { tipo: 'dejar-audiencia', audienciaId: AUD })
    expect(central.conexionesAbiertas).toBe(0)
  })

  it('el borrador: pedidos simultaneos de varias pestanas se sirven con UNA consulta', async () => {
    let consultas = 0
    let ahora = 0
    let tic = () => {}
    const cambio = (n: number) =>
      create(SequencedUpdateSchema, { sequence: BigInt(n), update: create(EncryptedUpdateSchema, { updateId: `id-${n}` }) })
    let servidor = [cambio(1), cambio(2)]
    const entorno: Entorno = {
      fetch: async (url) => {
        consultas += 1
        const despues = Number(new URL(String(url), 'http://x').searchParams.get('despues'))
        const r = create(GetDocumentStateResponseSchema, { updates: servidor.filter((u) => Number(u.sequence) > despues) })
        return new Response(toBinary(GetDocumentStateResponseSchema, r), { headers: { 'content-type': 'application/x-protobuf' } })
      },
      ahora: () => ahora,
      dormir: async () => {},
      cadaTanto: (f) => {
        tic = f
        return () => {}
      },
    }
    const central = new CentralTiempoReal(entorno)
    const [a, b, c] = [pestana(), pestana(), pestana()]
    ahora = 10_000
    central.recibir(a, { tipo: 'traer', id: 1, casoId: CASO, actaId: ACTA, despues: 0 })
    central.recibir(b, { tipo: 'traer', id: 2, casoId: CASO, actaId: ACTA, despues: 0 })
    central.recibir(c, { tipo: 'traer', id: 3, casoId: CASO, actaId: ACTA, despues: 1 })
    await esperar()
    expect(consultas).toBe(1)
    const traido = (p: ReturnType<typeof pestana>) => {
      const m = p.recibidos.find((x) => x.tipo === 'traido')
      return m?.tipo === 'traido' ? fromBinary(GetDocumentStateResponseSchema, m.respuesta).updates.map((u) => Number(u.sequence)) : null
    }
    expect([traido(a), traido(b), traido(c)]).toEqual([[1, 2], [1, 2], [2]])

    // Cada 3 s consulta UNA vez y avisa a todas si hay algo nuevo.
    servidor = [...servidor, cambio(3)]
    tic()
    await esperar()
    expect(consultas).toBe(2)
    for (const p of [a, b, c]) expect(p.recibidos.at(-1)).toMatchObject({ tipo: 'borrador-nuevo', pestanas: 3 })
  })

  it('sin red, el pedido vuelve marcado como sin conexion', async () => {
    const central = new CentralTiempoReal({
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
      ahora: () => 5_000,
      dormir: async () => {},
      cadaTanto: () => () => {},
    })
    const a = pestana()
    central.recibir(a, { tipo: 'traer', id: 9, casoId: CASO, actaId: ACTA, despues: 0 })
    await esperar()
    expect(a.recibidos[0]).toMatchObject({ tipo: 'traido-error', id: 9, sinConexion: true })
  })
})
