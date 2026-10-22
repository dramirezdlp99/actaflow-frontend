'use client'

import { toBinary } from '@bufbuild/protobuf'
import { Mic, MicOff, Radio, ScanText, Square } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  claveMotor,
  confirmarEntidades,
  iniciarAudiencia,
  pedirExtraccion,
  terminarAudiencia,
  ultimaExtraccion,
} from '@/app/acciones/audiencias'
import { AvisoError } from '@/components/cuenta/Campo'
import { AvisoClave, useClaveCaso } from '@/components/expedientes/ClaveCaso'
import { CaseRole } from '@/gen/actaflow/cases/v1/case_pb'
import {
  AudioSegmentSchema,
  ConfirmEntitiesRequestSchema,
  EntityExtractionSchema,
  HearingSchema,
  HearingState,
  ProcessingState,
  RequestEntityExtractionRequestSchema,
  SubmitAudioSegmentRequestSchema,
  type AudioSegment,
  type EntityExtraction,
  type Hearing,
  type WatchHearingEventsResponse,
} from '@/gen/actaflow/hearings/v1/hearing_pb'
import { codificarWav, type Intervencion } from '@/lib/audiencias/audio'
import { aplicarRevision, contarEntidades, decisionesDe, type Decision } from '@/lib/audiencias/entidades'
import {
  abrirEntidades,
  abrirTranscripcion,
  prepararExtraccion,
  prepararRevision,
  prepararSegmento,
  textoTranscripcion,
  type Contexto,
  type EntidadesAbiertas,
} from '@/lib/audiencias/navegador'
import { aTexto, desdeTexto } from '@/lib/audiencias/protocolo'
import type { ClaveMotor } from '@/lib/audiencias/sellado'
import { buffer, desdeBase64Url } from '@/lib/cripto/bytes'
import { RevisionEntidades } from './RevisionEntidades'
import { Transcripcion, type Abierta } from './Transcripcion'
import { useEventosAudiencia, type Conexion } from './useEventosAudiencia'
import { useGrabadora, type EstadoGrabadora } from './useGrabadora'

export type PersonaSala = { id: string; nombre: string; rol: CaseRole }

type Props = {
  casoId: string
  idClaveCaso: string
  yo: { participanteId: string; rol: CaseRole }
  personas: PersonaSala[]
  /** Mensajes del contrato en base64url (los arma el servidor). */
  audienciaInicial: string | null
  segmentosIniciales: string[]
  extraccionInicial: string | null
  puedeIniciar: boolean
}

const PRIMARIO =
  'inline-flex items-center gap-2 rounded-lg bg-institucional px-4 py-2 text-sm font-semibold text-sobre-institucional shadow-suave transition hover:brightness-110 disabled:opacity-60'
const SECUNDARIO =
  'inline-flex items-center gap-2 rounded-lg border border-linea bg-superficie px-4 py-2 text-sm font-medium transition hover:border-institucional disabled:opacity-60'

const AVISO_MICROFONO: Partial<Record<EstadoGrabadora, string>> = {
  denegada: 'El navegador no dio permiso para usar el micrófono. Habilítalo en el candado de la barra de direcciones.',
  'bloqueada-pagina': 'Esta página se abrió sin recargar y el navegador aún no permite el micrófono. Recarga la página (F5) y vuelve a encenderlo.',
  'sin-soporte': 'Este navegador no permite grabar audio aquí. Usa una versión reciente de Chrome, Edge o Firefox.',
  error: 'No se pudo abrir el micrófono. Revisa que esté conectado y que ninguna otra aplicación lo esté usando.',
}

const CONEXION: Record<Conexion, string> = {
  conectando: 'Conectando…',
  'en-vivo': 'En vivo',
  reintentando: 'Reconectando…',
  cerrada: '',
}

