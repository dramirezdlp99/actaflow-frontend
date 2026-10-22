import 'server-only'
import { randomUUID } from 'node:crypto'
import { create, equals } from '@bufbuild/protobuf'
import { timestampFromMs, timestampMs } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError, type ConnectRouter, type HandlerContext } from '@connectrpc/connect'
import {
  CaseEventKind,
  CaseEventSchema,
  CaseMembershipSchema,
  CaseRole,
  CaseService,
  CaseStatus,
  ChangeCaseStatusResponseSchema,
  CreateCaseResponseSchema,
  LegalCaseSchema,
  UpdateCaseResponseSchema,
  type CaseEvent,
  type ChangeCaseStatusResponse,
  type CreateCaseResponse,
  type UpdateCaseResponse,
  type CaseKind,
  type LegalCase,
} from '@/gen/actaflow/cases/v1/case_pb'
import {
  InviteParticipantResponseSchema,
  ParticipantSchema,
  ParticipantService,
  ParticipantState,
  PartyCapacity,
  PartySide,
  type InviteParticipantResponse,
  type Participant,
} from '@/gen/actaflow/cases/v1/participant_pb'
import { EncryptedBlobSchema, type EncryptedBlob, type WrappedKey } from '@/gen/actaflow/crypto/v1/crypto_pb'
import { PlatformRole } from '@/gen/actaflow/identity/v1/account_pb'
import { cuentaDeTokenSimulado } from './identidadSimulada'

/**
 * legal-case-service SIMULADO en memoria (solo ACTAFLOW_RPC_MODE=mock), con las mismas reglas que
 * el servicio Java: NOT_FOUND para quien no participa, idempotencia, concurrencia optimista,
 * transiciones de estado, vinculacion de invitaciones por correo y al menos un conciliador.
 */

type Persona = {
  id: string
  cuentaId: string | null
  correo: string
  nombre: string
  rol: CaseRole
  lado: PartySide
  calidad: PartyCapacity
  clave: WrappedKey | null
  invitado: number
  unido: number | null
}

type Caso = {
  id: string
  organizacion: string
  radicado: string
  tipo: CaseKind
  estado: CaseStatus
  detalles: EncryptedBlob
  audiencia: number | null
  revision: bigint
  creado: number
  actividad: number
  personas: Persona[]
  eventos: CaseEvent[]
}

type Respuestas = {
  CreateCase: Map<string, CreateCaseResponse>
  UpdateCase: Map<string, UpdateCaseResponse>
  ChangeCaseStatus: Map<string, ChangeCaseStatusResponse>
  InviteParticipant: Map<string, InviteParticipantResponse>
}

type Estado = { casos: Map<string, Caso>; operaciones: Map<string, keyof Respuestas>; respuestas: Respuestas }

function vacio(): Estado {
  return {
    casos: new Map(),
    operaciones: new Map(),
    respuestas: {
      CreateCase: new Map(),
      UpdateCase: new Map(),
      ChangeCaseStatus: new Map(),
      InviteParticipant: new Map(),
    },
  }
}

declare global {
  var __actaflowExpedientesSimulados: Estado | undefined
}

function estado(): Estado {
  globalThis.__actaflowExpedientesSimulados ??= vacio()
  return globalThis.__actaflowExpedientesSimulados
}

export function reiniciarExpedientesSimulados(): void {
  globalThis.__actaflowExpedientesSimulados = vacio()
}

const TRANSICIONES: Record<CaseStatus, CaseStatus[]> = {
  [CaseStatus.UNSPECIFIED]: [],
  [CaseStatus.OPEN]: [CaseStatus.IN_HEARING, CaseStatus.ARCHIVED],
  [CaseStatus.IN_HEARING]: [CaseStatus.OPEN, CaseStatus.AGREEMENT, CaseStatus.NO_AGREEMENT],
  [CaseStatus.AGREEMENT]: [CaseStatus.ARCHIVED],
  [CaseStatus.NO_AGREEMENT]: [CaseStatus.OPEN, CaseStatus.ARCHIVED],
  [CaseStatus.ARCHIVED]: [],
}

