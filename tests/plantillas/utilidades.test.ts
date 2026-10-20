// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { slugDe } from '@/components/plantillas/EditorPlantilla'
import { VariableType, type TemplateVariable } from '@/gen/actaflow/templates/v1/template_pb'
import { valoresDeEjemplo } from '@/lib/plantillas/ejemplos'
import { resaltar } from '@/lib/plantillas/resaltar'
import { sanearHtml } from '@/lib/plantillas/saneo'
import { analizar, enLetras, html } from '@/lib/rpc/lenguajeSimulado'

vi.mock('server-only', () => ({}))

describe('resaltar la fuente', () => {
  it('separa texto, variables, etiquetas y comentarios sin perder nada', () => {
    const fuente = 'Hola {{ a.b | moneda }}{% si x %}!{% fin %}{# nota #} y { suelta {{ sin cerrar'
    const trozos = resaltar(fuente)
    expect(trozos.map((t) => t.tipo)).toEqual(['texto', 'variable', 'etiqueta', 'texto', 'etiqueta', 'comentario', 'texto'])
    expect(trozos.map((t) => t.texto).join('')).toBe(fuente)
  })
})

describe('sanear el HTML de la vista previa', () => {
  it('deja solo las etiquetas del documento y escapa todo lo demas', () => {
    const permitido = '<h2>Acta</h2>\n<p><strong>A</strong> <span class="valor">x &amp; y</span><br><mark class="falta">[z]</mark></p>'
    expect(sanearHtml(permitido)).toBe(permitido)
    expect(sanearHtml('<p onclick="x">a</p><img src=x onerror=alert(1)><script>b</script>')).toBe(
      '&lt;p onclick=&quot;x&quot;&gt;a</p>&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;b&lt;/script&gt;',
    )
    expect(sanearHtml('<span class="valor" style="x">a</span> & <')).toBe(
      '&lt;span class=&quot;valor&quot; style=&quot;x&quot;&gt;a</span> &amp; &lt;',
    )
    expect(sanearHtml('&copy; &#39; &nbsp;')).toBe('&amp;copy; &#39; &nbsp;')
  })
})

describe('datos de ejemplo', () => {
  it('da un valor de su tipo a cada variable', () => {
    const variables = [
      { path: 'partes.convocante.nombre', type: VariableType.TEXT, label: 'Convocante: nombre' },
      { path: 'acuerdo.monto', type: VariableType.MONEY, label: 'Acuerdo: monto' },
      { path: 'audiencia.fecha', type: VariableType.DATE, label: 'Audiencia: fecha' },
      { path: 'acuerdo.plan', type: VariableType.LIST, label: 'Acuerdo: plan' },
      { path: 'partes.convocado', type: VariableType.PARTY, label: 'Partes: convocado' },
      { path: 'otro.dato', type: VariableType.TEXT, label: 'Otro: dato' },
    ] as Partial<TemplateVariable>[]
    const valores = valoresDeEjemplo(variables as TemplateVariable[], new Date(Date.UTC(2026, 9, 20)))
    expect(valores['partes.convocante.nombre']?.kind).toEqual({ case: 'text', value: 'María Fernanda Ruiz' })
    expect(valores['acuerdo.monto']?.kind.case).toBe('money')
    expect(valores['audiencia.fecha']?.kind).toMatchObject({ case: 'date', value: { year: 2026, month: 11, day: 4 } })
    expect(valores['acuerdo.plan']?.kind.case).toBe('list')
    expect(valores['partes.convocado']?.kind.case).toBe('object')
    expect(valores['otro.dato']?.kind).toEqual({ case: 'text', value: 'Otro: dato' })
  })
})

describe('slug desde el titulo', () => {
  it('quita tildes, espacios y signos', () => {
    expect(slugDe('  Acta de Mediación: barrio (2026)! ')).toBe('acta-de-mediacion-barrio-2026')
  })
})

describe('lenguaje simulado (igual que legal-case)', () => {
  it('escribe en letras como las actas', () => {
    expect(enLetras(21n)).toBe('veintiuno')
    expect(enLetras(21n, true)).toBe('veintiún')
    expect(enLetras(1_500_000n)).toBe('un millón quinientos mil')
    expect(enLetras(101_000n)).toBe('ciento un mil')
    expect(enLetras(1_000_000_000n)).toBe('mil millones')
    expect(enLetras(2026n)).toBe('dos mil veintiséis')
  })

  it('da los mismos diagnosticos que el servicio Java', () => {
    const { diagnosticos } = analizar('Hola\n{% si acuerdo.total %}\nTexto')
    expect(diagnosticos.map((d) => `${d.line}:${d.column} ${d.message}`)).toEqual([
      '2:1 Falta {% fin %} para el bloque abierto en la línea 2',
    ])
    expect(analizar('{{ x | dinero }}').diagnosticos[0]?.message).toContain('Formato desconocido: «dinero»')
  })

  it('genera el mismo HTML escapado, con titulos, negrita y lo que falta', () => {
    const { nodos } = analizar('# ACTA {{ caso.radicado }}\n\n**Monto:** {{ m | moneda_en_letras }}\n{% si no x %}\nSin x\n{% fin %}\n{{ falta }}')
    expect(
      html(nodos, {
        'caso.radicado': { $typeName: 'actaflow.templates.v1.TemplateValue', kind: { case: 'text', value: '<b>' } },
        m: {
          $typeName: 'actaflow.templates.v1.TemplateValue',
          kind: { case: 'money', value: { $typeName: 'actaflow.common.v1.Money', currencyCode: 'COP', units: 1_000_000n, nanos: 0 } },
        },
      }),
    ).toBe(
      '<h2>ACTA <span class="valor">&lt;b&gt;</span></h2>\n' +
        '<p><strong>Monto:</strong> <span class="valor">un millón de pesos ($1.000.000)</span><br>Sin x<br>' +
        '<mark class="falta">[falta]</mark></p>\n',
    )
  })
})
