// @vitest-environment node
import { fromBinary, toBinary } from '@bufbuild/protobuf'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  claveMotor,
  confirmarEntidades,
  iniciarAudiencia,
  pedirExtraccion,
  terminarAudiencia,
  ultimaExtraccion,
} from '@/app/acciones/audiencias'
import { crearExpediente, invitarParticipante } from '@/app/acciones/expedientes'
import { confirmarAlta, invitarMiembro, registrarCuenta } from '@/app/acciones/identidad'
import { GET as eventos } from '@/app/expedientes/[id]/audiencia/eventos/route'
import { POST as enviar } from '@/app/expedientes/[id]/audiencia/segmentos/route'
import {
  AudioSegmentSchema,
  ConfirmEntitiesRequestSchema,
  EntityExtractionSchema,
  HearingSchema,
  HearingState,
  ProcessingState,
  RequestEntityExtractionRequestSchema,
  SubmitAudioSegmentRequestSchema,
  WatchHearingEventsResponseSchema,
  type AudioSegment,
  type WatchHearingEventsResponse,
} from '@/gen/actaflow/hearings/v1/hearing_pb'
import { codificarWav } from '@/lib/audiencias/audio'
import {
  abrirEntidades,
  abrirTranscripcion,
  prepararExtraccion,
  prepararRevision,
  prepararSegmento,
  textoTranscripcion,
  type Contexto,
} from '@/lib/audiencias/navegador'
import { aTexto, desdeTexto } from '@/lib/audiencias/protocolo'
import { buffer, desdeBase32, desdeBase64Url } from '@/lib/cripto/bytes'
import { cifrarDetalles, desenvolverClave, envolverClave, nuevaClaveCaso } from '@/lib/cripto/casos'
import { abrirKit, prepararRegistro } from '@/lib/cuenta/navegador'
import { blobATexto, envolturaATexto, textoAEnvoltura } from '@/lib/expedientes/formato'
import { clavePublicaDe, listarPersonas, obtenerCaso } from '@/lib/expedientes/servidor'
import { esperarMotorSimulado, reiniciarAudienciasSimuladas } from '@/lib/rpc/audienciasSimuladas'
import { reiniciarExpedientesSimulados } from '@/lib/rpc/expedientesSimulados'
import {
  codigoTotp,
  CORREO_ADMIN_SIMULADO,
  INVITACION_SIMULADA,
  reiniciarIdentidadSimulada,
} from '@/lib/rpc/identidadSimulada'
import { sesionActual } from '@/lib/sesion/sesion'

// Cada persona tiene su propio "navegador": su tarro de cookies.
let tarro = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (n: string) => (tarro.has(n) ? { value: tarro.get(n) ?? '' } : undefined),
    set: (n: string, v: string, o: { maxAge?: number }) => (o.maxAge === 0 ? tarro.delete(n) : tarro.set(n, v)),
  }),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (destino: string) => {
    throw new Error(`NEXT_REDIRECT ${destino}`)
  },
}))
// `cache` de React solo deduplica dentro de una peticion de servidor; aqui cada llamada es nueva.
vi.mock('react', async (original) => ({ ...(await original<typeof import('react')>()), cache: <T>(f: T) => f }))

let reloj = Date.UTC(2026, 9, 20, 12)

async function alta(invitacion: string, correo: string, nombre: string) {
  tarro = new Map()
  const contrasena = `frase larga de ${nombre}`
  const preparado = await prepararRegistro({
    invitacion,
    correo,
    nombre,
    contrasena,
    idempotencia: crypto.randomUUID(),
  })
  const registro = await registrarCuenta(preparado.datos)
  if (!registro.ok) throw new Error(registro.mensaje)
  reloj += 31_000
  vi.setSystemTime(reloj)
  const confirmado = await confirmarAlta({
    inscripcion: registro.inscripcion,
    codigo: codigoTotp(desdeBase32(registro.secreto), reloj),
  })
  if (!confirmado.ok || !confirmado.kit) throw new Error('alta')
  const privada = await abrirKit(preparado.claves, confirmado.kit)
  const sesion = await sesionActual()
  if (!sesion) throw new Error('sin sesion')
  return { tarro, privada, sesion, cuentaId: confirmado.cuentaId }
}

type Persona = Awaited<ReturnType<typeof alta>>

function como<T>(persona: Persona, trabajo: () => Promise<T>): Promise<T> {
  tarro = persona.tarro
  return trabajo()
}

