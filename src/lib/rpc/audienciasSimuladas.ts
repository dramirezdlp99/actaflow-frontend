import 'server-only'
import { randomUUID } from 'node:crypto'
import { create, fromBinary, toBinary } from '@bufbuild/protobuf'
import { timestampFromMs, timestampNow } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError, type ConnectRouter, type HandlerContext } from '@connectrpc/connect'
import { CaseEventKind, CaseRole, CaseStatus } from '@/gen/actaflow/cases/v1/case_pb'
import { MoneySchema } from '@/gen/actaflow/common/v1/values_pb'
import {
  ProcessorKeyService,
  ProcessorKind,
  type EncryptedBlob,
  type SealedEnvelope,
} from '@/gen/actaflow/crypto/v1/crypto_pb'
import { ExtractionInputSchema, SealedAudioSegmentSchema } from '@/gen/actaflow/engine/v1/engine_pb'
import {
  AudioSegmentSchema,
  EntityExtractionSchema,
  HearingSchema,
  HearingService,
  HearingState,
  ProcessingState,
  WatchHearingEventsResponseSchema,
  type AudioSegment,
  type EntityExtraction,
  type Hearing,
  type WatchHearingEventsResponse,
} from '@/gen/actaflow/hearings/v1/hearing_pb'
import {
  EntityExtractionResultSchema,
  HearingRole,
  LegalEntitySchema,
  MonetaryAmountSchema,
  PartyIdentificationSchema,
} from '@/gen/actaflow/legal/v1/entities_pb'
import { TranscriptionResultSchema } from '@/gen/actaflow/legal/v1/transcript_pb'
import { aHex } from '@/lib/cripto/bytes'
import { PROPOSITO, TIPO, procesarComoMotor } from '@/lib/audiencias/sellado'
import { miembroSimulado } from './expedientesSimulados'

/**
 * HearingService y ProcessorKeyService SIMULADOS (solo ACTAFLOW_RPC_MODE=mock), con un motor de IA
 * simulado que hace lo mismo que el real con los sobres: desenvuelve la clave de contenido con SU
 * clave privada, abre el audio y devuelve el resultado cifrado con esa misma clave. Solo la
 * "transcripcion" es de mentira (dice cuanto audio recibio). Asi el modo sin backend prueba de punta
 * a punta el cifrado del navegador.
 */

type Segmento = { contrato: AudioSegment; casoId: string; audio: SealedEnvelope | null }
type Extraccion = { contrato: EntityExtraction; casoId: string; entrada: SealedEnvelope | null }
type Evento = { secuencia: bigint; audienciaId: string; tipo: 'segmento' | 'extraccion' | 'fin'; recurso: string }
type Audiencia = { contrato: Hearing; casoId: string }

type Estado = {
  motor: Promise<{ privada: CryptoKey; publica: Uint8Array; id: string }>
  audiencias: Map<string, Audiencia>
  segmentos: Map<string, Segmento>
  extracciones: Map<string, Extraccion>
  eventos: Evento[]
  /** En el estado global y no en el modulo: Next carga copias distintas del modulo por ruta. */
  secuencia: bigint
  /** Retraso del motor simulado (las pruebas lo ponen en 0). */
  demoraMs: number
}

declare global {
  var __actaflowAudienciasSimuladas: Estado | undefined
}

async function nuevoMotor() {
  const par = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const publica = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey))
  const huella = aHex(new Uint8Array(await crypto.subtle.digest('SHA-256', publica)))
  return { privada: par.privateKey, publica, id: `motor:${huella.slice(0, 16)}` }
}

function vacio(): Estado {
  return {
    motor: nuevoMotor(),
    audiencias: new Map(),
    segmentos: new Map(),
    extracciones: new Map(),
    eventos: [],
    secuencia: 0n,
    demoraMs: 400,
  }
}

function estado(): Estado {
  globalThis.__actaflowAudienciasSimuladas ??= vacio()
  return globalThis.__actaflowAudienciasSimuladas
}

