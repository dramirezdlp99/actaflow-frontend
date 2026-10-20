import { EntitySource, TemplateCategory, VariableType, VersionState } from '@/gen/actaflow/templates/v1/template_pb'

/** Textos en espanol de los enums de plantillas. */

export const CATEGORIA: Record<TemplateCategory, string> = {
  [TemplateCategory.UNSPECIFIED]: 'Sin categoría',
  [TemplateCategory.CONCILIATION_AGREEMENT]: 'Acta de conciliación con acuerdo',
  [TemplateCategory.NO_AGREEMENT_RECORD]: 'Constancia de no acuerdo',
  [TemplateCategory.MEDIATION_MINUTE]: 'Acta de mediación',
  [TemplateCategory.CONTRACT]: 'Contrato',
}

/** Categorias que se pueden elegir, en el orden de la biblioteca. */
export const CATEGORIAS = [
  { valor: 'CONCILIATION_AGREEMENT', categoria: TemplateCategory.CONCILIATION_AGREEMENT },
  { valor: 'NO_AGREEMENT_RECORD', categoria: TemplateCategory.NO_AGREEMENT_RECORD },
  { valor: 'MEDIATION_MINUTE', categoria: TemplateCategory.MEDIATION_MINUTE },
  { valor: 'CONTRACT', categoria: TemplateCategory.CONTRACT },
] as const

export type ValorCategoria = (typeof CATEGORIAS)[number]['valor']

export const TIPO_VARIABLE: Record<VariableType, string> = {
  [VariableType.UNSPECIFIED]: '—',
  [VariableType.TEXT]: 'Texto',
  [VariableType.MONEY]: 'Dinero',
  [VariableType.DATE]: 'Fecha',
  [VariableType.INTEGER]: 'Número',
  [VariableType.PARTY]: 'Parte',
  [VariableType.LIST]: 'Lista',
  [VariableType.BOOLEAN]: 'Sí o no',
}

export const ORIGEN: Record<EntitySource, string> = {
  [EntitySource.UNSPECIFIED]: 'Lo escribe una persona',
  [EntitySource.PARTY]: 'Identificación de una parte',
  [EntitySource.AMOUNT]: 'Monto',
  [EntitySource.DEADLINE]: 'Plazo de pago',
  [EntitySource.COMMITMENT]: 'Compromiso de entrega',
  [EntitySource.PENALTY]: 'Cláusula penal',
  [EntitySource.CASE]: 'Datos del expediente',
}

export const ESTADO_VERSION: Record<VersionState, string> = {
  [VersionState.UNSPECIFIED]: '—',
  [VersionState.DRAFT]: 'Borrador',
  [VersionState.PUBLISHED]: 'Publicada',
  [VersionState.SUPERSEDED]: 'Reemplazada',
}

export const TONO_VERSION: Record<VersionState, string> = {
  [VersionState.UNSPECIFIED]: 'border-linea text-tinta-suave',
  [VersionState.DRAFT]: 'border-alerta/40 bg-lacre-suave text-alerta',
  [VersionState.PUBLISHED]: 'border-exito/40 text-exito',
  [VersionState.SUPERSEDED]: 'border-linea text-tinta-suave',
}