const hora = (h: Hearing | null) =>
  h?.startedAt ? new Date(Number(h.startedAt.seconds) * 1000).toLocaleTimeString('es-CO', { timeStyle: 'short' }) : ''

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function SalaAudiencia(props: Props) {
  const { casoId, idClaveCaso, yo, personas } = props
  const clave = useClaveCaso()
  const redacta = yo.rol === CaseRole.CONCILIATOR || yo.rol === CaseRole.ASSISTANT
  const concilia = yo.rol === CaseRole.CONCILIATOR
  const nombres = useMemo(() => new Map(personas.map((p) => [p.id, p.nombre])), [personas])

  const [audiencia, setAudiencia] = useState<Hearing | null>(() =>
    props.audienciaInicial ? desdeTexto(HearingSchema, props.audienciaInicial) : null,
  )
  const [segmentos, setSegmentos] = useState<Map<string, AudioSegment>>(
    () =>
      new Map(
        props.segmentosIniciales.map((t) => {
          const s = desdeTexto(AudioSegmentSchema, t)
          return [s.id, s]
        }),
      ),
  )
  const [extraccion, setExtraccion] = useState<EntityExtraction | null>(() =>
    props.extraccionInicial ? desdeTexto(EntityExtractionSchema, props.extraccionInicial) : null,
  )
  const [abiertas, setAbiertas] = useState<Map<string, Abierta>>(new Map())
  const [entidades, setEntidades] = useState<EntidadesAbiertas>({ propuesta: null, revisada: null })
  const [decisiones, setDecisiones] = useState<Map<string, Decision>>(new Map())
  const [hablante, setHablante] = useState(
    () => personas.find((p) => p.rol === CaseRole.PARTY)?.id ?? yo.participanteId,
  )
  const [pendientes, setPendientes] = useState(0)
  const [ocupado, setOcupado] = useState<'iniciar' | 'terminar' | 'extraer' | 'guardar' | null>(null)
  const [confirmarFin, setConfirmarFin] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enCurso = audiencia?.state === HearingState.IN_PROGRESS
  const lista = clave.tipo === 'lista' ? clave.clave : null
  const contexto: Contexto | null = useMemo(
    () => (lista ? { claveCaso: lista, idClaveCaso, casoId } : null),
    [lista, idClaveCaso, casoId],
  )
  const ordenados = useMemo(() => [...segmentos.values()].sort((a, b) => a.sequence - b.sequence), [segmentos])

  // ---------------------------------------------------------------- eventos en vivo
  const alEvento = useCallback((e: WatchHearingEventsResponse) => {
    switch (e.event.case) {
      case 'segmentUpdated': {
        const s = e.event.value
        setSegmentos((m) => new Map(m).set(s.id, s))
        break
      }
      case 'extractionUpdated': {
        const x = e.event.value
        setExtraccion((actual) => (!actual || actual.id === x.id || x.state === ProcessingState.QUEUED ? x : actual))
        break
      }
      case 'hearingEnded':
        setAudiencia(e.event.value)
        break
      default:
        break
    }
  }, [])
  const conexion = useEventosAudiencia(casoId, audiencia && enCurso ? audiencia.id : null, alEvento)

  // ---------------------------------------------------------------- descifrado
  const abriendo = useRef(new Set<string>())
  useEffect(() => {
    if (!contexto) {
      return
    }
    for (const s of segmentos.values()) {
      if (s.state !== ProcessingState.DONE || abiertas.has(s.id) || abriendo.current.has(s.id)) {
        continue
      }
      abriendo.current.add(s.id)
      abrirTranscripcion(contexto, s)
        .then((r): Abierta => r ?? 'error')
        .catch((): Abierta => 'error')
        .then((r) => setAbiertas((m) => new Map(m).set(s.id, r)))
        .finally(() => abriendo.current.delete(s.id))
    }
  }, [segmentos, abiertas, contexto])

  const claveExtraccion = extraccion ? `${extraccion.id}.${extraccion.state}.${extraccion.revision}` : ''
  useEffect(() => {
    if (!contexto || !extraccion) {
      return
    }
    let vigente = true
    abrirEntidades(contexto, extraccion)
      .then((abiertas) => {
        if (vigente) {
          setEntidades(abiertas)
          setDecisiones(decisionesDe(abiertas.revisada))
        }
      })
      .catch(() => vigente && setError('No se pudieron descifrar las entidades en este navegador.'))
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `claveExtraccion` resume la extraccion
  }, [contexto, claveExtraccion])

  // ---------------------------------------------------------------- envio de intervenciones
  const motor = useRef<ClaveMotor | null>(null)
  const cola = useRef<Promise<void>>(Promise.resolve())
  const siguiente = useRef(0)
  useEffect(() => {
    siguiente.current = Math.max(siguiente.current, ...ordenados.map((s) => s.sequence + 1))
  }, [ordenados])

  const obtenerMotor = useCallback(async (): Promise<ClaveMotor> => {
    if (motor.current) {
      return motor.current
    }
    const r = await claveMotor()
    if (!r.ok) {
      throw new Error(r.mensaje)
    }
    motor.current = { idClave: r.idClave, publica: desdeBase64Url(r.publica) }
    return motor.current
  }, [])

  const enviar = useCallback(
    async (intervencion: Intervencion, hablanteId: string, audienciaId: string) => {
      if (!contexto) {
        return
      }
      const peticion = await prepararSegmento({
        ...contexto,
        motor: await obtenerMotor(),
        audienciaId,
        secuencia: siguiente.current,
        hablanteId,
        wav: codificarWav(intervencion.muestras),
        duracionMs: intervencion.duracionMs,
        nombres: personas.map((p) => p.nombre),
      })
      siguiente.current += 1
      for (let intento = 1; intento <= 6; intento += 1) {
        let respuesta: Response
        try {
          respuesta = await fetch(`/expedientes/${casoId}/audiencia/segmentos`, {
            method: 'POST',
            headers: { 'content-type': 'application/x-protobuf' },
            body: buffer(toBinary(SubmitAudioSegmentRequestSchema, peticion)),
          })
        } catch {
          await dormir(1_000 * intento)
          continue
        }
        const cuerpo: unknown = await respuesta.json().catch(() => null)
        const dato = typeof cuerpo === 'object' && cuerpo !== null ? cuerpo : {}
        if (respuesta.ok && 'segmento' in dato && typeof dato.segmento === 'string') {
          const s = desdeTexto(AudioSegmentSchema, dato.segmento)
          setSegmentos((m) => new Map(m).set(s.id, s))
          return
        }
        if (respuesta.status === 409) {
          // Otro dispositivo uso ese numero: el mismo audio sellado va con el siguiente.
          peticion.sequence = siguiente.current
          siguiente.current += 1
          continue
        }
        if (respuesta.status >= 500 || respuesta.status === 408) {
          await dormir(1_000 * intento)
          continue
        }
        throw new Error('mensaje' in dato && typeof dato.mensaje === 'string' ? dato.mensaje : 'No se pudo enviar.')
      }
      throw new Error('No se pudo enviar una intervención. Revisa tu conexión.')
    },
    [contexto, obtenerMotor, personas, casoId],
  )

  const hablanteActual = useRef(hablante)
  useEffect(() => {
    hablanteActual.current = hablante
  }, [hablante])

  const alCortar = useCallback(
    (intervencion: Intervencion) => {
      const audienciaId = audiencia?.id
      if (!audienciaId) {
        return
      }
      const quien = hablanteActual.current
      setPendientes((n) => n + 1)
      // En fila: las intervenciones llegan a legal-case en el orden en que se dijeron.
      cola.current = cola.current
        .then(() => enviar(intervencion, quien, audienciaId))
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'No se pudo enviar una intervención.'))
        .finally(() => setPendientes((n) => n - 1))
    },
    [audiencia?.id, enviar],
  )
  const grabadora = useGrabadora(alCortar)

  useEffect(() => {
    if (!enCurso && grabadora.estado === 'grabando') {
      grabadora.detener()
    }
  }, [enCurso, grabadora])

  // ---------------------------------------------------------------- acciones
  async function iniciar() {
    setOcupado('iniciar')
    setError(null)
    const r = await iniciarAudiencia({ casoId, idempotencia: crypto.randomUUID() })
    setOcupado(null)
    if (!r.ok) {
      setError(r.mensaje)
      return
    }
    setAudiencia(desdeTexto(HearingSchema, r.audiencia))
    setSegmentos(new Map())
    setAbiertas(new Map())
    setExtraccion(null)
    setEntidades({ propuesta: null, revisada: null })
    siguiente.current = 0
    // La clave del motor se pide ya: si el motor duerme en Render, despierta mientras empiezan a hablar.
    void obtenerMotor().catch(() => undefined)
  }

  async function terminar() {
    if (!audiencia) {
      return
    }
    if (grabadora.estado === 'grabando') {
      grabadora.detener()
    }
    setOcupado('terminar')
    await cola.current
    const r = await terminarAudiencia({ audienciaId: audiencia.id })
    setOcupado(null)
    setConfirmarFin(false)
    if (!r.ok) {
      setError(r.mensaje)
      return
    }
    setAudiencia(desdeTexto(HearingSchema, r.audiencia))
  }

  const transcritas = ordenados.flatMap((s) => {
    const a = abiertas.get(s.id)
    return a && a !== 'error' ? [{ hablanteId: s.speakerParticipantId, resultado: a }] : []
  })

  async function extraer() {
    if (!contexto || !audiencia) {
      return
    }
    setOcupado('extraer')
    setError(null)
    try {
      const peticion = await prepararExtraccion({
        ...contexto,
        motor: await obtenerMotor(),
        audienciaId: audiencia.id,
        texto: textoTranscripcion(transcritas, personas),
        personas,
        hoy: new Date(),
      })
      const r = await pedirExtraccion({ peticion: aTexto(RequestEntityExtractionRequestSchema, peticion) })
      if (!r.ok) {
        setError(r.mensaje)
        return
      }
      setExtraccion(desdeTexto(EntityExtractionSchema, r.extraccion))
      setEntidades({ propuesta: null, revisada: null })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo pedir la extracción.')
    } finally {
      setOcupado(null)
    }
  }

  const base = entidades.revisada ?? entidades.propuesta
  async function guardarRevision() {
    if (!contexto || !extraccion || !base) {
      return
    }
    setOcupado('guardar')
    setError(null)
    try {
      const peticion = await prepararRevision({
        ...contexto,
        extraccion,
        resultado: aplicarRevision(base, decisiones),
      })
      const r = await confirmarEntidades({ peticion: aTexto(ConfirmEntitiesRequestSchema, peticion) })
      if (r.ok) {
        setExtraccion(desdeTexto(EntityExtractionSchema, r.extraccion))
        return
      }
      setError(r.mensaje)
      // Conflicto: se carga lo que guardo la otra persona.
      const ultima = await ultimaExtraccion({ audienciaId: extraccion.hearingId })
      if (ultima.ok && ultima.extraccion) {
        setExtraccion(desdeTexto(EntityExtractionSchema, ultima.extraccion))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la revisión.')
    } finally {
      setOcupado(null)
    }
  }

  const decidir = useCallback((id: string, d: Decision | null) => {
    setDecisiones((m) => {
      const nuevo = new Map(m)
      if (d) {
        nuevo.set(id, d)
      } else {
        nuevo.delete(id)
      }
      return nuevo
    })
  }, [])

  const extrayendo =
    extraccion?.state === ProcessingState.QUEUED || extraccion?.state === ProcessingState.PROCESSING
  const total = contarEntidades(base)

  // Terminada la audiencia ya no hay flujo en vivo: una extraccion pedida despues se consulta cada 3 s.
  useEffect(() => {
    if (enCurso || !extrayendo || !audiencia) {
      return
    }
    const temporizador = setInterval(() => {
      void ultimaExtraccion({ audienciaId: audiencia.id }).then((r) => {
        if (r.ok && r.extraccion) {
          setExtraccion(desdeTexto(EntityExtractionSchema, r.extraccion))
        }
      })
    }, 3_000)
    return () => clearInterval(temporizador)
  }, [enCurso, extrayendo, audiencia])

  // ---------------------------------------------------------------- vista
  return (
    <div className="grid gap-8">
      <section
        aria-label="Estado de la audiencia"
        className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-linea bg-superficie p-6 shadow-suave"
      >
        <div>
          <p className="folio text-lacre">Audiencia</p>
          <p className="mt-1 text-lg font-semibold">
            {!audiencia
              ? 'Aún no ha comenzado'
              : enCurso
                ? `En curso desde las ${hora(audiencia)}`
                : `Terminada · ${audiencia.segmentCount} intervenciones`}
          </p>
          {enCurso && CONEXION[conexion] ? (
            <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-tinta-suave">
              <Radio aria-hidden className={`size-3.5 ${conexion === 'en-vivo' ? 'text-exito' : 'text-alerta'}`} />
              {CONEXION[conexion]}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {concilia && !enCurso && props.puedeIniciar ? (
            <button type="button" className={PRIMARIO} disabled={ocupado !== null} onClick={iniciar}>
              {ocupado === 'iniciar' ? 'Iniciando…' : audiencia ? 'Iniciar otra audiencia' : 'Iniciar audiencia'}
            </button>
          ) : null}
          {concilia && enCurso ? (
            confirmarFin ? (
              <>
                <button type="button" className={PRIMARIO} disabled={ocupado !== null} onClick={terminar}>
                  {ocupado === 'terminar' ? 'Terminando…' : 'Sí, terminar'}
                </button>
                <button type="button" className={SECUNDARIO} onClick={() => setConfirmarFin(false)}>
                  Seguir
                </button>
              </>
            ) : (
              <button type="button" className={SECUNDARIO} onClick={() => setConfirmarFin(true)}>
                <Square aria-hidden className="size-4" /> Terminar audiencia
              </button>
            )
          ) : null}
        </div>
      </section>

      <AvisoClave estado={clave} />
      <AvisoError mensaje={error} />

      {enCurso && redacta && contexto ? (
        <section
          aria-labelledby="titulo-microfono"
          className="rounded-2xl border border-linea bg-superficie p-6 shadow-suave"
        >
          <h2 id="titulo-microfono" className="titular flex items-center gap-2 text-2xl">
            <Mic aria-hidden className="size-5 text-institucional" /> Micrófono
          </h2>
          <p className="mt-2 text-sm text-tinta-suave">
            Cada intervención se corta sola en las pausas, se sella en este navegador para el motor de IA y se
            transcribe. Nadie más puede oír el audio, y se borra en cuanto queda transcrito.
          </p>
          <fieldset className="mt-4">
            <legend className="text-sm font-semibold">Quién habla</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {personas.map((p) => (
                <label
                  key={p.id}
                  className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm transition ${
                    hablante === p.id
                      ? 'border-institucional bg-institucional-suave font-semibold text-institucional'
                      : 'border-linea hover:border-institucional'
                  }`}
                >
                  <input
                    type="radio"
                    name="hablante"
                    value={p.id}
                    checked={hablante === p.id}
                    onChange={() => setHablante(p.id)}
                    className="sr-only"
                  />
                  {p.nombre}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            {grabadora.estado === 'grabando' ? (
              <button type="button" className={SECUNDARIO} onClick={grabadora.detener}>
                <MicOff aria-hidden className="size-4" /> Pausar micrófono
              </button>
            ) : (
              <button
                type="button"
                className={PRIMARIO}
                disabled={grabadora.estado === 'pidiendo'}
                onClick={() => void grabadora.iniciar()}
              >
                <Mic aria-hidden className="size-4" />
                {grabadora.estado === 'pidiendo' ? 'Pidiendo permiso…' : 'Encender micrófono'}
              </button>
            )}
            {grabadora.estado === 'grabando' ? (
              <div className="flex items-center gap-2" aria-label="Nivel de audio">
                <span className="relative inline-flex size-2.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-error/60" />
                  <span className="relative inline-flex size-2.5 rounded-full bg-error" />
                </span>
                <span className="h-2 w-40 overflow-hidden rounded-full bg-papel-hondo">
                  <span
                    className="block h-full rounded-full bg-institucional transition-[width] duration-100"
                    style={{ width: `${Math.round(grabadora.nivel * 100)}%` }}
                  />
                </span>
              </div>
            ) : null}
          </div>
          {AVISO_MICROFONO[grabadora.estado] ? (
            <p role="alert" className="mt-3 text-sm text-error">
              {AVISO_MICROFONO[grabadora.estado]}
            </p>
          ) : null}
        </section>
      ) : null}

      {audiencia ? (
        <section
          aria-labelledby="titulo-transcripcion"
          className="hoja rounded-2xl py-8 pl-14 pr-6 sm:pl-16 sm:pr-10"
        >
          <h2 id="titulo-transcripcion" className="titular text-2xl">
            Transcripción
          </h2>
          <Transcripcion segmentos={ordenados} abiertas={abiertas} nombres={nombres} pendientes={pendientes} />
        </section>
      ) : null}

      {audiencia ? (
        <section
          aria-labelledby="titulo-entidades"
          className="rounded-2xl border border-linea bg-superficie p-6 shadow-suave"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="titulo-entidades" className="titular flex items-center gap-2 text-2xl">
              <ScanText aria-hidden className="size-5 text-ia" /> Entidades para el acta
            </h2>
            {redacta && contexto ? (
              <button
                type="button"
                className={SECUNDARIO}
                disabled={ocupado !== null || extrayendo || transcritas.length === 0}
                onClick={extraer}
              >
                {ocupado === 'extraer' || extrayendo
                  ? 'Extrayendo…'
                  : extraccion
                    ? 'Volver a extraer'
                    : 'Extraer de la transcripción'}
              </button>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-tinta-suave">
            El motor de IA lee la transcripción sellada y propone partes, montos, plazos y compromisos. Una persona
            los revisa antes de que pasen al acta.
          </p>
          {extraccion?.state === ProcessingState.FAILED ? (
            <p className="mt-4 text-sm text-error">El motor no pudo procesar la transcripción. Intenta de nuevo.</p>
          ) : null}
          {base ? (
            <>
              <RevisionEntidades resultado={base} decisiones={decisiones} editable={redacta} alDecidir={decidir} />
              {redacta && total > 0 ? (
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button type="button" className={PRIMARIO} disabled={ocupado !== null} onClick={guardarRevision}>
                    {ocupado === 'guardar' ? 'Guardando…' : 'Guardar revisión'}
                  </button>
                  <span className="text-sm text-tinta-suave">
                    {decisiones.size} de {total} revisadas
                    {extraccion && extraccion.revision > 0n
                      ? ` · revisión ${extraccion.revision} guardada por ${nombres.get(extraccion.reviewedByParticipantId) ?? 'alguien'}`
                      : ''}
                  </span>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
