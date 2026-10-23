import { create } from '@bufbuild/protobuf'
import { CaseRole } from '@/gen/actaflow/cases/v1/case_pb'
import { PartyCapacity, PartySide } from '@/gen/actaflow/cases/v1/participant_pb'
import {
  CalendarDateSchema,
  MoneySchema,
  type CalendarDate,
  type Money,
} from '@/gen/actaflow/common/v1/values_pb'
import {
  DocumentType,
  ReviewState,
  type EntityExtractionResult,
  type LegalEntity,
} from '@/gen/actaflow/legal/v1/entities_pb'
import { TemplateValueSchema, type TemplateValue } from '@/gen/actaflow/templates/v1/template_pb'

/**
 * El "autollenado" del acta (paso 4 del caso de estudio): los datos del expediente y las entidades
 * que una persona REVISO (confirmadas o corregidas) se vuelcan en las variables de la plantilla.
 * Corre en el navegador: nadie mas ve estos datos. Lo que no se pueda deducir queda para el
 * formulario, y lo que falte se ve resaltado en el acta.
 */

export type PersonaActa = {
  id: string
  nombre: string
  rol: CaseRole
  lado: PartySide
  calidad: PartyCapacity
}

export type DatosActa = {
  radicado: string
  personas: PersonaActa[]
  /** Inicio de la audiencia (o null si no hubo). */
  audiencia: Date | null
  /** La revision guardada de las entidades (null si no hubo extraccion revisada). */
  entidades: EntityExtractionResult | null
}

type Valores = Record<string, TemplateValue>

const texto = (v: string): TemplateValue => create(TemplateValueSchema, { kind: { case: 'text', value: v } })
const dinero = (v: Money): TemplateValue => create(TemplateValueSchema, { kind: { case: 'money', value: v } })
const fecha = (v: CalendarDate): TemplateValue => create(TemplateValueSchema, { kind: { case: 'date', value: v } })
const entero = (v: number): TemplateValue =>
  create(TemplateValueSchema, { kind: { case: 'integer', value: BigInt(v) } })
const objeto = (campos: Valores): TemplateValue =>
  create(TemplateValueSchema, { kind: { case: 'object', value: { fields: campos } } })
const lista = (items: TemplateValue[]): TemplateValue =>
  create(TemplateValueSchema, { kind: { case: 'list', value: { items } } })

const DOCUMENTO: Record<DocumentType, string> = {
  [DocumentType.UNSPECIFIED]: '',
  [DocumentType.CEDULA_CIUDADANIA]: 'C.C.',
  [DocumentType.CEDULA_EXTRANJERIA]: 'C.E.',
  [DocumentType.NIT]: 'NIT',
  [DocumentType.PASSPORT]: 'Pasaporte',
}

export const aFecha = (d: Date): CalendarDate =>
  create(CalendarDateSchema, { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() })

/** Solo lo que una persona reviso y no descarto pasa al acta. */
function aceptadas(lista: LegalEntity[] | undefined): LegalEntity[] {
  return (lista ?? []).filter((e) => e.review === ReviewState.CONFIRMED || e.review === ReviewState.CORRECTED)
}

function documento(e: LegalEntity | undefined): string {
  if (e?.value.case !== 'party' || !e.value.value.documentNumber) {
    return ''
  }
  const p = e.value.value
  const dv = p.documentType === DocumentType.NIT && p.nitCheckDigit ? `-${p.nitCheckDigit}` : ''
  return `${DOCUMENTO[p.documentType]} ${p.documentNumber}${dv}`.trim()
}

function calidad(p: PersonaActa): string {
  if (p.rol === CaseRole.CONCILIATOR) return 'conciliador'
  if (p.rol === CaseRole.ASSISTANT) return 'asistente'
  const parte = p.lado === PartySide.RESPONDENT ? 'parte convocada' : 'parte convocante'
  return p.calidad === PartyCapacity.ATTORNEY ? `apoderado de la ${parte}` : parte
}