type Usuario = NonNullable<ReturnType<typeof cuentaDeTokenSimulado>>

function usuario(contexto: HandlerContext): Usuario {
  const cabecera = contexto.requestHeader.get('authorization') ?? ''
  const quien = cabecera.startsWith('Bearer ') ? cuentaDeTokenSimulado(cabecera.slice(7)) : null
  if (!quien) {
    throw new ConnectError('Sesion vencida o no valida', Code.Unauthenticated)
  }
  return quien
}

const fallo = (mensaje: string, codigo: Code) => new ConnectError(mensaje, codigo)
const noEncontrado = () => fallo('Expediente no encontrado', Code.NotFound)

/** Vincula invitaciones pendientes por correo (misma organizacion), como el servicio Java. */
function vincular(quien: Usuario): void {
  for (const caso of estado().casos.values()) {
    if (caso.organizacion !== quien.organizacion || caso.personas.some((p) => p.cuentaId === quien.id)) {
      continue
    }
    const pendiente = caso.personas.find((p) => p.cuentaId === null && p.correo === quien.correo)
    if (pendiente) {
      pendiente.cuentaId = quien.id
      pendiente.nombre = quien.nombre || pendiente.nombre
      pendiente.unido = Date.now()
    }
  }
}

function miembro(quien: Usuario, casoId: string): { caso: Caso; yo: Persona } {
  vincular(quien)
  const caso = estado().casos.get(casoId)
  const yo = caso?.personas.find((p) => p.cuentaId === quien.id)
  if (!caso || !yo) {
    throw noEncontrado()
  }
  return { caso, yo }
}

/** Para el legal-case simulado de audiencias: quien llama, su rol y los participantes del caso. */
export function miembroSimulado(contexto: HandlerContext, casoId: string) {
  const { caso, yo } = miembro(usuario(contexto), casoId)
  return {
    yo: { id: yo.id, rol: yo.rol },
    estado: caso.estado,
    participantes: caso.personas.map((p) => ({ id: p.id, nombre: p.nombre })),
    registrar: (tipo: CaseEventKind) => evento(caso, tipo, yo),
  }
}

function exigirConciliador(yo: Persona): void {
  if (yo.rol !== CaseRole.CONCILIATOR) {
    throw fallo('Solo un conciliador del caso puede hacer esto', Code.PermissionDenied)
  }
}

function exigirAbierto(caso: Caso): void {
  if (caso.estado === CaseStatus.ARCHIVED) {
    throw fallo('El expediente esta archivado y es de solo lectura', Code.FailedPrecondition)
  }
}

function evento(caso: Caso, tipo: CaseEventKind, actor: Persona): void {
  const ahora = Date.now()
  caso.eventos.unshift(
    create(CaseEventSchema, {
      id: randomUUID(),
      kind: tipo,
      occurredAt: timestampFromMs(ahora),
      actorParticipantId: actor.id,
      actorDisplayName: actor.nombre,
    }),
  )
  caso.actividad = Math.max(caso.actividad, ahora)
}

function contrato(caso: Caso): LegalCase {
  return create(LegalCaseSchema, {
    id: caso.id,
    organizationId: caso.organizacion,
    caseNumber: caso.radicado,
    kind: caso.tipo,
    status: caso.estado,
    details: caso.detalles,
    scheduledHearingAt: caso.audiencia === null ? undefined : timestampFromMs(caso.audiencia),
    participantCount: caso.personas.length,
    createdAt: timestampFromMs(caso.creado),
    lastActivityAt: timestampFromMs(caso.actividad),
    revision: caso.revision,
  })
}

function persona(p: Persona): Participant {
  const estadoPersona =
    p.cuentaId === null
      ? ParticipantState.INVITED
      : p.clave === null
        ? ParticipantState.AWAITING_KEY
        : ParticipantState.ACTIVE
  return create(ParticipantSchema, {
    id: p.id,
    accountId: p.cuentaId ?? '',
    displayName: p.nombre,
    email: p.correo,
    role: p.rol,
    side: p.lado,
    capacity: p.calidad,
    state: estadoPersona,
    joinedAt: p.unido === null ? undefined : timestampFromMs(p.unido),
  })
}

