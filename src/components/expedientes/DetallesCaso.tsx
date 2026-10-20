'use client'

import { Lock, PencilLine } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { actualizarExpediente } from '@/app/acciones/expedientes'
import { AvisoError, BotonPrincipal, Campo } from '@/components/cuenta/Campo'
import { cifrarDetalles, descifrarDetalles, type Detalles } from '@/lib/cripto/casos'
import { blobATexto, textoABlob, type BlobTexto } from '@/lib/expedientes/formato'
import { AvisoClave, useClaveCaso } from './ClaveCaso'

type Props = {
  casoId: string
  revision: string
  detalles: BlobTexto | null
  puedeEditar: boolean
}

/** Titulo y resumen: llegan cifrados y se abren aqui con la clave del caso. */
export function DetallesCaso({ casoId, revision, detalles, puedeEditar }: Props) {
  const clave = useClaveCaso()
  const router = useRouter()
  const [claro, setClaro] = useState<Detalles | null>(null)
  const [fallo, setFallo] = useState(false)
  const [editando, setEditando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [campos, setCampos] = useState<Record<string, string>>({})
  const firma = detalles ? `${detalles.idClave}.${detalles.nonce}` : ''

  useEffect(() => {
    if (clave.tipo !== 'lista' || !detalles) {
      return
    }
    let vigente = true
    descifrarDetalles(clave.clave, textoABlob(detalles))
      .then((resultado) => vigente && (setClaro(resultado), setFallo(false)))
      .catch(() => vigente && setFallo(true))
    return () => {
      vigente = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `firma` resume el blob cifrado
  }, [clave, firma])

  async function guardar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (clave.tipo !== 'lista' || !detalles) {
      return
    }
    const formulario = new FormData(evento.currentTarget)
    const titulo = String(formulario.get('titulo') ?? '').trim()
    const resumen = String(formulario.get('resumen') ?? '').trim()
    if ([...titulo].length < 3 || [...titulo].length > 160) {
      setCampos({ titulo: 'Entre 3 y 160 caracteres' })
      return
    }
    setOcupado(true)
    setError(null)
    setCampos({})
    try {
      // Misma clave del caso, nonce nuevo: el servidor solo ve otro bloque cifrado.
      const nuevo = await cifrarDetalles(clave.clave, detalles.idClave, { titulo, resumen })
      const respuesta = await actualizarExpediente({
        casoId,
        revision,
        detalles: blobATexto(nuevo),
        idempotencia: crypto.randomUUID(),
      })
      if (!respuesta.ok) {
        setError(respuesta.mensaje)
        return
      }
      setClaro({ titulo, resumen })
      setEditando(false)
      router.refresh()
    } catch (problema) {
      console.error(problema)
      setError('No se pudo guardar. Intenta de nuevo.')
    } finally {
      setOcupado(false)
    }
  }

  if (clave.tipo !== 'lista') {
    return clave.tipo === 'abriendo' ? <Cargando /> : <AvisoClave estado={clave} />
  }
  if (fallo) {
    return <AvisoClave estado={{ tipo: 'error' }} />
  }
  if (!claro) {
    return <Cargando />
  }

  if (editando) {
    return (
      <form onSubmit={guardar} noValidate className="grid gap-4">
        <Campo etiqueta="Título" name="titulo" defaultValue={claro.titulo} maxLength={160} error={campos.titulo} />
        <div>
          <label htmlFor="resumen-edicion" className="block text-sm font-medium">
            Resumen
          </label>
          <textarea
            id="resumen-edicion"
            name="resumen"
            rows={6}
            maxLength={4000}
            defaultValue={claro.resumen}
            className="mt-1.5 block w-full rounded-lg border border-linea bg-superficie px-3.5 py-2.5 text-[0.95rem] outline-none focus:border-institucional focus:ring-2 focus:ring-institucional/25"
          />
        </div>
        <AvisoError mensaje={error} />
        <div className="flex flex-wrap gap-3">
          <div className="min-w-48">
            <BotonPrincipal ocupado={ocupado} textoOcupado="Cifrando y guardando…">
              Guardar cambios
            </BotonPrincipal>
          </div>
          <button
            type="button"
            onClick={() => setEditando(false)}
            className="rounded-lg border border-linea px-4 py-2 text-sm font-medium hover:border-institucional"
          >
            Cancelar
          </button>
        </div>
      </form>
    )
  }

  return (
    <div>
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-ia">
        <Lock aria-hidden className="size-3.5" /> Descifrado en tu navegador
      </p>
      <h2 className="titular mt-2 text-2xl sm:text-3xl" data-prueba="titulo-caso">
        {claro.titulo}
      </h2>
      {claro.resumen ? (
        <p className="mt-4 whitespace-pre-line leading-relaxed text-tinta-suave">{claro.resumen}</p>
      ) : (
        <p className="mt-4 text-sm italic text-tinta-suave">Sin resumen.</p>
      )}
      {puedeEditar ? (
        <button
          type="button"
          onClick={() => setEditando(true)}
          className="mt-6 inline-flex items-center gap-2 rounded-lg border border-linea bg-superficie px-4 py-2 text-sm font-medium transition hover:border-institucional"
        >
          <PencilLine aria-hidden className="size-4" /> Editar
        </button>
      ) : null}
    </div>
  )
}

function Cargando() {
  return (
    <div aria-busy className="grid gap-3">
      <span className="sr-only">Descifrando…</span>
      <span className="h-8 w-3/4 animate-pulse rounded bg-papel-hondo" />
      <span className="h-4 w-full animate-pulse rounded bg-papel-hondo" />
      <span className="h-4 w-5/6 animate-pulse rounded bg-papel-hondo" />
    </div>
  )
}
