// @vitest-environment node
import { create } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import { TemplateValueSchema } from '@/gen/actaflow/templates/v1/template_pb'
import { ClientePlantillas, ProcesadorPlantillas } from '@/lib/hilos/hiloPlantillas'

const FUENTE = 'Convocante: {{ partes.convocante.nombre }}\n\nMonto: {{ acuerdo.monto | moneda }}'
const texto = (v: string) => create(TemplateValueSchema, { kind: { case: 'text', value: v } })

describe('llenado del acta en un hilo aparte', () => {
  it('analiza la plantilla una vez y arma el acta con lo que haya, marcando lo que falta', () => {
    const p = new ProcesadorPlantillas()
    const analisis = p.responder({ id: 1, tipo: 'analizar', fuente: FUENTE })
    expect(analisis.tipo === 'analizar' && analisis.variables.map((v) => v.path)).toEqual([
      'partes.convocante.nombre',
      'acuerdo.monto',
    ])
    const armada = p.responder({ id: 2, tipo: 'armar', fuente: FUENTE, valores: { 'partes.convocante.nombre': texto('Ana <b>') } })
    expect(armada.tipo).toBe('armar')
    if (armada.tipo !== 'armar') return
    expect(armada.faltan).toBe(1)
    expect(armada.html).toContain('Ana &lt;b&gt;')
  })

  it('sin Workers (jsdom, navegadores viejos) responde en el mismo hilo con el mismo resultado', async () => {
    const c = new ClientePlantillas(null)
    expect(c.enOtroHilo).toBe(false)
    const r = await c.pedir({ tipo: 'armar', fuente: FUENTE, valores: {} })
    expect(r.tipo === 'armar' && r.faltan).toBe(2)
  })
})