async function nuevoCaso(persona: Persona, radicado: string, titulo: string) {
  return como(persona, async () => {
    const mia = await clavePublicaDe(persona.sesion, persona.cuentaId)
    if (!mia) throw new Error('sin clave publica')
    const { clave, idClave } = await nuevaClaveCaso()
    const detalles = await cifrarDetalles(clave, idClave, { titulo, resumen: 'Resumen secreto' })
    const envoltura = await envolverClave(clave, { idClave: mia.idClave, publica: desdeBase64Url(mia.publica) })
    const respuesta = await crearExpediente({
      radicado,
      tipo: 'CONCILIATION',
      detalles: blobATexto(detalles),
      clave: envolturaATexto(envoltura),
      audiencia: new Date(reloj + 86_400_000).toISOString(),
      idempotencia: crypto.randomUUID(),
    })
    if (!respuesta.ok) throw new Error(respuesta.mensaje)
    return respuesta.id
  })
}

let admin: Persona
let ana: Persona
let bruno: Persona

/** Lo que el navegador de una persona tiene abierto en la sala: la clave del caso. */
async function contexto(persona: Persona, casoId: string): Promise<Contexto> {
  const { caso, membresia } = await como(persona, () => obtenerCaso(persona.sesion, casoId))
  if (!membresia?.clave) throw new Error('sin clave del caso')
  const claveCaso = await desenvolverClave(persona.privada, textoAEnvoltura(membresia.clave))
  return { claveCaso, idClaveCaso: caso.detalles?.idClave ?? '', casoId }
}

async function motor(persona: Persona) {
  const clave = await como(persona, () => claveMotor())
  if (!clave.ok) throw new Error(clave.mensaje)
  return { idClave: clave.idClave, publica: desdeBase64Url(clave.publica) }
}

/** 2 s de un tono: lo que importa es que el motor reciba exactamente estos bytes. */
function wav(segundos: number): Uint8Array {
  const muestras = new Float32Array(16_000 * segundos)
  for (let i = 0; i < muestras.length; i += 1) muestras[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / 16_000)
  return codificarWav(muestras)
}

function postSegmento(cuerpo: Uint8Array, cabeceras: Record<string, string> = {}) {
  return enviar(
    new Request('http://localhost:3001/expedientes/x/audiencia/segmentos', {
      method: 'POST',
      headers: { 'content-type': 'application/x-protobuf', ...cabeceras },
      body: buffer(cuerpo),
    }),
  )
}

async function leerEventos(audienciaId: string, despues = 0n): Promise<{ eventos: WatchHearingEventsResponse[]; fin: boolean }> {
  const respuesta = await eventos(
    new Request(`http://localhost:3001/expedientes/x/audiencia/eventos?audiencia=${audienciaId}&despues=${despues}`),
  )
  const lineas = (await respuesta.text()).trim().split('\n').map((l) => JSON.parse(l) as { e?: string; fin?: boolean; error?: string })
  const error = lineas.find((l) => l.error)
  if (error) throw new Error(error.error)
  return {
    eventos: lineas.flatMap((l) => (l.e ? [desdeTexto(WatchHearingEventsResponseSchema, l.e)] : [])),
    fin: lineas.some((l) => l.fin),
  }
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(reloj)
  vi.stubEnv('ACTAFLOW_RPC_MODE', 'mock')
  reiniciarIdentidadSimulada()
  reiniciarExpedientesSimulados()
  reiniciarAudienciasSimuladas(0)
  admin = await alta(INVITACION_SIMULADA, CORREO_ADMIN_SIMULADO, 'Admin')
  for (const [correo, nombre] of [
    ['ana@actaflow.test', 'Ana'],
    ['bruno@actaflow.test', 'Bruno'],
  ] as const) {
    const invitacion = await como(admin, () => invitarMiembro({ correo, rol: 'MEMBER', idempotencia: crypto.randomUUID() }))
    if (!invitacion.ok) throw new Error(invitacion.mensaje)
    const persona = await alta(invitacion.token, correo, nombre)
    if (nombre === 'Ana') ana = persona
    else bruno = persona
  }
})