/** La clave del motor simulado (la usa tambien el legal-case simulado de actas). */
export function motorSimulado(): Estado['motor'] {
  return estado().motor
}

/** Retraso del motor simulado. */
export function demoraMotorSimulado(): number {
  return estado().demoraMs
}

export function reiniciarAudienciasSimuladas(demoraMs = 400): void {
  globalThis.__actaflowAudienciasSimuladas = { ...vacio(), demoraMs }
}

/** Espera a que el motor simulado termine todo lo encolado (para las pruebas). */
export async function esperarMotorSimulado(): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const ocupado = [...estado().segmentos.values(), ...estado().extracciones.values()].some(
      (x) => x.contrato.state === ProcessingState.QUEUED || x.contrato.state === ProcessingState.PROCESSING,
    )
    if (!ocupado) {
      return
    }
    await new Promise((r) => setTimeout(r, 5))
  }
}

const fallo = (mensaje: string, codigo: Code) => new ConnectError(mensaje, codigo)

function audienciaDe(contexto: HandlerContext, audienciaId: string) {
  const audiencia = estado().audiencias.get(audienciaId)
  if (!audiencia) {
    throw fallo('Audiencia no encontrada', Code.NotFound)
  }
  return { audiencia, ...miembroSimulado(contexto, audiencia.casoId) }
}

function exigirRedactor(rol: CaseRole): void {
  if (rol !== CaseRole.CONCILIATOR && rol !== CaseRole.ASSISTANT) {
    throw fallo('Solo un conciliador o un asistente del caso puede hacer esto', Code.PermissionDenied)
  }
}

function evento(audienciaId: string, tipo: Evento['tipo'], recurso: string): void {
  const e = estado()
  e.secuencia += 1n
  e.eventos.push({ secuencia: e.secuencia, audienciaId, tipo, recurso })
}

function resumen(audiencia: Audiencia): Hearing {
  const suyos = [...estado().segmentos.values()].filter((s) => s.contrato.hearingId === audiencia.contrato.id)
  return create(HearingSchema, {
    ...audiencia.contrato,
    segmentCount: suyos.length,
    audioDurationMs: suyos.reduce((n, s) => n + s.contrato.durationMs, 0n),
  })
}

/** El motor simulado: abre el sobre de verdad y devuelve un resultado cifrado con la misma clave. */
function procesarDespues(item: Segmento | Extraccion, audienciaId: string): void {
  const esSegmento = 'audio' in item
  setTimeout(async () => {
    const sobre = esSegmento ? item.audio : item.entrada
    item.contrato.state = ProcessingState.PROCESSING
    evento(audienciaId, esSegmento ? 'segmento' : 'extraccion', item.contrato.id)
    try {
      if (!sobre) {
        throw new Error('sin sobre')
      }
      const { privada } = await estado().motor
      const resultado: EncryptedBlob = await procesarComoMotor(
        privada,
        sobre,
        esSegmento
          ? { proposito: PROPOSITO.audio, tipo: TIPO.audio }
          : { proposito: PROPOSITO.entrada, tipo: TIPO.entrada },
        item.casoId,
        item.contrato.id,
        esSegmento ? transcribirSimulado : extraerSimulado,
      )
      if ('audio' in item) {
        item.contrato.transcript = resultado
        item.audio = null
      } else {
        item.contrato.proposed = resultado
        item.entrada = null
      }
      item.contrato.state = ProcessingState.DONE
    } catch (error) {
      console.warn('El motor simulado no pudo abrir el sobre', error)
      item.contrato.state = ProcessingState.FAILED
    }
    evento(audienciaId, esSegmento ? 'segmento' : 'extraccion', item.contrato.id)
  }, estado().demoraMs)
}

