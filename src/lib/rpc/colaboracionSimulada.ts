import 'server-only'
import { create } from '@bufbuild/protobuf'
import { timestampNow } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError, type ConnectRouter, type HandlerContext } from '@connectrpc/connect'
import { CaseRole } from '@/gen/actaflow/cases/v1/case_pb'
import {
  CollaborationService,
  EncryptedUpdateSchema,
  SequencedUpdateSchema,
  type SequencedUpdate,
} from '@/gen/actaflow/collaboration/v1/collaboration_pb'
import type { EncryptedBlob } from '@/gen/actaflow/crypto/v1/crypto_pb'
import { MinuteState } from '@/gen/actaflow/minutes/v1/minute_pb'
import { actaSimulada } from './actasSimuladas'

/**
 * CollaborationService SIMULADO (solo ACTAFLOW_RPC_MODE=mock), con las reglas de legal-case: orden
 * total por acta, idempotente por update_id, editan conciliador y asistentes y solo en borrador.
 */

type Borrador = {
  ultima: number
  cambios: SequencedUpdate[]
  vistos: Map<string, number>
  foto: { blob: EncryptedBlob; cubre: number } | null
}

declare global {
  var __actaflowBorradoresSimulados: Map<string, Borrador> | undefined
}

function borrador(actaId: string): Borrador {
  globalThis.__actaflowBorradoresSimulados ??= new Map()
  const mapa = globalThis.__actaflowBorradoresSimulados
  let b = mapa.get(actaId)
  if (!b) {
    b = { ultima: 0, cambios: [], vistos: new Map(), foto: null }
    mapa.set(actaId, b)
  }
  return b
}

export function reiniciarColaboracionSimulada(): void {
  globalThis.__actaflowBorradoresSimulados = new Map()
}

function redactor(contexto: HandlerContext, actaId: string) {
  const { acta, yo } = actaSimulada(contexto, actaId)
  if (yo.rol !== CaseRole.CONCILIATOR && yo.rol !== CaseRole.ASSISTANT) {
    throw new ConnectError('Solo el conciliador y los asistentes editan el borrador', Code.PermissionDenied)
  }
  return { acta, yo }
}

export function registrarColaboracionSimulada(router: ConnectRouter): void {
  router.service(CollaborationService, {
    getDocumentState(p, contexto) {
      actaSimulada(contexto, p.minuteId)
      const b = borrador(p.minuteId)
      const atras = Number(p.afterSequence) < (b.foto?.cubre ?? 0)
      const desde = atras && b.foto ? b.foto.cubre : Number(p.afterSequence)
      return {
        snapshot: atras ? b.foto?.blob : undefined,
        snapshotSequence: BigInt(atras ? (b.foto?.cubre ?? 0) : 0),
        updates: b.cambios.filter((c) => Number(c.sequence) > desde).slice(0, 500),
      }
    },
    pushUpdates(p, contexto) {
      const { acta, yo } = redactor(contexto, p.minuteId)
      const b = borrador(p.minuteId)
      const secuencias: bigint[] = []
      for (const u of p.updates) {
        const ya = b.vistos.get(u.updateId)
        if (ya !== undefined) {
          secuencias.push(BigInt(ya))
          continue
        }
        if (acta.contrato.state !== MinuteState.DRAFT) {
          throw new ConnectError('El acta ya se cerró: el borrador no admite cambios', Code.FailedPrecondition)
        }
        b.ultima += 1
        b.vistos.set(u.updateId, b.ultima)
        b.cambios.push(
          create(SequencedUpdateSchema, {
            update: create(EncryptedUpdateSchema, u),
            sequence: BigInt(b.ultima),
            authorParticipantId: yo.id,
            receivedAt: timestampNow(),
          }),
        )
        secuencias.push(BigInt(b.ultima))
      }
      return { sequences: secuencias }
    },
    compactDocument(p, contexto) {
      redactor(contexto, p.minuteId)
      const b = borrador(p.minuteId)
      const cubre = Number(p.coversSequence)
      if (cubre > b.ultima) {
        throw new ConnectError('La instantánea cubre cambios que aún no existen', Code.FailedPrecondition)
      }
      if (!p.snapshot || cubre <= (b.foto?.cubre ?? 0)) return { removedUpdates: 0n }
      const antes = b.cambios.length
      b.cambios = b.cambios.filter((c) => Number(c.sequence) > cubre)
      b.foto = { blob: p.snapshot, cubre }
      return { removedUpdates: BigInt(antes - b.cambios.length) }
    },
  })
}