describe('sala de audiencia de punta a punta (simulada)', () => {
  it('graba, sella, transcribe, extrae y revisa sin que el BFF vea el contenido', async () => {
    const casoId = await nuevoCaso(admin, 'CC-2026-0300', 'Arriendo local 4')
    const invitada = await como(admin, () =>
      invitarParticipante({
        casoId,
        correo: 'ana@actaflow.test',
        nombre: 'Ana Pérez',
        rol: 'PARTY',
        lado: 'CLAIMANT',
        calidad: 'PRINCIPAL',
        idempotencia: crypto.randomUUID(),
      }),
    )
    expect(invitada).toEqual({ ok: true })
    await como(ana, () => obtenerCaso(ana.sesion, casoId))
    const lista = await como(admin, () => listarPersonas(admin.sesion, casoId))
    const personas = lista.map((p) => ({ id: p.id, nombre: p.nombre }))
    // Al vincularse, la invitacion toma el nombre de la cuenta de Ana.
    const deAna = personas.find((p) => p.id === lista.find((x) => x.correo === 'ana@actaflow.test')?.id)
    if (!deAna) throw new Error('sin Ana')

    const iniciada = await como(admin, () => iniciarAudiencia({ casoId, idempotencia: crypto.randomUUID() }))
    if (!iniciada.ok) throw new Error(iniciada.mensaje)
    const audiencia = desdeTexto(HearingSchema, iniciada.audiencia)
    expect(audiencia.state).toBe(HearingState.IN_PROGRESS)

    const c = await contexto(admin, casoId)
    const claveDelMotor = await motor(admin)
    expect(claveDelMotor.idClave).toMatch(/^motor:[0-9a-f]{16}$/)
    const peticion = await prepararSegmento({
      ...c,
      motor: claveDelMotor,
      audienciaId: audiencia.id,
      secuencia: 0,
      hablanteId: deAna.id,
      wav: wav(2),
      duracionMs: 2000,
      nombres: personas.map((p) => p.nombre),
    })
    const enviado = await como(admin, () => postSegmento(toBinary(SubmitAudioSegmentRequestSchema, peticion)))
    expect(enviado.status).toBe(200)
    const recibido = (await enviado.json()) as { ok: boolean; segmento: string }
    expect(desdeTexto(AudioSegmentSchema, recibido.segmento).state).toBe(ProcessingState.QUEUED)

    await esperarMotorSimulado()
    const { eventos: lote1 } = await como(ana, () => leerEventosHasta(audiencia.id))
    const ultimo = lote1.filter((e) => e.event.case === 'segmentUpdated').at(-1)?.event.value as AudioSegment
    expect(ultimo.state).toBe(ProcessingState.DONE)
    // El navegador abre la transcripcion con la clave del caso; el BFF solo vio bytes cifrados.
    const transcripcion = await abrirTranscripcion(c, ultimo)
    expect(transcripcion?.segments[0]?.text).toBe('(Transcripción simulada de 2,0 s de audio)')
    expect(transcripcion?.segments[0]?.speakerParticipantId).toBe(deAna.id)

    const texto = `${textoTranscripcion([{ hablanteId: deAna.id, resultado: transcripcion! }], personas)}\nAdmin: se acuerda pagar $1.500.000`
    expect(texto.startsWith('Ana: (Transcripción simulada')).toBe(true)
    const pedido = await prepararExtraccion({ ...c, motor: claveDelMotor, audienciaId: audiencia.id, texto, personas, hoy: new Date(reloj) })
    const pedida = await como(admin, () => pedirExtraccion({ peticion: aTextoPeticion(pedido) }))
    expect(pedida.ok).toBe(true)
    await esperarMotorSimulado()
    const ultima = await como(admin, () => ultimaExtraccion({ audienciaId: audiencia.id }))
    if (!ultima.ok || !ultima.extraccion) throw new Error('sin extraccion')
    const extraccion = desdeTexto(EntityExtractionSchema, ultima.extraccion)
    const { propuesta, revisada } = await abrirEntidades(c, extraccion)
    expect(revisada).toBeNull()
    expect(propuesta?.parties.map((p) => (p.value.case === 'party' ? p.value.value.fullName : '')).sort()).toEqual(['Admin', 'Ana'])
    expect(propuesta?.amounts[0]?.value.case === 'amount' && propuesta.amounts[0].value.value.amount?.units).toBe(1_500_000n)

    const revision = await prepararRevision({ ...c, extraccion, resultado: propuesta! })
    const guardada = await como(admin, () => confirmarEntidades({ peticion: aTextoRevision(revision) }))
    if (!guardada.ok) throw new Error(guardada.mensaje)
    const nueva = desdeTexto(EntityExtractionSchema, guardada.extraccion)
    expect(nueva.revision).toBe(1n)
    expect((await abrirEntidades(c, nueva)).revisada?.amounts).toHaveLength(1)
    // La misma revision vieja otra vez: alguien mas ya guardo.
    const tarde = await como(admin, () => confirmarEntidades({ peticion: aTextoRevision(revision) }))
    expect(tarde).toEqual({ ok: false, mensaje: 'Alguien más guardó la revisión antes que tú. Se cargó la versión nueva.' })

    const terminada = await como(admin, () => terminarAudiencia({ audienciaId: audiencia.id }))
    expect(terminada.ok && desdeTexto(HearingSchema, terminada.audiencia).state).toBe(HearingState.ENDED)
    const { eventos: todos, fin } = await como(ana, () => leerEventos(audiencia.id))
    expect(fin).toBe(true)
    expect(todos.at(-1)?.event.case).toBe('hearingEnded')
    // Reanudar desde el ultimo evento no repite nada.
    const resto = await como(ana, () => leerEventos(audiencia.id, todos.at(-1)?.eventSequence ?? 0n))
    expect(resto.eventos).toEqual([])
  })

  it('solo quien graba manda audio, el endpoint exige protobuf del mismo origen y el BFF valida', async () => {
    const casoId = await nuevoCaso(admin, 'CC-2026-0301', 'Servidumbre')
    await como(admin, () =>
      invitarParticipante({
        casoId,
        correo: 'ana@actaflow.test',
        nombre: 'Ana',
        rol: 'PARTY',
        lado: 'CLAIMANT',
        calidad: 'PRINCIPAL',
        idempotencia: crypto.randomUUID(),
      }),
    )
    await como(ana, () => obtenerCaso(ana.sesion, casoId))
    const iniciada = await como(admin, () => iniciarAudiencia({ casoId, idempotencia: crypto.randomUUID() }))
    if (!iniciada.ok) throw new Error(iniciada.mensaje)
    const audiencia = desdeTexto(HearingSchema, iniciada.audiencia)
    const c = await contexto(admin, casoId)
    const { membresia } = await como(admin, () => obtenerCaso(admin.sesion, casoId))
    const peticion = await prepararSegmento({
      ...c,
      motor: await motor(admin),
      audienciaId: audiencia.id,
      secuencia: 0,
      hablanteId: membresia?.participanteId ?? '',
      wav: wav(1),
      duracionMs: 1000,
      nombres: [],
    })
    const binario = toBinary(SubmitAudioSegmentRequestSchema, peticion)

    expect((await como(admin, () => postSegmento(binario, { 'content-type': 'text/plain' }))).status).toBe(415)
    expect((await como(admin, () => postSegmento(binario, { origin: 'https://otro.sitio' }))).status).toBe(403)
    tarro = new Map()
    expect((await postSegmento(binario)).status).toBe(401)
    const deAna = await como(ana, () => postSegmento(binario))
    expect(deAna.status).toBe(422)
    expect(await deAna.json()).toEqual({ ok: false, mensaje: 'Solo un conciliador o un asistente del caso puede hacer esto.' })
    expect((await como(admin, () => postSegmento(new Uint8Array([1, 2, 3])))).status).toBe(400)
    // Bruno no participa: para el la audiencia no existe.
    await expect(como(bruno, () => leerEventos(audiencia.id))).rejects.toThrow('La audiencia no existe o no participas en el expediente.')
    expect((await como(admin, () => postSegmento(binario))).status).toBe(200)
    expect(fromBinary(SubmitAudioSegmentRequestSchema, binario).audio?.payload?.plaintextType).toBe(
      'actaflow.engine.v1.SealedAudioSegment',
    )
  })
})