function transcribirSimulado(datos: Uint8Array): Uint8Array {
  const segmento = fromBinary(SealedAudioSegmentSchema, datos)
  // WAV PCM de 16 bits a 16 kHz: 32 000 bytes por segundo despues de la cabecera de 44.
  const segundos = Math.max(0, segmento.audio.length - 44) / 32_000
  const texto = `(Transcripción simulada de ${segundos.toFixed(1).replace('.', ',')} s de audio)`
  return toBinary(
    TranscriptionResultSchema,
    create(TranscriptionResultSchema, {
      segments: [
        {
          speakerParticipantId: segmento.speakerParticipantId,
          startMs: 0n,
          endMs: BigInt(Math.round(segundos * 1000)),
          text: texto,
          confidence: 0.9,
        },
      ],
      language: 'es',
      model: 'simulado',
      audioDurationMs: BigInt(Math.round(segundos * 1000)),
    }),
  )
}

/** Partes = participantes nombrados en el texto; montos = cifras con "$". Basta para probar la revision. */
function extraerSimulado(datos: Uint8Array): Uint8Array {
  const entrada = fromBinary(ExtractionInputSchema, datos)
  const partes = entrada.participants
    .filter((p) => p.displayName && entrada.text.includes(p.displayName))
    .map((p) =>
      create(LegalEntitySchema, {
        id: randomUUID(),
        value: {
          case: 'party',
          value: create(PartyIdentificationSchema, {
            fullName: p.displayName,
            role: HearingRole.OTHER,
            participantId: p.participantId,
          }),
        },
        confidence: 0.8,
        requiresConfirmation: true,
      }),
    )
  const montos = [...entrada.text.matchAll(/\$\s?([\d.]{1,15})/g)].map((m) =>
    create(LegalEntitySchema, {
      id: randomUUID(),
      value: {
        case: 'amount',
        value: create(MonetaryAmountSchema, {
          amount: create(MoneySchema, { currencyCode: 'COP', units: BigInt((m[1] ?? '0').replaceAll('.', '') || '0') }),
          debtorPartyIndex: -1,
          creditorPartyIndex: -1,
        }),
      },
      confidence: 0.7,
      requiresConfirmation: true,
    }),
  )
  return toBinary(
    EntityExtractionResultSchema,
    create(EntityExtractionResultSchema, {
      parties: partes,
      amounts: montos,
      referenceDate: entrada.referenceDate,
      pipelineVersion: 'simulado',
    }),
  )
}

function respuestaEvento(e: Evento): WatchHearingEventsResponse {
  const base = { eventSequence: e.secuencia }
  if (e.tipo === 'segmento') {
    const s = estado().segmentos.get(e.recurso)
    return create(WatchHearingEventsResponseSchema, {
      ...base,
      event: { case: 'segmentUpdated', value: create(AudioSegmentSchema, s?.contrato) },
    })
  }
  if (e.tipo === 'extraccion') {
    const x = estado().extracciones.get(e.recurso)
    return create(WatchHearingEventsResponseSchema, {
      ...base,
      event: { case: 'extractionUpdated', value: create(EntityExtractionSchema, x?.contrato) },
    })
  }
  const a = estado().audiencias.get(e.recurso)
  return create(WatchHearingEventsResponseSchema, {
    ...base,
    event: { case: 'hearingEnded', value: a ? resumen(a) : create(HearingSchema) },
  })
}

const dormir = (ms: number, senal: AbortSignal) =>
  new Promise<void>((resolver) => {
    const t = setTimeout(resolver, ms)
    senal.addEventListener('abort', () => {
      clearTimeout(t)
      resolver()
    })
  })