function membresia(yo: Persona) {
  return create(CaseMembershipSchema, { participantId: yo.id, role: yo.rol, wrappedCaseKey: yo.clave ?? undefined })
}

/** Misma clave de la misma cuenta = misma respuesta; en otra operacion, error del cliente. */
function idempotente<K extends keyof Respuestas, T>(
  quien: Usuario,
  clave: string,
  operacion: K,
  guardadas: Map<string, T>,
  hacer: () => T,
): T {
  const id = `${quien.id}/${clave}`
  const anterior = estado().operaciones.get(id)
  if (anterior && anterior !== operacion) {
    throw fallo('Esa clave de idempotencia ya se uso en otra operacion', Code.InvalidArgument)
  }
  const previa = guardadas.get(id)
  if (previa) {
    return previa
  }
  const respuesta = hacer()
  estado().operaciones.set(id, operacion)
  guardadas.set(id, respuesta)
  return respuesta
}

function pagina<T>(lista: T[], tamano: number, token: string): { items: T[]; siguiente: string } {
  const desde = token ? Number.parseInt(Buffer.from(token, 'base64url').toString().slice(2), 10) : 0
  if (!Number.isInteger(desde) || desde < 0) {
    throw fallo('page_token no valido', Code.InvalidArgument)
  }
  const items = lista.slice(desde, desde + tamano)
  const siguiente = lista.length > desde + tamano ? Buffer.from(`o:${desde + tamano}`).toString('base64url') : ''
  return { items, siguiente }
}