/** Lee eventos hasta ver el segmento terminado (la audiencia sigue en curso: el flujo no cierra solo). */
async function leerEventosHasta(audienciaId: string) {
  const controlador = new AbortController()
  const respuesta = await eventos(
    new Request(`http://localhost:3001/expedientes/x/audiencia/eventos?audiencia=${audienciaId}&despues=0`, {
      signal: controlador.signal,
    }),
  )
  const lector = respuesta.body!.getReader()
  const decodificador = new TextDecoder()
  let resto = ''
  const lista: WatchHearingEventsResponse[] = []
  while (!lista.some((e) => e.event.case === 'segmentUpdated' && e.event.value.state === ProcessingState.DONE)) {
    const { value, done } = await lector.read()
    if (done) break
    resto += decodificador.decode(value, { stream: true })
    const lineas = resto.split('\n')
    resto = lineas.pop() ?? ''
    for (const l of lineas) {
      const dato = JSON.parse(l) as { e?: string }
      if (dato.e) lista.push(desdeTexto(WatchHearingEventsResponseSchema, dato.e))
    }
  }
  controlador.abort()
  await lector.cancel()
  return { eventos: lista }
}

const aTextoPeticion = (p: Parameters<typeof aTexto<typeof RequestEntityExtractionRequestSchema>>[1]) =>
  aTexto(RequestEntityExtractionRequestSchema, p)
const aTextoRevision = (p: Parameters<typeof aTexto<typeof ConfirmEntitiesRequestSchema>>[1]) =>
  aTexto(ConfirmEntitiesRequestSchema, p)
