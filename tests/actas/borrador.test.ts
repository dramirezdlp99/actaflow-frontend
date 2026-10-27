// @vitest-environment node
import { create, fromBinary } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import {
  GetDocumentStateResponseSchema,
  PushUpdatesRequestSchema,
  SequencedUpdateSchema,
  type SequencedUpdate,
} from '@/gen/actaflow/collaboration/v1/collaboration_pb'
import {
  BandejaEnMemoria,
  DocumentoBorrador,
  Rechazado,
  SinConexion,
  SincronizadorBorrador,
  type EstadoBorrador,
  type Transporte,
} from '@/lib/actas/borrador'

const CASO = '11111111-1111-4111-8111-111111111111'
const ACTA = '22222222-2222-4222-8222-222222222222'

/** legal-case en miniatura: orden total, idempotente por update_id, y un interruptor de red. */
class Servidor {
  cambios: SequencedUpdate[] = []
  cerrada = false
  enLinea = true
  peticiones = 0

  transporte(): Transporte {
    return {
      traer: async (_acta, despues) => {
        this.peticiones += 1
        if (!this.enLinea) throw new SinConexion()
        return create(GetDocumentStateResponseSchema, {
          updates: this.cambios.filter((c) => Number(c.sequence) > despues),
        })
      },
      enviar: async (bytes) => {
        this.peticiones += 1
        if (!this.enLinea) throw new SinConexion()
        const p = fromBinary(PushUpdatesRequestSchema, bytes)
        return p.updates.map((u) => {
          const ya = this.cambios.find((c) => c.update?.updateId === u.updateId)
          if (ya) return Number(ya.sequence)
          if (this.cerrada) throw new Rechazado('El acta ya se cerró.')
          const s = create(SequencedUpdateSchema, { update: u, sequence: BigInt(this.cambios.length + 1) })
          this.cambios.push(s)
          return Number(s.sequence)
        })
      },
    }
  }
}

async function contexto(autor: string, claveCaso: CryptoKey) {
  return { claveCaso, idClaveCaso: 'caso:1', casoId: CASO, actaId: ACTA, autor }
}

function cliente(servidor: Servidor, ctx: Awaited<ReturnType<typeof contexto>>, bandeja = new BandejaEnMemoria()) {
  let ultimo: EstadoBorrador | null = null
  const s = new SincronizadorBorrador(ctx, servidor.transporte(), bandeja, (e) => {
    ultimo = e
  })
  return { s, bandeja, estado: () => ultimo! }
}

describe('documento del borrador (ultimo en el orden del servidor gana)', () => {
  it('lo propio se ve al instante y lo confirmado manda segun la secuencia', () => {
    const d = new DocumentoBorrador()
    d.local('u1', { campo: 'ciudad', valor: 'Pasto', autor: 'a' })
    expect(d.valores()).toEqual({ ciudad: 'Pasto' })
    d.remoto(1, 'x', { campo: 'ciudad', valor: 'Ipiales', autor: 'b' })
    expect(d.valores(), 'lo propio sin confirmar sigue encima').toEqual({ ciudad: 'Pasto' })
    d.remoto(2, 'u1', { campo: 'ciudad', valor: 'Pasto', autor: 'a' })
    expect(d.cantidadPendiente).toBe(0)
    d.remoto(2, 'u1', { campo: 'ciudad', valor: 'otra', autor: 'a' })
    expect(d.valores(), 'una secuencia repetida no cambia nada').toEqual({ ciudad: 'Pasto' })
    d.remoto(3, 'y', { campo: 'ciudad', valor: null, autor: 'b' })
    expect(d.valores()).toEqual({})
  })
})

describe('borrador colaborativo sin conexion', () => {
  it('dos navegadores convergen; sin red se guarda cifrado, sobrevive a recargar y se envia al volver', async () => {
    const clave = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const servidor = new Servidor()
    const alicia = cliente(servidor, await contexto('alicia', clave))
    const bruno = cliente(servidor, await contexto('bruno', clave))
    await alicia.s.iniciar()
    await bruno.s.iniciar()

    await alicia.s.cambiar('ciudad', 'Pasto')
    await alicia.s.sincronizar()
    await bruno.s.sincronizar()
    expect(bruno.estado().valores).toEqual({ ciudad: 'Pasto' })

    // Sin red: Bruno sigue editando. Lo ve al instante y queda en la bandeja (cifrado).
    servidor.enLinea = false
    await bruno.s.cambiar('ciudad', 'Ipiales')
    await bruno.s.cambiar('lugar', 'Sala 2')
    await bruno.s.sincronizar()
    expect(bruno.estado()).toMatchObject({ conexion: 'sin-conexion', pendientes: 2 })
    expect(bruno.estado().valores).toEqual({ ciudad: 'Ipiales', lugar: 'Sala 2' })
    const guardado = await bruno.bandeja.pendientes(ACTA)
    expect(guardado).toHaveLength(2)
    expect(new TextDecoder().decode(guardado[0])).not.toContain('Ipiales')

    // Bruno recarga la pagina sin red: lo pendiente sigue ahi.
    const recargado = cliente(servidor, await contexto('bruno', clave), bruno.bandeja)
    await recargado.s.iniciar()
    expect(recargado.estado().valores).toEqual({ ciudad: 'Ipiales', lugar: 'Sala 2' })

    // Vuelve la red: se envia solo una vez aunque se reintente, y Alicia lo recibe.
    servidor.enLinea = true
    await recargado.s.sincronizar()
    await recargado.s.sincronizar()
    expect(servidor.cambios).toHaveLength(3)
    expect(recargado.estado()).toMatchObject({ conexion: 'en-linea', pendientes: 0 })
    await alicia.s.sincronizar()
    expect(alicia.estado().valores).toEqual({ ciudad: 'Ipiales', lugar: 'Sala 2' })
  })

  it('si el acta se cerro mientras no habia red, lo pendiente se descarta con un aviso', async () => {
    const clave = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
    const servidor = new Servidor()
    const bruno = cliente(servidor, await contexto('bruno', clave))
    await bruno.s.iniciar()
    servidor.enLinea = false
    await bruno.s.cambiar('lugar', 'Sala 3')
    servidor.cerrada = true
    servidor.enLinea = true
    await bruno.s.sincronizar()
    expect(bruno.estado().pendientes).toBe(0)
    expect(bruno.estado().aviso).toMatch(/cerró.*no se guard/)
    expect(await bruno.bandeja.pendientes(ACTA)).toHaveLength(0)
  })
})
