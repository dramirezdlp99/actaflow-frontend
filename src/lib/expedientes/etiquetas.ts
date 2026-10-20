import { CaseEventKind, CaseKind, CaseRole, CaseStatus } from '@/gen/actaflow/cases/v1/case_pb'
import { ParticipantState, PartyCapacity, PartySide } from '@/gen/actaflow/cases/v1/participant_pb'

/** Nombres para personas de los enums del contrato. Exhaustivos: si el contrato agrega un valor, TypeScript avisa aqui. */

export const TIPO: Record<CaseKind, string> = {
  [CaseKind.UNSPECIFIED]: 'Sin tipo',
  [CaseKind.CONCILIATION]: 'Conciliación',
  [CaseKind.MEDIATION]: 'Mediación',
  [CaseKind.CONTRACT]: 'Contrato',
}

export const ESTADO: Record<CaseStatus, string> = {
  [CaseStatus.UNSPECIFIED]: 'Sin estado',
  [CaseStatus.OPEN]: 'Abierto',
  [CaseStatus.IN_HEARING]: 'En audiencia',
  [CaseStatus.AGREEMENT]: 'Acuerdo',
  [CaseStatus.NO_AGREEMENT]: 'Sin acuerdo',
  [CaseStatus.ARCHIVED]: 'Archivado',
}

/** Clase de color del sello de estado (tokens del sistema de diseno). */
export const TONO_ESTADO: Record<CaseStatus, string> = {
  [CaseStatus.UNSPECIFIED]: 'text-tinta-suave border-linea',
  [CaseStatus.OPEN]: 'text-institucional border-institucional/40',
  [CaseStatus.IN_HEARING]: 'text-ia border-ia/40',
  [CaseStatus.AGREEMENT]: 'text-exito border-exito/40',
  [CaseStatus.NO_AGREEMENT]: 'text-alerta border-alerta/40',
  [CaseStatus.ARCHIVED]: 'text-tinta-suave border-linea',
}

export const ROL: Record<CaseRole, string> = {
  [CaseRole.UNSPECIFIED]: 'Sin rol',
  [CaseRole.CONCILIATOR]: 'Conciliador',
  [CaseRole.ASSISTANT]: 'Asistente',
  [CaseRole.PARTY]: 'Parte',
}

export const LADO: Record<PartySide, string> = {
  [PartySide.UNSPECIFIED]: '',
  [PartySide.CLAIMANT]: 'Convocante',
  [PartySide.RESPONDENT]: 'Convocado',
}

export const CALIDAD: Record<PartyCapacity, string> = {
  [PartyCapacity.UNSPECIFIED]: '',
  [PartyCapacity.PRINCIPAL]: 'en nombre propio',
  [PartyCapacity.ATTORNEY]: 'apoderado',
}

export const ESTADO_PERSONA: Record<ParticipantState, string> = {
  [ParticipantState.UNSPECIFIED]: 'Sin estado',
  [ParticipantState.INVITED]: 'Invitado: aún no entra',
  [ParticipantState.AWAITING_KEY]: 'Esperando la clave del caso',
  [ParticipantState.ACTIVE]: 'Activo',
}

export const EVENTO: Record<CaseEventKind, string> = {
  [CaseEventKind.UNSPECIFIED]: 'Evento',
  [CaseEventKind.CREATED]: 'abrió el expediente',
  [CaseEventKind.PARTICIPANT_ADDED]: 'invitó a una persona',
  [CaseEventKind.HEARING_STARTED]: 'inició la audiencia',
  [CaseEventKind.HEARING_ENDED]: 'cerró la audiencia',
  [CaseEventKind.MINUTE_CREATED]: 'creó la minuta',
  [CaseEventKind.DOCUMENT_SEALED]: 'selló el documento',
  [CaseEventKind.DOCUMENT_ACCEPTED]: 'aceptó el documento',
  [CaseEventKind.STATUS_CHANGED]: 'cambió el estado',
  [CaseEventKind.ATTACHMENT_ADDED]: 'agregó un anexo',
}

/** Las mismas transiciones que valida legal-case-service, con el texto del boton. */
export const TRANSICIONES: Record<CaseStatus, { a: CaseStatus; texto: string }[]> = {
  [CaseStatus.UNSPECIFIED]: [],
  [CaseStatus.OPEN]: [
    { a: CaseStatus.IN_HEARING, texto: 'Iniciar audiencia' },
    { a: CaseStatus.ARCHIVED, texto: 'Archivar' },
  ],
  [CaseStatus.IN_HEARING]: [
    { a: CaseStatus.AGREEMENT, texto: 'Hubo acuerdo' },
    { a: CaseStatus.NO_AGREEMENT, texto: 'No hubo acuerdo' },
    { a: CaseStatus.OPEN, texto: 'Suspender audiencia' },
  ],
  [CaseStatus.AGREEMENT]: [{ a: CaseStatus.ARCHIVED, texto: 'Archivar' }],
  [CaseStatus.NO_AGREEMENT]: [
    { a: CaseStatus.OPEN, texto: 'Reabrir' },
    { a: CaseStatus.ARCHIVED, texto: 'Archivar' },
  ],
  [CaseStatus.ARCHIVED]: [],
}

/** Filtros de la lista: el valor va en la URL (?estado=...). */
type Filtro = { valor: string; estado: CaseStatus; texto: string }
const TODOS: Filtro = { valor: '', estado: CaseStatus.UNSPECIFIED, texto: 'Todos' }

export const FILTROS: Filtro[] = [
  TODOS,
  { valor: 'abiertos', estado: CaseStatus.OPEN, texto: 'Abiertos' },
  { valor: 'en-audiencia', estado: CaseStatus.IN_HEARING, texto: 'En audiencia' },
  { valor: 'acuerdo', estado: CaseStatus.AGREEMENT, texto: 'Acuerdo' },
  { valor: 'sin-acuerdo', estado: CaseStatus.NO_AGREEMENT, texto: 'Sin acuerdo' },
  { valor: 'archivados', estado: CaseStatus.ARCHIVED, texto: 'Archivados' },
]

export function filtroDe(valor: string | undefined): Filtro {
  return FILTROS.find((f) => f.valor === valor) ?? TODOS
}
