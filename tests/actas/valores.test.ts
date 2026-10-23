// @vitest-environment node
import { create } from '@bufbuild/protobuf'
import { describe, expect, it } from 'vitest'
import { CaseRole } from '@/gen/actaflow/cases/v1/case_pb'
import { PartyCapacity, PartySide } from '@/gen/actaflow/cases/v1/participant_pb'
import {
  DocumentType,
  EntityExtractionResultSchema,
  LegalEntitySchema,
  ReviewState,
} from '@/gen/actaflow/legal/v1/entities_pb'
import { valoresAutomaticos, valorManual, type PersonaActa } from '@/lib/actas/valores'
import { analizar, html } from '@/lib/rpc/lenguajeSimulado'

const persona = (id: string, nombre: string, rol: CaseRole, lado = PartySide.UNSPECIFIED, calidad = PartyCapacity.PRINCIPAL): PersonaActa => ({
  id,
  nombre,
  rol,
  lado,
  calidad,
})

const personas = [
  persona('c1', 'Laura Conciliadora', CaseRole.CONCILIATOR),
  persona('p1', 'Ana', CaseRole.PARTY, PartySide.CLAIMANT),
  persona('p2', 'Bruno', CaseRole.PARTY, PartySide.RESPONDENT),
  persona('p3', 'Dra. Gómez', CaseRole.PARTY, PartySide.CLAIMANT, PartyCapacity.ATTORNEY),
]

const entidades = create(EntityExtractionResultSchema, {
  parties: [
    create(LegalEntitySchema, {
      id: 'e1',
      review: ReviewState.CORRECTED,
      value: { case: 'party', value: { fullName: 'Ana María Pérez', participantId: 'p1', documentType: DocumentType.CEDULA_CIUDADANIA, documentNumber: '52000000' } },
    }),
    create(LegalEntitySchema, { id: 'e2', review: ReviewState.REJECTED, value: { case: 'party', value: { fullName: 'Nexus', participantId: 'p2' } } }),
  ],
  amounts: [
    create(LegalEntitySchema, { id: 'm0', value: { case: 'amount', value: { amount: { currencyCode: 'COP', units: 9n } } } }),
    create(LegalEntitySchema, {
      id: 'm1',
      review: ReviewState.CONFIRMED,
      value: { case: 'amount', value: { amount: { currencyCode: 'COP', units: 1_500_000n }, installments: 3, installmentAmount: { currencyCode: 'COP', units: 500_000n } } },
    }),
  ],
  deadlines: [
    create(LegalEntitySchema, { id: 'd1', review: ReviewState.CONFIRMED, value: { case: 'deadline', value: { dueDate: { year: 2026, month: 11, day: 30 }, installmentNumber: 1 } } }),
  ],
  commitments: [
    create(LegalEntitySchema, {
      id: 'k1',
      review: ReviewState.CONFIRMED,
      value: { case: 'commitment', value: { object: 'entregar las llaves', obligorPartyIndex: 0, dueDate: { year: 2026, month: 12, day: 1 } } },
    }),
  ],
})

describe('autollenado del acta', () => {
  it('usa solo lo revisado: nombres corregidos, documento, monto confirmado, cuotas y compromisos', () => {
    const v = valoresAutomaticos({ radicado: 'CC-2026-0700', personas, audiencia: new Date(2026, 9, 23), entidades })
    expect(v['partes.convocante.nombre']?.kind).toEqual({ case: 'text', value: 'Ana María Pérez' })
    expect(v['partes.convocante.documento']?.kind).toEqual({ case: 'text', value: 'C.C. 52000000' })
    expect(v['partes.convocante.apoderado']?.kind).toEqual({ case: 'text', value: 'Dra. Gómez' })
    expect(v['partes.convocado.nombre']?.kind, 'la entidad descartada no cuenta').toEqual({ case: 'text', value: 'Bruno' })
    expect(v['acuerdo.monto']?.kind.case === 'money' && v['acuerdo.monto'].kind.value.units).toBe(1_500_000n)
    expect(v['acuerdo.cuotas']?.kind).toEqual({ case: 'integer', value: 3n })
    expect(v['acuerdo.plan']?.kind.case === 'list' && v['acuerdo.plan'].kind.value.items).toHaveLength(3)
    expect(v['acuerdo.fecha_pago']?.kind.case).toBe('date')
    expect(v['conciliador.nombre']?.kind).toEqual({ case: 'text', value: 'Laura Conciliadora' })

    const { nodos } = analizar(
      '# ACTA {{ caso.radicado }}\n\n{% para cada compromiso en compromisos %}{{ compromiso.descripcion }} a cargo de {{ compromiso.responsable }}.{% fin %}',
    )
    expect(html(nodos, v)).toContain('entregar las llaves</span> a cargo de <span class="valor">Ana María Pérez')
  })

  it('sin entidades revisadas no inventa montos; lo manual se valida por tipo', () => {
    const v = valoresAutomaticos({ radicado: 'CC-1', personas, audiencia: null, entidades: null })
    expect(v['acuerdo.monto']).toBeUndefined()
    expect(v['audiencia.fecha']).toBeUndefined()
    expect(valorManual('dinero', '$ 2.000.000')?.kind.case).toBe('money')
    expect(valorManual('fecha', '30/11/2026')).toBeNull()
    expect(valorManual('texto', '   ')).toBeNull()
  })
})
