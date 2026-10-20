'use client'

import { AlertTriangle, CheckCircle2, CircleX, Save } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'
import { analizarPlantilla, guardarPlantilla } from '@/app/acciones/plantillas'
import { AvisoError, Campo } from '@/components/cuenta/Campo'
import { CATEGORIA, CATEGORIAS, type ValorCategoria } from '@/lib/plantillas/etiquetas'
import type { VistaDiagnostico, VistaVariable } from '@/lib/plantillas/servidor'
import { TablaVariables } from './TablaVariables'

export type DatosEditor = {
  id?: string
  slug: string
  titulo: string
  descripcion: string
  categoria: ValorCategoria
  fuente: string
}

type Analisis =
  | { estado: 'revisando' }
  | { estado: 'listo'; diagnosticos: VistaDiagnostico[]; variables: VistaVariable[]; html: string }
  | { estado: 'error'; mensaje: string }

const ESPERA_MS = 600

/** Convierte un titulo en una direccion: "Acta de mediación" -> "acta-de-mediacion". */
export function slugDe(titulo: string): string {
  return titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

/**
 * Editor de una plantilla: la fuente se revisa en legal-case mientras se escribe (diagnosticos,
 * variables y vista previa con datos de ejemplo). Guardar deja un borrador; publicar se hace desde
 * la lista de versiones.
 */
export function EditorPlantilla({ inicial }: { inicial: DatosEditor }) {
  const router = useRouter()
  const esNueva = !inicial.id
  const [datos, setDatos] = useState(inicial)
  const [slugTocado, setSlugTocado] = useState(!esNueva)
  const [analisis, setAnalisis] = useState<Analisis>({ estado: 'revisando' })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [aviso, setAviso] = useState<string | null>(null)
  const [cambios, setCambios] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const turno = useRef(0)
  const idFuente = useId()

  useEffect(() => {
    const mio = ++turno.current
    const espera = setTimeout(async () => {
      setAnalisis({ estado: 'revisando' })
      const respuesta = await analizarPlantilla({ fuente: datos.fuente })
      if (mio !== turno.current) {
        return
      }
      setAnalisis(
        respuesta.ok
          ? {
              estado: 'listo',
              diagnosticos: respuesta.diagnosticos,
              variables: respuesta.variables,
              html: respuesta.html,
            }
          : { estado: 'error', mensaje: respuesta.mensaje },
      )
    }, ESPERA_MS)
    return () => clearTimeout(espera)
  }, [datos.fuente])

  useEffect(() => {
    if (!cambios) {
      return
    }
    const avisar = (evento: BeforeUnloadEvent) => evento.preventDefault()
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [cambios])

  function cambiar<K extends keyof DatosEditor>(campo: K, valor: DatosEditor[K]) {
    setCambios(true)
    setAviso(null)
    setDatos((antes) => {
      const nuevo = { ...antes, [campo]: valor }
      if (campo === 'titulo' && !slugTocado) {
        nuevo.slug = slugDe(String(valor))
      }
      return nuevo
    })
  }

  function irA(d: VistaDiagnostico) {
    const texto = area.current
    if (!texto) {
      return
    }
    const lineas = datos.fuente.replaceAll('\r\n', '\n').split('\n')
    const inicio = lineas.slice(0, d.linea - 1).reduce((n, l) => n + l.length + 1, 0) + d.columna - 1
    texto.focus()
    texto.setSelectionRange(inicio, inicio)
  }

  async function guardar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    setGuardando(true)
    setError(null)
    setCampos({})
    setAviso(null)
    const respuesta = await guardarPlantilla({ ...datos, id: datos.id })
    setGuardando(false)
    if (!respuesta.ok) {
      setError(respuesta.mensaje)
      setCampos(respuesta.campos ?? {})
      if (respuesta.diagnosticos) {
        setAnalisis((antes) => ({
          estado: 'listo',
          diagnosticos: respuesta.diagnosticos ?? [],
          variables: antes.estado === 'listo' ? antes.variables : [],
          html: antes.estado === 'listo' ? antes.html : '',
        }))
      }
      return
    }
    setCambios(false)
    if (esNueva) {
      router.replace(`/panel/plantillas/${respuesta.id}`)
      return
    }
    setAviso(`Borrador guardado (versión ${respuesta.version}). Publícalo cuando esté listo.`)
    router.refresh()
  }

  const errores = analisis.estado === 'listo' ? analisis.diagnosticos.filter((d) => d.error).length : 0

  return (
    <form onSubmit={guardar} noValidate className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <div className="grid content-start gap-5">
        <Campo
          etiqueta="Título"
          name="titulo"
          value={datos.titulo}
          onChange={(e) => cambiar('titulo', e.target.value)}
          maxLength={160}
          required
          error={campos.titulo}
        />
        <Campo
          etiqueta="Dirección (slug)"
          name="slug"
          value={datos.slug}
          onChange={(e) => {
            setSlugTocado(true)
            cambiar('slug', e.target.value)
          }}
          disabled={!esNueva}
          maxLength={120}
          ayuda={
            esNueva
              ? `Se publicará en /plantillas/${datos.slug || '…'}. No se puede cambiar después.`
              : `Publicada en /plantillas/${datos.slug}.`
          }
          error={campos.slug}
        />
        <div>
          <label htmlFor={`${idFuente}-categoria`} className="block text-sm font-medium text-tinta">
            Categoría
          </label>
          <select
            id={`${idFuente}-categoria`}
            value={datos.categoria}
            onChange={(e) => {
              const elegida = CATEGORIAS.find((c) => c.valor === e.target.value)
              if (elegida) {
                cambiar('categoria', elegida.valor)
              }
            }}
            className="mt-1.5 block w-full rounded-lg border border-linea bg-superficie px-3.5 py-2.5 text-[0.95rem] text-tinta outline-none focus:border-institucional focus:ring-2 focus:ring-institucional/25"
          >
            {CATEGORIAS.map((c) => (
              <option key={c.valor} value={c.valor}>
                {CATEGORIA[c.categoria]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${idFuente}-descripcion`} className="block text-sm font-medium text-tinta">
            Descripción
          </label>
          <textarea
            id={`${idFuente}-descripcion`}
            value={datos.descripcion}
            onChange={(e) => cambiar('descripcion', e.target.value)}
            maxLength={500}
            rows={2}
            className="mt-1.5 block w-full rounded-lg border border-linea bg-superficie px-3.5 py-2.5 text-[0.95rem] text-tinta outline-none focus:border-institucional focus:ring-2 focus:ring-institucional/25"
          />
        </div>
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <label htmlFor={idFuente} className="block text-sm font-medium text-tinta">
              Texto de la plantilla
            </label>
            <EstadoRevision analisis={analisis} errores={errores} />
          </div>
          <textarea
            ref={area}
            id={idFuente}
            value={datos.fuente}
            onChange={(e) => cambiar('fuente', e.target.value)}
            spellCheck={false}
            rows={22}
            aria-describedby={`${idFuente}-diagnosticos`}
            aria-invalid={errores > 0 || Boolean(campos.fuente) || undefined}
            className="mt-1.5 block w-full resize-y rounded-lg border border-linea bg-superficie px-3.5 py-3 font-mono text-[0.82rem] leading-relaxed text-tinta outline-none focus:border-institucional focus:ring-2 focus:ring-institucional/25 aria-[invalid=true]:border-error"
          />
          <div id={`${idFuente}-diagnosticos`} aria-live="polite">
            {analisis.estado === 'listo' && analisis.diagnosticos.length > 0 ? (
              <ul className="mt-3 grid gap-1.5 text-sm">
                {analisis.diagnosticos.map((d, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => irA(d)}
                      className={`flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-papel-hondo ${d.error ? 'text-error' : 'text-alerta'}`}
                    >
                      {d.error ? (
                        <CircleX aria-hidden className="mt-0.5 size-4 shrink-0" />
                      ) : (
                        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                      )}
                      <span>
                        <span className="font-semibold">
                          Línea {d.linea}, columna {d.columna}:
                        </span>{' '}
                        {d.mensaje}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <AyudaLenguaje />
        </div>
        <AvisoError mensaje={error} />
        {aviso ? (
          <p role="status" className="rounded-lg border border-exito/30 px-4 py-3 text-sm font-medium text-exito">
            {aviso}
          </p>
        ) : null}
        <div>
          <button
            type="submit"
            disabled={guardando}
            aria-busy={guardando || undefined}
            className="inline-flex items-center gap-2 rounded-lg bg-institucional px-5 py-3 text-sm font-semibold text-sobre-institucional shadow-suave transition hover:brightness-110 disabled:cursor-wait disabled:opacity-70"
          >
            <Save aria-hidden className="size-4" /> {guardando ? 'Guardando…' : 'Guardar borrador'}
          </button>
        </div>
      </div>

      <div className="grid content-start gap-8 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-auto">
        <section aria-labelledby={`${idFuente}-vista`}>
          <h2 id={`${idFuente}-vista`} className="titular text-2xl">
            Vista previa
          </h2>
          <p className="mt-1 text-sm text-tinta-suave">
            Con datos de ejemplo. Lo marcado en rojo falta: en un acta real lo completa la IA o el conciliador.
          </p>
          <div
            data-prueba="vista-previa"
            className="hoja documento mt-4 min-h-48 rounded-2xl py-8 pl-16 pr-8"
            // HTML generado por legal-case (todo escapado) y vuelto a sanear en el BFF (sanearHtml).
            dangerouslySetInnerHTML={{ __html: analisis.estado === 'listo' ? analisis.html : '' }}
          />
        </section>
        <section aria-labelledby={`${idFuente}-variables`}>
          <h2 id={`${idFuente}-variables`} className="titular text-2xl">
            Variables
          </h2>
          <div className="mt-4">
            {analisis.estado === 'listo' ? (
              <TablaVariables variables={analisis.variables} />
            ) : (
              <p className="text-sm text-tinta-suave">Revisando…</p>
            )}
          </div>
        </section>
      </div>
    </form>
  )
}

function EstadoRevision({ analisis, errores }: { analisis: Analisis; errores: number }) {
  if (analisis.estado === 'revisando') {
    return <span className="text-xs text-tinta-suave">Revisando…</span>
  }
  if (analisis.estado === 'error') {
    return <span className="text-xs font-medium text-error">{analisis.mensaje}</span>
  }
  return errores > 0 ? (
    <span data-prueba="estado-revision" className="inline-flex items-center gap-1 text-xs font-semibold text-error">
      <CircleX aria-hidden className="size-3.5" /> {errores === 1 ? '1 error' : `${errores} errores`}
    </span>
  ) : (
    <span data-prueba="estado-revision" className="inline-flex items-center gap-1 text-xs font-semibold text-exito">
      <CheckCircle2 aria-hidden className="size-3.5" /> Sin errores
    </span>
  )
}

function AyudaLenguaje() {
  return (
    <details className="mt-4 rounded-lg border border-linea bg-superficie px-4 py-3 text-sm">
      <summary className="cursor-pointer font-medium">Cómo se escribe una plantilla</summary>
      <dl className="mt-3 grid gap-2 text-tinta-suave">
        <div>
          <dt className="font-mono text-tinta">{'{{ partes.convocante.nombre }}'}</dt>
          <dd>Una variable. Con formato: {'{{ acuerdo.monto | moneda_en_letras }}'}</dd>
        </div>
        <div>
          <dt className="font-mono text-tinta">{'{% si acuerdo.cuotas > 0 %} … {% sino %} … {% fin %}'}</dt>
          <dd>Un texto que aparece solo si se cumple la condición.</dd>
        </div>
        <div>
          <dt className="font-mono text-tinta">{'{% para cada cuota en acuerdo.plan %} … {% fin %}'}</dt>
          <dd>Una cláusula que se repite por cada elemento de una lista.</dd>
        </div>
        <div>
          <dt className="font-mono text-tinta"># Título · ## Subtítulo · **negrita**</dt>
          <dd>Una línea en blanco separa párrafos. {'{# comentario #}'} no sale en el acta.</dd>
        </div>
        <div>
          <dt className="text-tinta">Formatos</dt>
          <dd className="font-mono text-xs">
            moneda · moneda_en_letras · fecha · fecha_en_letras · numero · numero_en_letras · mayusculas · minusculas
          </dd>
        </div>
      </dl>
    </details>
  )
}
