'use client'

import { BadgeCheck, Download, FileSignature, LoaderCircle, ShieldAlert, Stamp } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { aceptarActa, cerrarActa, crearActa, documentoFinal, obtenerActa } from '@/app/acciones/actas'
import { claveMotor } from '@/app/acciones/audiencias'
import { AvisoError } from '@/components/cuenta/Campo'
import { AvisoClave, useClaveCaso } from '@/components/expedientes/ClaveCaso'
import { CaseRole } from '@/gen/actaflow/cases/v1/case_pb'
import { EntityExtractionSchema } from '@/gen/actaflow/hearings/v1/hearing_pb'
import type { EntityExtractionResult } from '@/gen/actaflow/legal/v1/entities_pb'
import {
  CloseMinuteRequestSchema,
  FinalDocumentSchema,
  MinuteSchema,
  MinuteState,
  type FinalDocument,
  type Minute,
} from '@/gen/actaflow/minutes/v1/minute_pb'
import { VariableType, type TemplateValue, type TemplateVariable } from '@/gen/actaflow/templates/v1/template_pb'
import { abrirDocumento, prepararCierre, type PdfAbierto } from '@/lib/actas/navegador'
import type { OpcionPlantilla } from '@/lib/actas/servidor'
import { valoresAutomaticos, valorManual, type PersonaActa } from '@/lib/actas/valores'
import { abrirEntidades, type Contexto } from '@/lib/audiencias/navegador'
import { aTexto, desdeTexto } from '@/lib/audiencias/protocolo'
import { buffer, desdeBase64Url } from '@/lib/cripto/bytes'
import { sanearHtml } from '@/lib/plantillas/saneo'
import { analizar, html } from '@/lib/rpc/lenguajeSimulado'

type Props = {
  casoId: string
  idClaveCaso: string
  radicado: string
  yo: { participanteId: string; rol: CaseRole }
  personas: PersonaActa[]
  audienciaInicio: string | null
  extraccion: string | null
  acta: string | null
  fuente: string
  tituloPlantilla: string
  documento: string | null
  plantillas: OpcionPlantilla[]
}

const PRIMARIO =
  'inline-flex items-center gap-2 rounded-lg bg-institucional px-4 py-2 text-sm font-semibold text-sobre-institucional shadow-suave transition hover:brightness-110 disabled:opacity-60'
const SECUNDARIO =
  'inline-flex items-center gap-2 rounded-lg border border-linea bg-superficie px-4 py-2 text-sm font-medium transition hover:border-institucional disabled:opacity-60'
const CAJA = 'rounded-2xl border border-linea bg-superficie p-6 shadow-suave'

const ESTADO: Record<MinuteState, string> = {
  [MinuteState.UNSPECIFIED]: '',
  [MinuteState.DRAFT]: 'Borrador',
  [MinuteState.SEALING]: 'Generando el PDF y el sello',
  [MinuteState.AWAITING_ACCEPTANCE]: 'Esperando la aceptación de las partes',
  [MinuteState.FINAL]: 'Final: aceptada por todas las partes',
}

type TipoCampo = 'texto' | 'dinero' | 'fecha' | 'entero' | 'si-no'
const CAMPO: Partial<Record<VariableType, TipoCampo>> = {
  [VariableType.TEXT]: 'texto',
  [VariableType.PARTY]: 'texto',
  [VariableType.MONEY]: 'dinero',
  [VariableType.DATE]: 'fecha',
  [VariableType.INTEGER]: 'entero',
  [VariableType.BOOLEAN]: 'si-no',
}

/** Lo que muestra el formulario para un valor deducido automaticamente. */
function aCrudo(v: TemplateValue | undefined): string {
  switch (v?.kind.case) {
    case 'text':
      return v.kind.value
    case 'money':
      return v.kind.value.units.toString()
    case 'date': {
      const f = v.kind.value
      return `${f.year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`
    }
    case 'integer':
      return v.kind.value.toString()
    case 'boolean':
      return v.kind.value ? 'si' : 'no'
    default:
      return ''
  }
}

const fechaHora = (segundos: bigint | undefined) =>
  segundos ? new Date(Number(segundos) * 1000).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' }) : ''