export function registrarAudienciasSimuladas(router: ConnectRouter): void {
  router.service(ProcessorKeyService, {
    async getProcessorKeys(_peticion, contexto) {
      if (!(contexto.requestHeader.get('authorization') ?? '').startsWith('Bearer ')) {
        throw fallo('Sesion vencida o no valida', Code.Unauthenticated)
      }
      const motor = await estado().motor
      return {
        keys: [
          {
            kind: ProcessorKind.AI_ENGINE,
            key: { keyId: motor.id, algorithm: 'ECDH-P256', publicKey: motor.publica },
          },
        ],
      }
    },
  })

  router.service(HearingService, {
    startHearing(p, contexto) {
      const { yo, estado: estadoCaso, registrar } = miembroSimulado(contexto, p.caseId)
      if (yo.rol !== CaseRole.CONCILIATOR) {
        throw fallo('Solo un conciliador del caso puede hacer esto', Code.PermissionDenied)
      }
      const existente = [...estado().audiencias.values()].find(
        (a) => a.casoId === p.caseId && a.contrato.state === HearingState.IN_PROGRESS,
      )
      if (existente) {
        throw fallo('Ya hay una audiencia en curso en este expediente', Code.FailedPrecondition)
      }
      if (estadoCaso !== CaseStatus.OPEN && estadoCaso !== CaseStatus.IN_HEARING) {
        throw fallo('Solo se inicia una audiencia en un expediente abierto o en audiencia', Code.FailedPrecondition)
      }
      const audiencia: Audiencia = {
        casoId: p.caseId,
        contrato: create(HearingSchema, {
          id: randomUUID(),
          caseId: p.caseId,
          state: HearingState.IN_PROGRESS,
          startedAt: timestampNow(),
        }),
      }
      estado().audiencias.set(audiencia.contrato.id, audiencia)
      registrar(CaseEventKind.HEARING_STARTED)
      return { hearing: resumen(audiencia) }
    },

    endHearing(p, contexto) {
      const { audiencia, yo, registrar } = audienciaDe(contexto, p.hearingId)
      if (yo.rol !== CaseRole.CONCILIATOR) {
        throw fallo('Solo un conciliador del caso puede hacer esto', Code.PermissionDenied)
      }
      if (audiencia.contrato.state === HearingState.IN_PROGRESS) {
        audiencia.contrato.state = HearingState.ENDED
        audiencia.contrato.endedAt = timestampFromMs(Date.now())
        evento(audiencia.contrato.id, 'fin', audiencia.contrato.id)
        registrar(CaseEventKind.HEARING_ENDED)
      }
      return { hearing: resumen(audiencia) }
    },

    getHearing(p, contexto) {
      return { hearing: resumen(audienciaDe(contexto, p.hearingId).audiencia) }
    },

    listHearings(p, contexto) {
      miembroSimulado(contexto, p.caseId)
      const suyas = [...estado().audiencias.values()].filter((a) => a.casoId === p.caseId).reverse()
      return { hearings: suyas.map(resumen) }
    },

    submitAudioSegment(p, contexto) {
      const { audiencia, yo, participantes } = audienciaDe(contexto, p.hearingId)
      exigirRedactor(yo.rol)
      const previo = [...estado().segmentos.values()].find(
        (s) => s.contrato.hearingId === p.hearingId && s.contrato.sequence === p.sequence,
      )
      if (previo) {
        if (previo.contrato.id !== p.segmentId) {
          throw fallo('Ese numero de segmento ya se uso con otro audio', Code.AlreadyExists)
        }
        return { segment: previo.contrato }
      }
      if (audiencia.contrato.state !== HearingState.IN_PROGRESS) {
        throw fallo('La audiencia ya termino', Code.FailedPrecondition)
      }
      if (!participantes.some((x) => x.id === p.speakerParticipantId)) {
        throw fallo('Quien habla no es participante del expediente', Code.InvalidArgument)
      }
      if (!p.audio?.payload || !p.audio.processorKey || !p.audio.contentKeyForCase) {
        throw fallo('El audio debe venir sellado para el motor', Code.InvalidArgument)
      }
      const segmento: Segmento = {
        casoId: audiencia.casoId,
        audio: p.audio,
        contrato: create(AudioSegmentSchema, {
          id: p.segmentId,
          hearingId: p.hearingId,
          sequence: p.sequence,
          speakerParticipantId: p.speakerParticipantId,
          durationMs: p.durationMs,
          state: ProcessingState.QUEUED,
          contentKeyForCase: p.audio.contentKeyForCase,
          receivedAt: timestampNow(),
        }),
      }
      estado().segmentos.set(p.segmentId, segmento)
      evento(p.hearingId, 'segmento', p.segmentId)
      procesarDespues(segmento, p.hearingId)
      return { segment: segmento.contrato }
    },

    listSegments(p, contexto) {
      audienciaDe(contexto, p.hearingId)
      const suyos = [...estado().segmentos.values()]
        .filter((s) => s.contrato.hearingId === p.hearingId && s.contrato.sequence > p.afterSequence)
        .sort((a, b) => a.contrato.sequence - b.contrato.sequence)
      return { segments: suyos.map((s) => s.contrato) }
    },

    requestEntityExtraction(p, contexto) {
      const { audiencia, yo } = audienciaDe(contexto, p.hearingId)
      exigirRedactor(yo.rol)
      const previa = estado().extracciones.get(p.extractionId)
      if (previa) {
        return { extraction: previa.contrato }
      }
      if (!p.input?.payload || !p.input.processorKey || !p.input.contentKeyForCase) {
        throw fallo('La transcripcion debe venir sellada para el motor', Code.InvalidArgument)
      }
      const extraccion: Extraccion = {
        casoId: audiencia.casoId,
        entrada: p.input,
        contrato: create(EntityExtractionSchema, {
          id: p.extractionId,
          hearingId: p.hearingId,
          state: ProcessingState.QUEUED,
          contentKeyForCase: p.input.contentKeyForCase,
        }),
      }
      estado().extracciones.set(p.extractionId, extraccion)
      evento(p.hearingId, 'extraccion', p.extractionId)
      procesarDespues(extraccion, p.hearingId)
      return { extraction: extraccion.contrato }
    },

    getEntityExtraction(p, contexto) {
      audienciaDe(contexto, p.hearingId)
      const suyas = [...estado().extracciones.values()].filter((x) => x.contrato.hearingId === p.hearingId)
      const ultima = suyas.at(-1)
      if (!ultima) {
        throw fallo('Esta audiencia aun no tiene extraccion', Code.NotFound)
      }
      return { extraction: ultima.contrato }
    },

    confirmEntities(p, contexto) {
      const x = estado().extracciones.get(p.extractionId)
      if (!x) {
        throw fallo('Extraccion no encontrada', Code.NotFound)
      }
      const { yo } = audienciaDe(contexto, x.contrato.hearingId)
      exigirRedactor(yo.rol)
      if (x.contrato.state !== ProcessingState.DONE) {
        throw fallo('La extraccion aun no termina', Code.FailedPrecondition)
      }
      if (x.contrato.revision !== p.expectedRevision) {
        throw fallo('Alguien mas guardo la revision antes; recarga y repite', Code.Aborted)
      }
      x.contrato.reviewed = p.reviewed
      x.contrato.revision += 1n
      x.contrato.reviewedByParticipantId = yo.id
      evento(x.contrato.hearingId, 'extraccion', x.contrato.id)
      return { extraction: x.contrato }
    },

    async *watchHearingEvents(p, contexto) {
      const { audiencia } = audienciaDe(contexto, p.hearingId)
      let ultima = p.afterEventSequence
      let latido = Date.now()
      const fin = Date.now() + 50_000
      while (!contexto.signal.aborted && Date.now() < fin) {
        const nuevos = estado().eventos.filter((e) => e.audienciaId === p.hearingId && e.secuencia > ultima)
        for (const e of nuevos) {
          yield respuestaEvento(e)
          ultima = e.secuencia
          latido = Date.now()
        }
        if (audiencia.contrato.state === HearingState.ENDED && nuevos.length === 0) {
          return
        }
        if (Date.now() - latido >= 15_000) {
          yield create(WatchHearingEventsResponseSchema, {
            eventSequence: ultima,
            event: { case: 'heartbeat', value: timestampNow() },
          })
          latido = Date.now()
        }
        await dormir(150, contexto.signal)
      }
    },
  })
}
