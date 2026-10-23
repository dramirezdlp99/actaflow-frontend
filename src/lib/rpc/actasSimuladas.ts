import 'server-only'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { create, fromBinary } from '@bufbuild/protobuf'
import { timestampNow } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError, type ConnectRouter, type HandlerContext } from '@connectrpc/connect'
import { CaseEventKind, CaseRole } from '@/gen/actaflow/cases/v1/case_pb'
import type { EncryptedBlob, SealedEnvelope } from '@/gen/actaflow/crypto/v1/crypto_pb'
import {
  AcceptanceSchema,
  FinalContentSchema,
  FinalDocumentSchema,
  MinuteSchema,
  MinuteService,
  MinuteState,
  type FinalDocument,
  type Minute,
} from '@/gen/actaflow/minutes/v1/minute_pb'
import { PROPOSITO, TIPO, procesarComoMotor } from '@/lib/audiencias/sellado'
import { demoraMotorSimulado, motorSimulado } from './audienciasSimuladas'
import { miembroSimulado, radicadoSimulado } from './expedientesSimulados'
import { presenciaSimulada } from './identidadSimulada'
import { versionPublicadaSimulada } from './plantillasSimuladas'

/**
 * MinuteService SIMULADO (solo ACTAFLOW_RPC_MODE=mock), con las mismas reglas que legal-case y el
 * motor simulado como procesador de documentos: abre de verdad el contenido final sellado, arma un
 * PDF sencillo (texto plano) y lo devuelve cifrado con la misma clave. Lo unico de mentira es el
 * diseno del PDF y la firma del sello.
 */

type Documento = {
  contrato: FinalDocument
  sha: string
  pendientes: Map<string, string>
}

type Acta = {
  contrato: Minute
  contenido: SealedEnvelope | null
  documento: Documento | null
  conciliador: string
}

type Estado = { actas: Map<string, Acta>; idempotencia: Map<string, Minute> }

declare global {
  var __actaflowActasSimuladas: Estado | undefined
}

function estado(): Estado {
  globalThis.__actaflowActasSimuladas ??= { actas: new Map(), idempotencia: new Map() }
  return globalThis.__actaflowActasSimuladas
}

export function reiniciarActasSimuladas(): void {
  globalThis.__actaflowActasSimuladas = { actas: new Map(), idempotencia: new Map() }
}

/** Espera a que el motor simulado termine los PDF encolados (para las pruebas). */
export async function esperarActasSimuladas(): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (![...estado().actas.values()].some((a) => a.contrato.state === MinuteState.SEALING)) {
      return
    }
    await new Promise((r) => setTimeout(r, 5))
  }
}

const fallo = (mensaje: string, codigo: Code) => new ConnectError(mensaje, codigo)

function actaDe(contexto: HandlerContext, id: string) {
  const acta = estado().actas.get(id)
  if (!acta) {
    throw fallo('Acta no encontrada', Code.NotFound)
  }
  return { acta, ...miembroSimulado(contexto, acta.contrato.caseId) }
}

function exigirConciliador(rol: CaseRole): void {
  if (rol !== CaseRole.CONCILIATOR) {
    throw fallo('Solo un conciliador del caso puede hacer esto', Code.PermissionDenied)
  }
}