export function SalaActa(props: Props) {
  const { casoId, idClaveCaso, yo, personas } = props
  const router = useRouter()
  const clave = useClaveCaso()
  const concilia = yo.rol === CaseRole.CONCILIATOR
  const lista = clave.tipo === 'lista' ? clave.clave : null
  const contexto: Contexto | null = useMemo(
    () => (lista ? { claveCaso: lista, idClaveCaso, casoId } : null),
    [lista, idClaveCaso, casoId],
  )

  const [acta, setActa] = useState<Minute | null>(() => (props.acta ? desdeTexto(MinuteSchema, props.acta) : null))
  const [documento, setDocumento] = useState<FinalDocument | null>(() =>
    props.documento ? desdeTexto(FinalDocumentSchema, props.documento) : null,
  )
  const [entidades, setEntidades] = useState<EntityExtractionResult | null>(null)
  const [manual, setManual] = useState<Record<string, string>>({})
  const [plantilla, setPlantilla] = useState(props.plantillas[0]?.id ?? '')
  const [pdf, setPdf] = useState<PdfAbierto | null>(null)
  const [codigo, setCodigo] = useState('')
  const [ocupado, setOcupado] = useState<'crear' | 'cerrar' | 'aceptar' | null>(null)
  const [confirmar, setConfirmar] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ------------------------------------------------------------------ entidades revisadas (cifradas)
  useEffect(() => {
    if (!contexto || !props.extraccion) {
      return
    }
    let vigente = true
    abrirEntidades(contexto, desdeTexto(EntityExtractionSchema, props.extraccion))
      .then((r) => vigente && setEntidades(r.revisada))
      .catch(() => vigente && setError('No se pudieron descifrar las entidades revisadas en este navegador.'))
    return () => {
      vigente = false
    }
  }, [contexto, props.extraccion])

  // ------------------------------------------------------------------ llenado (en el navegador)
  const analisis = useMemo(() => (props.fuente ? analizar(props.fuente) : null), [props.fuente])
  const automaticos = useMemo(
    () =>
      valoresAutomaticos({
        radicado: props.radicado,
        personas,
        audiencia: props.audienciaInicio ? new Date(props.audienciaInicio) : null,
        entidades,
      }),
    [props.radicado, personas, props.audienciaInicio, entidades],
  )
  const campos: TemplateVariable[] = useMemo(
    () => (analisis?.variables ?? []).filter((v) => CAMPO[v.type] !== undefined),
    [analisis],
  )
  const valores = useMemo(() => {
    const v: Record<string, TemplateValue> = { ...automaticos }
    for (const campo of campos) {
      const crudo = manual[campo.path]
      if (crudo === undefined) continue
      const valor = valorManual(CAMPO[campo.type] ?? 'texto', crudo)
      if (valor) v[campo.path] = valor
      else delete v[campo.path]
    }
    return v
  }, [automaticos, campos, manual])
  const vista = useMemo((): { html: string; faltan: number; fallo: string | null } => {
    if (!analisis) return { html: '', faltan: 0, fallo: null }
    try {
      const salida = sanearHtml(html(analisis.nodos, valores))
      return { html: salida, faltan: (salida.match(/class="falta"/g) ?? []).length, fallo: null }
    } catch (e) {
      return { html: '', faltan: 0, fallo: e instanceof Error ? e.message : 'No se pudo armar el acta.' }
    }
  }, [analisis, valores])

  // ------------------------------------------------------------------ documento final
  useEffect(() => {
    if (!contexto || !documento) {
      return
    }
    let vigente = true
    abrirDocumento(contexto, documento)
      .then((r) => vigente && setPdf(r))
      .catch(() => vigente && setError('No se pudo descifrar el PDF del acta en este navegador.'))
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- el PDF no cambia con las aceptaciones
  }, [contexto, documento?.id])

  const urlPdf = useMemo(
    () => (pdf ? URL.createObjectURL(new Blob([buffer(pdf.pdf)], { type: 'application/pdf' })) : null),
    [pdf],
  )
  const urlSello = useMemo(() => {
    const cms = documento?.seal?.cmsSignature
    return cms?.length ? URL.createObjectURL(new Blob([buffer(cms)], { type: 'application/pkcs7-signature' })) : null
  }, [documento?.seal?.cmsSignature])
  useEffect(() => () => void (urlPdf && URL.revokeObjectURL(urlPdf)), [urlPdf])
  useEffect(() => () => void (urlSello && URL.revokeObjectURL(urlSello)), [urlSello])

  // ------------------------------------------------------------------ seguimiento del estado
  const refrescar = useCallback(async () => {
    if (!acta) return
    const r = await obtenerActa({ actaId: acta.id })
    if (!r.ok) return
    const nueva = desdeTexto(MinuteSchema, r.acta)
    if (acta.state === MinuteState.SEALING && nueva.state === MinuteState.DRAFT) {
      setError('El motor no pudo generar el PDF. Revisa el acta y ciérrala otra vez.')
    }
    setActa(nueva)
    if (nueva.state === MinuteState.AWAITING_ACCEPTANCE || nueva.state === MinuteState.FINAL) {
      const d = await documentoFinal({ actaId: nueva.id })
      if (d.ok && d.documento) setDocumento(desdeTexto(FinalDocumentSchema, d.documento))
    }
  }, [acta])

  useEffect(() => {
    const estado = acta?.state
    if (estado !== MinuteState.SEALING && estado !== MinuteState.AWAITING_ACCEPTANCE) {
      return
    }
    const temporizador = setInterval(() => void refrescar(), estado === MinuteState.SEALING ? 3_000 : 10_000)
    return () => clearInterval(temporizador)
  }, [acta?.state, refrescar])

  // ------------------------------------------------------------------ acciones
  async function crear() {
    const elegida = props.plantillas.find((p) => p.id === plantilla)
    if (!elegida) return
    setOcupado('crear')
    setError(null)
    const r = await crearActa({
      casoId,
      plantillaId: elegida.id,
      version: elegida.version,
      idempotencia: crypto.randomUUID(),
    })
    setOcupado(null)
    if (!r.ok) {
      setError(r.mensaje)
      return
    }
    router.refresh()
  }

  async function cerrar() {
    if (!contexto || !acta) return
    setOcupado('cerrar')
    setError(null)
    try {
      const clave = await claveMotor()
      if (!clave.ok) throw new Error(clave.mensaje)
      const peticion = await prepararCierre({
        ...contexto,
        motor: { idClave: clave.idClave, publica: desdeBase64Url(clave.publica) },
        actaId: acta.id,
        titulo: `${props.tituloPlantilla} · ${props.radicado}`,
        html: vista.html,
      })
      const r = await cerrarActa({ peticion: aTexto(CloseMinuteRequestSchema, peticion) })
      if (!r.ok) throw new Error(r.mensaje)
      setActa(desdeTexto(MinuteSchema, r.acta))
      setConfirmar(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cerrar el acta.')
    } finally {
      setOcupado(null)
    }
  }

  async function aceptar() {
    if (!documento || !pdf?.coincide) return
    setOcupado('aceptar')
    setError(null)
    const r = await aceptarActa({ documentoId: documento.id, sha256: pdf.sha256, codigo })
    setOcupado(null)
    setCodigo('')
    if (!r.ok) {
      setError(r.mensaje)
      return
    }
    setDocumento(desdeTexto(FinalDocumentSchema, r.documento))
    void refrescar()
  }

  // ------------------------------------------------------------------ vista
  const nombre = (id: string) => personas.find((p) => p.id === id)?.nombre ?? 'Participante'
  const pendiente = documento?.pendingParticipantIds.includes(yo.participanteId) ?? false
  const borrador = acta?.state === MinuteState.DRAFT

  return (
    <div className="grid gap-8">
      <AvisoClave estado={clave} />
      <AvisoError mensaje={error} />

      {!acta ? (
        <section aria-labelledby="titulo-crear" className={CAJA}>
          <h2 id="titulo-crear" className="titular flex items-center gap-2 text-2xl">
            <FileSignature aria-hidden className="size-5 text-institucional" /> Crear el acta
          </h2>
          {concilia ? (
            <>
              <p className="mt-2 text-sm text-tinta-suave">
                Elige la plantilla publicada. El acta se llena sola en tu navegador con los datos del expediente y con
                las entidades que revisaste en la audiencia.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className="text-sm">
                  <span className="sr-only">Plantilla</span>
                  <select
                    value={plantilla}
                    onChange={(e) => setPlantilla(e.target.value)}
                    className="rounded-lg border border-linea bg-papel px-3 py-2 text-sm"
                  >
                    {props.plantillas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.titulo} (versión {p.version})
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className={PRIMARIO} disabled={!plantilla || ocupado !== null} onClick={crear}>
                  {ocupado === 'crear' ? 'Creando…' : 'Crear acta'}
                </button>
              </div>
            </>
          ) : (
            <p className="mt-2 text-sm text-tinta-suave">El conciliador aún no ha creado el acta de este expediente.</p>
          )}
        </section>
      ) : (
        <section aria-label="Estado del acta" className={`${CAJA} flex flex-wrap items-center justify-between gap-4`}>
          <div>
            <p className="folio text-lacre">{props.tituloPlantilla}</p>
            <p className="mt-1 flex items-center gap-2 text-lg font-semibold">
              {acta.state === MinuteState.SEALING ? <LoaderCircle aria-hidden className="size-4 animate-spin" /> : null}
              {ESTADO[acta.state]}
            </p>
          </div>
        </section>
      )}

      {acta && borrador && contexto ? (
        <div className="grid items-start gap-8 lg:grid-cols-[1fr_1.3fr]">
          {concilia ? (
            <section aria-labelledby="titulo-datos" className={CAJA}>
              <h2 id="titulo-datos" className="titular text-2xl">
                Datos del acta
              </h2>
              <p className="mt-2 text-sm text-tinta-suave">
                Lo que se pudo deducir ya está lleno. Completa o corrige el resto; las listas (cuotas, compromisos,
                participantes) salen de lo revisado.
              </p>
              <div className="mt-4 grid gap-3">
                {campos.map((c) => {
                  const tipo = CAMPO[c.type] ?? 'texto'
                  const valor = manual[c.path] ?? aCrudo(automaticos[c.path])
                  const cambiar = (v: string) => setManual((m) => ({ ...m, [c.path]: v }))
                  return (
                    <label key={c.path} className="grid gap-1 text-sm">
                      <span className="font-medium">
                        {c.label || c.path}
                        {c.required ? <span className="text-error"> *</span> : null}
                      </span>
                      {tipo === 'si-no' ? (
                        <select
                          value={valor}
                          onChange={(e) => cambiar(e.target.value)}
                          className="rounded-lg border border-linea bg-papel px-3 py-2"
                        >
                          <option value="">—</option>
                          <option value="si">Sí</option>
                          <option value="no">No</option>
                        </select>
                      ) : (
                        <input
                          value={valor}
                          type={tipo === 'fecha' ? 'date' : 'text'}
                          inputMode={tipo === 'dinero' || tipo === 'entero' ? 'numeric' : undefined}
                          placeholder={tipo === 'dinero' ? 'En pesos, por ejemplo 1500000' : ''}
                          onChange={(e) => cambiar(e.target.value)}
                          className="rounded-lg border border-linea bg-papel px-3 py-2"
                        />
                      )}
                    </label>
                  )
                })}
              </div>
            </section>
          ) : null}

          <section aria-labelledby="titulo-vista" className={concilia ? '' : 'lg:col-span-2'}>
            <h2 id="titulo-vista" className="sr-only">
              Vista del acta
            </h2>
            <div className="hoja rounded-2xl py-8 pl-14 pr-6 sm:pl-16 sm:pr-10">
              {vista.fallo ? <p className="text-error">{vista.fallo}</p> : null}
              {/* HTML armado en este navegador y pasado por sanearHtml (solo etiquetas permitidas). */}
              <div className="documento grid gap-3" dangerouslySetInnerHTML={{ __html: vista.html }} />
            </div>
            {concilia ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                {vista.faltan > 0 ? (
                  <p className="text-sm text-alerta">
                    Faltan {vista.faltan} {vista.faltan === 1 ? 'dato' : 'datos'} (resaltados): complétalos antes de cerrar.
                  </p>
                ) : confirmar ? (
                  <>
                    <button type="button" className={PRIMARIO} disabled={ocupado !== null} onClick={cerrar}>
                      {ocupado === 'cerrar' ? 'Sellando…' : 'Sí, cerrar y sellar'}
                    </button>
                    <button type="button" className={SECUNDARIO} onClick={() => setConfirmar(false)}>
                      Seguir editando
                    </button>
                    <span className="text-sm text-tinta-suave">Después de cerrar ya no se puede editar.</span>
                  </>
                ) : (
                  <button type="button" className={PRIMARIO} onClick={() => setConfirmar(true)}>
                    <Stamp aria-hidden className="size-4" /> Cerrar y sellar el acta
                  </button>
                )}
              </div>
            ) : (
              <p className="mt-4 text-sm text-tinta-suave">El conciliador está preparando el acta.</p>
            )}
          </section>
        </div>
      ) : null}

      {documento ? (
        <section aria-labelledby="titulo-documento" className={CAJA}>
          <h2 id="titulo-documento" className="titular flex items-center gap-2 text-2xl">
            <BadgeCheck aria-hidden className="size-5 text-exito" /> Documento final sellado
          </h2>
          {pdf ? (
            <p className={`mt-3 flex items-center gap-2 text-sm font-medium ${pdf.coincide ? 'text-exito' : 'text-error'}`}>
              {pdf.coincide ? <BadgeCheck aria-hidden className="size-4" /> : <ShieldAlert aria-hidden className="size-4" />}
              {pdf.coincide
                ? 'El PDF que descifraste coincide exactamente con el sello.'
                : 'El PDF descifrado NO coincide con el sello: no lo aceptes.'}
            </p>
          ) : (
            <p className="mt-3 text-sm text-tinta-suave">Descifrando el PDF…</p>
          )}
          <div className="mt-4 flex flex-wrap gap-3">
            {urlPdf ? (
              <a className={PRIMARIO} href={urlPdf} download={`acta-${props.radicado}.pdf`}>
                <Download aria-hidden className="size-4" /> Descargar PDF
              </a>
            ) : null}
            {urlSello ? (
              <a className={SECUNDARIO} href={urlSello} download={`acta-${props.radicado}.p7s`}>
                <Download aria-hidden className="size-4" /> Descargar sello (.p7s)
              </a>
            ) : null}
          </div>
          <dl className="mt-5 grid gap-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
            <dt className="text-tinta-suave">SHA-256 del PDF</dt>
            <dd className="break-all font-mono text-xs">{documento.seal?.sha256Hex}</dd>
            <dt className="text-tinta-suave">Sellado</dt>
            <dd>{fechaHora(documento.seal?.sealedAt?.seconds)}</dd>
            <dt className="text-tinta-suave">Certificado</dt>
            <dd className="break-all font-mono text-xs">{documento.seal?.certificateFingerprintSha256}</dd>
          </dl>

          <h3 className="mt-6 font-semibold">Aceptaciones</h3>
          <ul className="mt-2 grid gap-1 text-sm">
            {documento.acceptances.map((a) => (
              <li key={a.participantId} className="text-exito">
                ✓ {a.displayName} · {fechaHora(a.acceptedAt?.seconds)}
              </li>
            ))}
            {documento.pendingParticipantIds.map((id) => (
              <li key={id} className="text-tinta-suave">
                · {nombre(id)}: pendiente
              </li>
            ))}
          </ul>

          {pendiente ? (
            <div className="mt-6 rounded-xl border border-institucional/40 bg-institucional-suave p-4">
              <p className="text-sm">
                Lee el PDF. Si estás de acuerdo, confirma con el código de 6 dígitos de tu app autenticadora: quedará
                registrado que aceptaste exactamente este documento.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="text-sm">
                  <span className="sr-only">Código de tu app autenticadora</span>
                  <input
                    value={codigo}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="000000"
                    onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
                    className="w-32 rounded-lg border border-linea bg-papel px-3 py-2 text-center font-mono tracking-widest"
                  />
                </label>
                <button
                  type="button"
                  className={PRIMARIO}
                  disabled={codigo.length !== 6 || !pdf?.coincide || ocupado !== null}
                  onClick={aceptar}
                >
                  {ocupado === 'aceptar' ? 'Confirmando…' : 'Acepto el acta'}
                </button>
              </div>
            </div>
          ) : null}
          <p className="mt-6 text-xs text-tinta-suave">
            Sello de integridad de ActaFlow (SHA-256 + firma CMS). No es una firma digital certificada en los términos de la
            Ley 527 de 1999. Cualquiera puede comprobar el PDF en <a className="underline" href="/verificar">/verificar</a>.
          </p>
        </section>
      ) : null}
    </div>
  )
}
