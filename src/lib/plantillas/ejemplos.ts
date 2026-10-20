import { create } from '@bufbuild/protobuf'
import {
  TemplateValueSchema,
  VariableType,
  type TemplateValue,
  type TemplateVariable,
} from '@/gen/actaflow/templates/v1/template_pb'

/**
 * Datos de ejemplo para la vista previa del editor, segun el tipo de cada variable. Los nombres
 * comunes (nombre, documento, ciudad...) llevan ejemplos realistas, nunca datos de personas reales.
 */
const POR_NOMBRE: Record<string, string> = {
  nombre: 'María Fernanda Ruiz',
  documento: 'C.C. 52.000.000',
  ciudad: 'Bogotá D.C.',
  direccion: 'Calle 18 # 7-45',
  radicado: 'CC-2026-0142',
  apoderado: 'Andrés Gómez, T.P. 123.456',
  calidad: 'parte convocante',
  descripcion: 'la situación que las partes describieron en la sesión',
  responsable: 'La parte convocada',
}

const texto = (valor: string): TemplateValue => create(TemplateValueSchema, { kind: { case: 'text', value: valor } })

function ejemplo(variable: TemplateVariable, hoy: Date): TemplateValue {
  const ultimo = variable.path.split('.').at(-1) ?? variable.path
  switch (variable.type) {
    case VariableType.MONEY:
      return create(TemplateValueSchema, {
        kind: { case: 'money', value: { currencyCode: 'COP', units: 1_500_000n, nanos: 0 } },
      })
    case VariableType.DATE: {
      const dia = new Date(hoy.getTime() + 15 * 86_400_000)
      return create(TemplateValueSchema, {
        kind: {
          case: 'date',
          value: { year: dia.getUTCFullYear(), month: dia.getUTCMonth() + 1, day: dia.getUTCDate() },
        },
      })
    }
    case VariableType.INTEGER:
      return create(TemplateValueSchema, { kind: { case: 'integer', value: 3n } })
    case VariableType.BOOLEAN:
      return create(TemplateValueSchema, { kind: { case: 'boolean', value: true } })
    case VariableType.LIST:
      // Dos elementos vacios: se ve la clausula repetida con lo que falta resaltado.
      return create(TemplateValueSchema, {
        kind: { case: 'list', value: { items: [0, 1].map(() => objeto({})) } },
      })
    case VariableType.PARTY:
      return objeto({ nombre: texto(POR_NOMBRE.nombre ?? ''), documento: texto(POR_NOMBRE.documento ?? '') })
    default:
      return texto(POR_NOMBRE[ultimo] ?? variable.label)
  }
}

function objeto(campos: Record<string, TemplateValue>): TemplateValue {
  return create(TemplateValueSchema, { kind: { case: 'object', value: { fields: campos } } })
}

export function valoresDeEjemplo(variables: TemplateVariable[], hoy = new Date()): Record<string, TemplateValue> {
  return Object.fromEntries(variables.map((v) => [v.path, ejemplo(v, hoy)]))
}