export function valoresAutomaticos(d: DatosActa): Valores {
  const v: Valores = {}
  const partes = aceptadas(d.entidades?.parties)
  const deParticipante = (id: string) =>
    partes.find((e) => e.value.case === 'party' && e.value.value.participantId === id)
  const nombre = (p: PersonaActa) => {
    const e = deParticipante(p.id)
    return e?.value.case === 'party' && e.value.value.fullName ? e.value.value.fullName : p.nombre
  }

  v['caso.radicado'] = texto(d.radicado)
  if (d.audiencia) {
    v['audiencia.fecha'] = fecha(aFecha(d.audiencia))
  }
  const conciliador = d.personas.find((p) => p.rol === CaseRole.CONCILIATOR)
  if (conciliador) {
    v['conciliador.nombre'] = texto(conciliador.nombre)
    v['mediador.nombre'] = texto(conciliador.nombre)
  }
  for (const [lado, clave] of [
    [PartySide.CLAIMANT, 'convocante'],
    [PartySide.RESPONDENT, 'convocado'],
  ] as const) {
    const delLado = d.personas.filter((p) => p.rol === CaseRole.PARTY && p.lado === lado)
    const principal = delLado.find((p) => p.calidad !== PartyCapacity.ATTORNEY) ?? delLado[0]
    const apoderado = delLado.find((p) => p.calidad === PartyCapacity.ATTORNEY)
    if (principal) {
      v[`partes.${clave}.nombre`] = texto(nombre(principal))
      const doc = documento(deParticipante(principal.id))
      if (doc) v[`partes.${clave}.documento`] = texto(doc)
    }
    if (apoderado) {
      v[`partes.${clave}.apoderado`] = texto(nombre(apoderado))
    }
  }
  v.participantes = lista(d.personas.map((p) => objeto({ nombre: texto(nombre(p)), calidad: texto(calidad(p)) })))

  const montos = aceptadas(d.entidades?.amounts)
  const primero = montos[0]?.value.case === 'amount' ? montos[0].value.value : undefined
  if (primero?.amount) {
    v['acuerdo.monto'] = dinero(primero.amount)
    v['pretensiones.cuantia'] = dinero(primero.amount)
  }
  const plazos = aceptadas(d.entidades?.deadlines).flatMap((e) => (e.value.case === 'deadline' ? [e.value.value] : []))
  if (primero && primero.installments > 1) {
    v['acuerdo.cuotas'] = entero(primero.installments)
    v['acuerdo.plan'] = lista(
      Array.from({ length: primero.installments }, (_, i) => {
        const campos: Valores = {}
        if (primero.installmentAmount) campos.valor = dinero(primero.installmentAmount)
        const cuando = plazos.find((p) => p.installmentNumber === i + 1)?.dueDate
        if (cuando) campos.fecha = fecha(cuando)
        return objeto(campos)
      }),
    )
  }
  const pago = plazos.find((p) => p.dueDate && p.installmentNumber <= 1)?.dueDate
  if (pago) {
    v['acuerdo.fecha_pago'] = fecha(pago)
  }
  const penal = aceptadas(d.entidades?.penalties).find((e) => e.value.case === 'penalty' && e.value.value.fixedAmount)
  if (penal?.value.case === 'penalty' && penal.value.value.fixedAmount) {
    v['acuerdo.clausula_penal'] = dinero(penal.value.value.fixedAmount)
  }
  const compromisos = aceptadas(d.entidades?.commitments).flatMap((e) =>
    e.value.case === 'commitment' ? [e.value.value] : [],
  )
  if (compromisos.length > 0) {
    const responsable = (i: number) => {
      const e = d.entidades?.parties[i]
      return e?.value.case === 'party' ? e.value.value.fullName : ''
    }
    v.compromisos = lista(
      compromisos.map((c) => {
        const campos: Valores = { descripcion: texto(c.object) }
        const quien = responsable(c.obligorPartyIndex)
        if (quien) campos.responsable = texto(quien)
        if (c.dueDate) campos.fecha = fecha(c.dueDate)
        return objeto(campos)
      }),
    )
  }
  return v
}

/** Valor que escribe la persona en el formulario, segun el tipo de la variable. */
export function valorManual(tipo: 'texto' | 'dinero' | 'fecha' | 'entero' | 'si-no', crudo: string): TemplateValue | null {
  const limpio = crudo.trim()
  if (!limpio) return null
  switch (tipo) {
    case 'dinero': {
      const digitos = limpio.replace(/[^\d]/g, '')
      return digitos ? dinero(create(MoneySchema, { currencyCode: 'COP', units: BigInt(digitos.slice(0, 15)) })) : null
    }
    case 'fecha': {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(limpio)
      return m ? fecha(create(CalendarDateSchema, { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) })) : null
    }
    case 'entero': {
      const n = Number.parseInt(limpio, 10)
      return Number.isFinite(n) ? entero(n) : null
    }
    case 'si-no':
      return create(TemplateValueSchema, { kind: { case: 'boolean', value: limpio === 'si' } })
    default:
      return texto(limpio.slice(0, 2000))
  }
}