export function registrarExpedientesSimulados(router: ConnectRouter): void {
  router.service(CaseService, {
    createCase(peticion, contexto) {
      const quien = usuario(contexto)
      if (quien.rol === PlatformRole.EXTERNAL) {
        throw fallo('Las cuentas externas no crean expedientes', Code.PermissionDenied)
      }
      if (!peticion.details || !peticion.wrappedCaseKey) {
        throw fallo('La peticion no cumple el contrato', Code.InvalidArgument)
      }
      const detalles = peticion.details
      const clave = peticion.wrappedCaseKey
      return idempotente(quien, peticion.idempotencyKey, 'CreateCase', estado().respuestas.CreateCase, () => {
        const repetido = [...estado().casos.values()].some(
          (c) => c.organizacion === quien.organizacion && c.radicado === peticion.caseNumber,
        )
        if (repetido) {
          throw fallo('Ya existe un expediente con ese radicado', Code.AlreadyExists)
        }
        const ahora = Date.now()
        const yo: Persona = {
          id: randomUUID(),
          cuentaId: quien.id,
          correo: quien.correo,
          nombre: quien.nombre,
          rol: CaseRole.CONCILIATOR,
          lado: PartySide.UNSPECIFIED,
          calidad: PartyCapacity.UNSPECIFIED,
          clave,
          invitado: ahora,
          unido: ahora,
        }
        const caso: Caso = {
          id: randomUUID(),
          organizacion: quien.organizacion,
          radicado: peticion.caseNumber,
          tipo: peticion.kind,
          estado: CaseStatus.OPEN,
          detalles,
          audiencia: peticion.scheduledHearingAt ? timestampMs(peticion.scheduledHearingAt) : null,
          revision: 1n,
          creado: ahora,
          actividad: ahora,
          personas: [yo],
          eventos: [],
        }
        evento(caso, CaseEventKind.CREATED, yo)
        estado().casos.set(caso.id, caso)
        return create(CreateCaseResponseSchema, { legalCase: contrato(caso), membership: membresia(yo) })
      })
    },
    getCase(peticion, contexto) {
      const { caso, yo } = miembro(usuario(contexto), peticion.caseId)
      return { legalCase: contrato(caso), membership: membresia(yo) }
    },
    listCases(peticion, contexto) {
      const quien = usuario(contexto)
      vincular(quien)
      const mios = [...estado().casos.values()]
        .filter((c) => c.personas.some((p) => p.cuentaId === quien.id))
        .filter((c) => peticion.status === CaseStatus.UNSPECIFIED || c.estado === peticion.status)
        .sort((a, b) => b.actividad - a.actividad)
      const { items, siguiente } = pagina(mios, peticion.page?.pageSize ?? 20, peticion.page?.pageToken ?? '')
      return {
        cases: items.map((c) => ({
          legalCase: contrato(c),
          role: c.personas.find((p) => p.cuentaId === quien.id)?.rol ?? CaseRole.UNSPECIFIED,
        })),
        pageInfo: { nextPageToken: siguiente },
      }
    },
    updateCase(peticion, contexto) {
      const quien = usuario(contexto)
      if (!peticion.details && !peticion.scheduledHearingAt) {
        throw fallo('No hay cambios: envia details o scheduled_hearing_at', Code.InvalidArgument)
      }
      return idempotente(quien, peticion.idempotencyKey, 'UpdateCase', estado().respuestas.UpdateCase, () => {
        const { caso, yo } = miembro(quien, peticion.caseId)
        if (yo.rol === CaseRole.PARTY) {
          throw fallo('Las partes no editan el expediente', Code.PermissionDenied)
        }
        exigirAbierto(caso)
        if (caso.revision !== peticion.expectedRevision) {
          throw fallo('Alguien mas cambio el expediente. Recarga y vuelve a intentarlo', Code.Aborted)
        }
        if (peticion.details && !equals(EncryptedBlobSchema, peticion.details, caso.detalles)) {
          caso.detalles = peticion.details
        }
        if (peticion.scheduledHearingAt) {
          caso.audiencia = timestampMs(peticion.scheduledHearingAt)
        }
        caso.revision += 1n
        caso.actividad = Date.now()
        return create(UpdateCaseResponseSchema, { legalCase: contrato(caso) })
      })
    },
    changeCaseStatus(peticion, contexto) {
      const quien = usuario(contexto)
      return idempotente(
        quien,
        peticion.idempotencyKey,
        'ChangeCaseStatus',
        estado().respuestas.ChangeCaseStatus,
        () => {
          const { caso, yo } = miembro(quien, peticion.caseId)
          exigirConciliador(yo)
          if (!TRANSICIONES[caso.estado].includes(peticion.status)) {
            throw fallo(
              `No se puede pasar de ${CaseStatus[caso.estado]} a ${CaseStatus[peticion.status]}`,
              Code.FailedPrecondition,
            )
          }
          const antes = caso.estado
          caso.estado = peticion.status
          caso.revision += 1n
          evento(caso, CaseEventKind.STATUS_CHANGED, yo)
          if (peticion.status === CaseStatus.IN_HEARING) {
            evento(caso, CaseEventKind.HEARING_STARTED, yo)
          } else if (antes === CaseStatus.IN_HEARING) {
            evento(caso, CaseEventKind.HEARING_ENDED, yo)
          }
          return create(ChangeCaseStatusResponseSchema, { legalCase: contrato(caso) })
        },
      )
    },
    listCaseEvents(peticion, contexto) {
      const { caso } = miembro(usuario(contexto), peticion.caseId)
      const { items, siguiente } = pagina(caso.eventos, peticion.page?.pageSize ?? 20, peticion.page?.pageToken ?? '')
      return { events: items, pageInfo: { nextPageToken: siguiente } }
    },
  })

  router.service(ParticipantService, {
    listParticipants(peticion, contexto) {
      const { caso } = miembro(usuario(contexto), peticion.caseId)
      return { participants: caso.personas.map(persona) }
    },
    inviteParticipant(peticion, contexto) {
      const quien = usuario(contexto)
      return idempotente(
        quien,
        peticion.idempotencyKey,
        'InviteParticipant',
        estado().respuestas.InviteParticipant,
        () => {
          const { caso, yo } = miembro(quien, peticion.caseId)
          exigirConciliador(yo)
          exigirAbierto(caso)
          const esParte = peticion.role === CaseRole.PARTY
          const completa = peticion.side !== PartySide.UNSPECIFIED && peticion.capacity !== PartyCapacity.UNSPECIFIED
          const vacia = peticion.side === PartySide.UNSPECIFIED && peticion.capacity === PartyCapacity.UNSPECIFIED
          if (esParte ? !completa : !vacia) {
            throw fallo('parties need side and capacity; other roles must not set them', Code.InvalidArgument)
          }
          const correo = peticion.email.trim().toLowerCase()
          if (caso.personas.some((p) => p.correo === correo)) {
            throw fallo('Esa persona ya esta en el caso', Code.AlreadyExists)
          }
          const nueva: Persona = {
            id: randomUUID(),
            cuentaId: null,
            correo,
            nombre: peticion.displayName.trim(),
            rol: peticion.role,
            lado: peticion.side,
            calidad: peticion.capacity,
            clave: peticion.wrappedCaseKey ?? null,
            invitado: Date.now(),
            unido: null,
          }
          caso.personas.push(nueva)
          evento(caso, CaseEventKind.PARTICIPANT_ADDED, yo)
          return create(InviteParticipantResponseSchema, { participant: persona(nueva) })
        },
      )
    },
    grantCaseKey(peticion, contexto) {
      const { caso, yo } = miembro(usuario(contexto), peticion.caseId)
      if (!yo.clave) {
        throw fallo('Aun no tienes la clave de este caso', Code.FailedPrecondition)
      }
      exigirAbierto(caso)
      const destino = caso.personas.find((p) => p.id === peticion.participantId)
      if (!destino) {
        throw fallo('Participante no encontrado en este caso', Code.NotFound)
      }
      if (destino.cuentaId === null) {
        throw fallo('Esa persona aun no ha entrado con su cuenta', Code.FailedPrecondition)
      }
      destino.clave = peticion.wrappedCaseKey ?? null
      caso.actividad = Date.now()
      return { participant: persona(destino) }
    },
    changeParticipantRole(peticion, contexto) {
      const { caso, yo } = miembro(usuario(contexto), peticion.caseId)
      exigirConciliador(yo)
      exigirAbierto(caso)
      const destino = caso.personas.find((p) => p.id === peticion.participantId)
      if (!destino) {
        throw fallo('Participante no encontrado en este caso', Code.NotFound)
      }
      if (destino.rol === CaseRole.PARTY || peticion.role === CaseRole.PARTY) {
        throw fallo(
          'Las partes no cambian de rol: retirala e invitala de nuevo con su lado y calidad',
          Code.FailedPrecondition,
        )
      }
      const conciliadores = caso.personas.filter((p) => p.rol === CaseRole.CONCILIATOR).length
      if (destino.rol === CaseRole.CONCILIATOR && peticion.role !== CaseRole.CONCILIATOR && conciliadores <= 1) {
        throw fallo('El caso debe conservar al menos un conciliador', Code.FailedPrecondition)
      }
      destino.rol = peticion.role
      return { participant: persona(destino) }
    },
    removeParticipant(peticion, contexto) {
      const { caso, yo } = miembro(usuario(contexto), peticion.caseId)
      exigirConciliador(yo)
      exigirAbierto(caso)
      const destino = caso.personas.find((p) => p.id === peticion.participantId)
      if (!destino) {
        throw fallo('Participante no encontrado en este caso', Code.NotFound)
      }
      const conciliadores = caso.personas.filter((p) => p.rol === CaseRole.CONCILIATOR).length
      if (destino.rol === CaseRole.CONCILIATOR && conciliadores <= 1) {
        throw fallo('El caso debe conservar al menos un conciliador', Code.FailedPrecondition)
      }
      caso.personas = caso.personas.filter((p) => p.id !== destino.id)
      caso.actividad = Date.now()
      return {}
    },
  })
}
