import { clone } from '@bufbuild/protobuf'
import type { CalendarDate, Money } from '@/gen/actaflow/common/v1/values_pb'
import {
  DocumentType,
  EntityExtractionResultSchema,
  PenaltyKind,
  ReviewState,
  type EntityExtractionResult,
  type LegalEntity,
} from '@/gen/actaflow/legal/v1/entities_pb'

/**
 * Las entidades que propone el motor, en palabras, y la revision humana: cada una se confirma, se
 * corrige (su dato principal) o se descarta. Lo que se guarda es el mismo EntityExtractionResult con
 * el estado de revision de cada entidad: el acta (bloque C5) solo usa las confirmadas o corregidas.
 */

export const FAMILIAS = [
  { clave: 'parties', titulo: 'Partes' },
  { clave: 'amounts', titulo: 'Montos' },
  { clave: 'deadlines', titulo: 'Plazos' },
  { clave: 'commitments', titulo: 'Compromisos' },
  { clave: 'penalties', titulo: 'Cláusulas penales' },
] as const

export type Familia = (typeof FAMILIAS)[number]['clave']

const DOCUMENTO: Record<DocumentType, string> = {
  [DocumentType.UNSPECIFIED]: '',
  [DocumentType.CEDULA_CIUDADANIA]: 'C.C.',
  [DocumentType.CEDULA_EXTRANJERIA]: 'C.E.',
  [DocumentType.NIT]: 'NIT',
  [DocumentType.PASSPORT]: 'Pasaporte',
}

export function pesos(dinero: Money | undefined): string {
  if (!dinero) {
    return ''
  }
  const valor = Number(dinero.units) + dinero.nanos / 1e9
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: dinero.currencyCode || 'COP',
    maximumFractionDigits: dinero.nanos ? 2 : 0,
  }).format(valor)
}

function fecha(f: CalendarDate | undefined): string {
  if (!f?.year) {
    return ''
  }
  return new Date(Date.UTC(f.year, f.month - 1, f.day)).toLocaleDateString('es-CO', {
    dateStyle: 'long',
    timeZone: 'UTC',
  })
}

export type Descripcion = { titulo: string; detalle: string; editable: string }

/** Titulo y detalle legibles, y el dato principal que la persona puede corregir. */
export function describir(e: LegalEntity, partes: LegalEntity[]): Descripcion {
  const parte = (i: number) => {
    const p = partes[i]?.value
    return p?.case === 'party' ? p.value.fullName : ''
  }
  const v = e.value
  switch (v.case) {
    case 'party': {
      const doc = v.value.documentNumber ? `${DOCUMENTO[v.value.documentType]} ${v.value.documentNumber}`.trim() : ''
      const nit = v.value.documentType === DocumentType.NIT && v.value.nitCheckDigit ? `-${v.value.nitCheckDigit}` : ''
      return {
        titulo: v.value.fullName || 'Parte sin nombre',
        detalle: [doc + nit, v.value.isOrganization ? 'Persona jurídica' : ''].filter(Boolean).join(' · '),
        editable: v.value.fullName,
      }
    }
    case 'amount': {
      const cuotas = v.value.installments > 1 ? `${v.value.installments} cuotas de ${pesos(v.value.installmentAmount)}` : ''
      const quien = [parte(v.value.debtorPartyIndex), parte(v.value.creditorPartyIndex)]
      return {
        titulo: pesos(v.value.amount) || v.value.writtenForm,
        detalle: [cuotas, quien[0] && quien[1] ? `${quien[0]} paga a ${quien[1]}` : quien[0] || ''].filter(Boolean).join(' · '),
        editable: v.value.amount ? String(v.value.amount.units) : '',
      }
    }
    case 'deadline':
      return {
        titulo: v.value.expression || fecha(v.value.dueDate),
        detalle: fecha(v.value.dueDate),
        editable: v.value.expression,
      }
    case 'commitment':
      return {
        titulo: v.value.object,
        detalle: [parte(v.value.obligorPartyIndex), v.value.deadlineExpression || fecha(v.value.dueDate)]
          .filter(Boolean)
          .join(' · '),
        editable: v.value.object,
      }
    case 'penalty': {
      const monto =
        v.value.kind === PenaltyKind.PERCENTAGE
          ? `${(v.value.basisPoints / 100).toLocaleString('es-CO')} %`
          : v.value.kind === PenaltyKind.DEFAULT_INTEREST
            ? 'Intereses de mora'
            : pesos(v.value.fixedAmount)
      return { titulo: monto, detalle: v.value.trigger, editable: v.value.trigger }
    }
    default:
      return { titulo: 'Entidad', detalle: '', editable: '' }
  }
}

export type Decision = { estado: ReviewState; correccion?: string }

/** Aplica las decisiones a una copia; una correccion vacia o invalida se ignora. */
export function aplicarRevision(base: EntityExtractionResult, decisiones: Map<string, Decision>): EntityExtractionResult {
  const resultado = clone(EntityExtractionResultSchema, base)
  for (const { clave } of FAMILIAS) {
    for (const e of resultado[clave]) {
      const d = decisiones.get(e.id)
      if (!d) {
        continue
      }
      e.review = d.estado
      if (d.estado === ReviewState.CORRECTED && d.correccion !== undefined) {
        corregir(e, d.correccion.trim())
      }
    }
  }
  return resultado
}

function corregir(e: LegalEntity, texto: string): void {
  const v = e.value
  if (!texto) {
    return
  }
  switch (v.case) {
    case 'party':
      v.value.fullName = texto.slice(0, 200)
      break
    case 'amount': {
      const digitos = texto.replace(/[^\d]/g, '')
      if (digitos && v.value.amount) {
        v.value.amount.units = BigInt(digitos.slice(0, 15))
        v.value.amount.nanos = 0
      }
      break
    }
    case 'deadline':
      v.value.expression = texto.slice(0, 500)
      break
    case 'commitment':
      v.value.object = texto.slice(0, 500)
      break
    case 'penalty':
      v.value.trigger = texto.slice(0, 500)
      break
    default:
      break
  }
}

/** Decisiones guardadas en una revision previa, para seguir donde se quedo. */
export function decisionesDe(revisada: EntityExtractionResult | null): Map<string, Decision> {
  const mapa = new Map<string, Decision>()
  if (!revisada) {
    return mapa
  }
  for (const { clave } of FAMILIAS) {
    for (const e of revisada[clave]) {
      if (e.review !== ReviewState.UNSPECIFIED) {
        mapa.set(e.id, { estado: e.review, correccion: describir(e, revisada.parties).editable })
      }
    }
  }
  return mapa
}

export function contarEntidades(r: EntityExtractionResult | null): number {
  return r ? FAMILIAS.reduce((n, { clave }) => n + r[clave].length, 0) : 0
}