/** Un PDF 1.4 valido y minimo: el texto del acta, una linea por parrafo, en Helvetica. */
export function pdfSencillo(titulo: string, html: string): Uint8Array {
  const texto = html
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<\/(p|h2|h3)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
  const lineas = [titulo, '', ...texto.split('\n').map((l) => l.trim()).filter(Boolean)].slice(0, 60)
  const escapar = (l: string) =>
    l.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, '\\$&')
  const flujo = ['BT /F1 11 Tf 56 760 Td 14 TL', ...lineas.map((l) => `(${escapar(l).slice(0, 95)}) '`), 'ET'].join('\n')
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let salida = '%PDF-1.4\n'
  const posiciones: number[] = []
  objetos.forEach((o, i) => {
    posiciones.push(salida.length)
    salida += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = salida.length
  salida += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  salida += posiciones.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')
  salida += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(salida)
}

function sellarDespues(acta: Acta): void {
  setTimeout(async () => {
    const sobre = acta.contenido
    if (!sobre) return
    try {
      const { privada } = await motorSimulado()
      let pdf: Uint8Array = new Uint8Array()
      const cifrado: EncryptedBlob = await procesarComoMotor(
        privada,
        sobre,
        { proposito: PROPOSITO.actaFinal, tipo: TIPO.actaFinal },
        acta.contrato.caseId,
        acta.contrato.id,
        (datos) => {
          const contenido = fromBinary(FinalContentSchema, datos)
          pdf = pdfSencillo(contenido.title, contenido.html)
          return pdf
        },
      )
      const sha = createHash('sha256').update(pdf).digest('hex')
      const participantes = partesDe(acta)
      const documento: Documento = {
        sha,
        pendientes: new Map(participantes.map((p) => [p.id, p.nombre])),
        contrato: create(FinalDocumentSchema, {
          id: randomUUID(),
          minuteId: acta.contrato.id,
          pdf: cifrado,
          contentKeyForCase: sobre.contentKeyForCase,
          seal: {
            sha256Hex: sha,
            cmsSignature: randomBytes(64),
            signerSubject: 'CN=ActaFlow - Sello simulado,O=ActaFlow',
            certificateFingerprintSha256: createHash('sha256').update('sello-simulado').digest('hex'),
            sealedAt: timestampNow(),
          },
        }),
      }
      documento.contrato.pendingParticipantIds = [...documento.pendientes.keys()]
      acta.documento = documento
      acta.contenido = null
      acta.contrato.state = documento.pendientes.size === 0 ? MinuteState.FINAL : MinuteState.AWAITING_ACCEPTANCE
    } catch (error) {
      console.warn('El motor simulado no pudo generar el PDF', error)
      acta.contenido = null
      acta.contrato.state = MinuteState.DRAFT
      acta.contrato.closedAt = undefined
    }
  }, demoraMotorSimulado())
}

/** Partes del caso al sellar: se guardan con el acta al crearla (el simulado no tiene contexto aqui). */
const partesPorActa = new Map<string, { id: string; nombre: string }[]>()
function partesDe(acta: Acta) {
  return partesPorActa.get(acta.contrato.id) ?? []
}

export function registrarActasSimuladas(router: ConnectRouter): void {
  router.service(MinuteService, {
    createMinute(p, contexto) {
      const previa = estado().idempotencia.get(p.idempotencyKey)
      if (previa) return { minute: previa }
      const { yo, organizacion, registrar } = miembroSimulado(contexto, p.caseId)
      exigirConciliador(yo.rol)
      if (!versionPublicadaSimulada(p.templateId, p.templateVersion, organizacion)) {
        throw fallo('La plantilla no existe', Code.NotFound)
      }
      const contrato = create(MinuteSchema, {
        id: randomUUID(),
        caseId: p.caseId,
        templateId: p.templateId,
        templateVersion: p.templateVersion,
        state: MinuteState.DRAFT,
        createdAt: timestampNow(),
      })
      estado().actas.set(contrato.id, { contrato, contenido: null, documento: null, conciliador: yo.id })
      estado().idempotencia.set(p.idempotencyKey, contrato)
      registrar(CaseEventKind.MINUTE_CREATED)
      return { minute: contrato }
    },

    getMinute(p, contexto) {
      return { minute: actaDe(contexto, p.minuteId).acta.contrato }
    },

    listMinutes(p, contexto) {
      miembroSimulado(contexto, p.caseId)
      const suyas = [...estado().actas.values()].filter((a) => a.contrato.caseId === p.caseId).reverse()
      return { minutes: suyas.map((a) => a.contrato) }
    },

    fillMinute() {
      throw fallo('El navegador llena la plantilla (ADR 0004)', Code.Unimplemented)
    },

    closeMinute(p, contexto) {
      const { acta, yo, participantes } = actaDe(contexto, p.minuteId)
      exigirConciliador(yo.rol)
      if (acta.contrato.state !== MinuteState.DRAFT) {
        throw fallo('El acta ya se cerró', Code.FailedPrecondition)
      }
      if (!p.finalContent?.payload || !p.finalContent.processorKey || !p.finalContent.contentKeyForCase) {
        throw fallo('El contenido final debe venir sellado para el motor', Code.InvalidArgument)
      }
      acta.contenido = p.finalContent
      acta.contrato.state = MinuteState.SEALING
      acta.contrato.closedAt = timestampNow()
      partesPorActa.set(
        acta.contrato.id,
        participantes.filter((x) => x.rol === CaseRole.PARTY).map((x) => ({ id: x.id, nombre: x.nombre })),
      )
      sellarDespues(acta)
      return { minute: acta.contrato, jobId: randomUUID() }
    },

    getFinalDocument(p, contexto) {
      const { acta } = actaDe(contexto, p.minuteId)
      if (!acta.documento) {
        throw fallo('El acta aún no tiene documento final', Code.NotFound)
      }
      return { document: acta.documento.contrato }
    },

    acceptFinalDocument(p, contexto) {
      const acta = [...estado().actas.values()].find((a) => a.documento?.contrato.id === p.documentId)
      if (!acta?.documento) {
        throw fallo('Documento no encontrado', Code.NotFound)
      }
      const { yo, registrar } = miembroSimulado(contexto, acta.contrato.caseId)
      const prueba = presenciaSimulada(p.presenceToken)
      if (!prueba || prueba.cuentaId !== yo.cuentaId || prueba.proposito !== `accept-minute:${p.documentId}:${p.sha256Hex}`) {
        throw fallo('Confirma otra vez con un código nuevo de tu app autenticadora', Code.Unauthenticated)
      }
      const doc = acta.documento
      if (doc.sha !== p.sha256Hex) {
        throw fallo('El PDF que leíste no es el que se selló', Code.FailedPrecondition)
      }
      const yaAcepto = doc.contrato.acceptances.some((a) => a.participantId === yo.id)
      if (!doc.pendientes.has(yo.id) && !yaAcepto) {
        throw fallo('Solo las partes del expediente aceptan el acta', Code.PermissionDenied)
      }
      if (!yaAcepto) {
        doc.pendientes.delete(yo.id)
        doc.contrato.acceptances.push(
          create(AcceptanceSchema, { participantId: yo.id, displayName: yo.nombre, acceptedAt: timestampNow() }),
        )
        doc.contrato.pendingParticipantIds = [...doc.pendientes.keys()]
        registrar(CaseEventKind.DOCUMENT_ACCEPTED)
        if (doc.pendientes.size === 0) {
          acta.contrato.state = MinuteState.FINAL
        }
      }
      return { document: doc.contrato }
    },

    verifyDocument(p) {
      const acta = [...estado().actas.values()].find((a) => a.documento?.sha === p.sha256Hex)
      if (!acta?.documento) {
        return { authentic: false }
      }
      return {
        authentic: true,
        seal: acta.documento.contrato.seal,
        caseNumber: radicadoSimulado(acta.contrato.caseId),
        acceptanceCount: acta.documento.contrato.acceptances.length,
      }
    },
  })
}
