'use client'

import { Lock } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { crearExpediente } from '@/app/acciones/expedientes'
import { AvisoError, BotonPrincipal, Campo } from '@/components/cuenta/Campo'
import { desdeBase64Url } from '@/lib/cripto/bytes'
import { cifrarDetalles, envolverClave, nuevaClaveCaso } from '@/lib/cripto/casos'
import { blobATexto, envolturaATexto } from '@/lib/expedientes/formato'

const TIPOS = [
  { valor: 'CONCILIATION', texto: 'Conciliación', ayuda: 'Audiencia extrajudicial (Ley 2220 de 2022)' },
  { valor: 'MEDIATION', texto: 'Mediación', ayuda: 'Sesión de mediación entre las partes' },
  { valor: 'CONTRACT', texto: 'Contrato', ayuda: 'Redacción y firma de un contrato' },
] as const

type Tipo = (typeof TIPOS)[number]['valor']

/**
 * Nuevo expediente. El titulo y el resumen se cifran AQUI con una clave nueva del caso, y esa clave
 * se envuelve para la clave publica de quien lo crea. Al servidor solo llegan metadatos y cifrado.
 */
export function FormularioExpediente({ miClave }: { miClave: { idClave: string; publica: string } }) {
  const router = useRouter()
  const [tipo, setTipo] = useState<Tipo>('CONCILIATION')
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [idempotencia] = useState(() => crypto.randomUUID())

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const formulario = new FormData(evento.currentTarget)
    const titulo = String(formulario.get('titulo') ?? '').trim()
    const resumen = String(formulario.get('resumen') ?? '').trim()
    const audiencia = String(formulario.get('audiencia') ?? '')
    setError(null)
    setCampos({})
    const problemas: Record<string, string> = {}
    if ([...titulo].length < 3 || [...titulo].length > 160) {
      problemas.titulo = 'Entre 3 y 160 caracteres'
    }
    if ([...resumen].length > 4000) {
      problemas.resumen = 'Máximo 4000 caracteres'
    }
    if (Object.keys(problemas).length > 0) {
      setCampos(problemas)
      return
    }
    setOcupado('Cifrando en este navegador…')
    try {
      const { clave, idClave } = await nuevaClaveCaso()
      const detalles = await cifrarDetalles(clave, idClave, { titulo, resumen })
      const envoltura = await envolverClave(clave, {
        idClave: miClave.idClave,
        publica: desdeBase64Url(miClave.publica),
      })
      setOcupado('Guardando el expediente…')
      const respuesta = await crearExpediente({
        radicado: String(formulario.get('radicado') ?? ''),
        tipo,
        detalles: blobATexto(detalles),
        clave: envolturaATexto(envoltura),
        audiencia: audiencia ? new Date(audiencia).toISOString() : undefined,
        idempotencia,
      })
      if (!respuesta.ok) {
        setError(respuesta.mensaje)
        setCampos(respuesta.campos ?? {})
        setOcupado(null)
        return
      }
      router.push(`/expedientes/${respuesta.id}`)
    } catch (problema) {
      console.error(problema)
      setError('No se pudo crear el expediente. Intenta de nuevo.')
      setOcupado(null)
    }
  }

  return (
    <form onSubmit={enviar} noValidate className="grid gap-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <Campo
          etiqueta="Radicado"
          name="radicado"
          required
          placeholder="CC-2026-0142"
          autoComplete="off"
          className="[&_input]:font-mono [&_input]:uppercase"
          ayuda="Único en tu centro. Letras, números y guiones."
          error={campos.radicado}
        />
        <Campo
          etiqueta="Primera audiencia (opcional)"
          name="audiencia"
          type="datetime-local"
          error={campos.audiencia}
        />
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Tipo de trámite</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {TIPOS.map((opcion) => (
            <label
              key={opcion.valor}
              className="cursor-pointer rounded-lg border border-linea bg-superficie p-3 text-sm transition has-[:checked]:border-institucional has-[:checked]:bg-institucional-suave"
            >
              <input
                type="radio"
                name="tipo"
                value={opcion.valor}
                checked={tipo === opcion.valor}
                onChange={() => setTipo(opcion.valor)}
                className="sr-only"
              />
              <span className="block font-semibold">{opcion.texto}</span>
              <span className="mt-0.5 block text-xs text-tinta-suave">{opcion.ayuda}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="rounded-xl border border-dashed border-ia/40 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-ia">
          <Lock aria-hidden className="size-4" /> Se cifra en tu navegador
        </p>
        <div className="mt-4 grid gap-5">
          <Campo
            etiqueta="Título"
            name="titulo"
            required
            maxLength={160}
            placeholder="Arrendamiento local comercial calle 18"
            error={campos.titulo}
          />
          <div>
            <label htmlFor="resumen" className="block text-sm font-medium">
              Resumen del conflicto
            </label>
            <textarea
              id="resumen"
              name="resumen"
              rows={5}
              maxLength={4000}
              aria-invalid={campos.resumen ? true : undefined}
              className="mt-1.5 block w-full rounded-lg border border-linea bg-superficie px-3.5 py-2.5 text-[0.95rem] outline-none transition focus:border-institucional focus:ring-2 focus:ring-institucional/25"
            />
            {campos.resumen ? <p className="mt-1.5 text-sm font-medium text-error">{campos.resumen}</p> : null}
          </div>
        </div>
      </div>
      <AvisoError mensaje={error} />
      <BotonPrincipal ocupado={ocupado !== null} textoOcupado={ocupado ?? undefined}>
        Crear expediente
      </BotonPrincipal>
    </form>
  )
}
