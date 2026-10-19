'use client'

import { Check, Copy, UserPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { invitarMiembro } from '@/app/acciones/identidad'
import { enlaceInvitacion } from '@/lib/cuenta/invitacion'
import { AvisoError, BotonPrincipal, Campo } from './Campo'

const ROLES = [
  { valor: 'MEMBER', nombre: 'Miembro', texto: 'Conciliadores y asistentes del centro' },
  { valor: 'EXTERNAL', nombre: 'Externo', texto: 'Partes y apoderados de un caso' },
  { valor: 'ADMIN', nombre: 'Administrador', texto: 'Gestiona miembros; no ve casos ajenos' },
] as const

type Rol = (typeof ROLES)[number]['valor']
type Enlace = { correo: string; url: string; vence: string }

/**
 * Sin servicio de correo: el enlace se muestra UNA vez y el administrador lo comparte por un canal
 * de confianza. El servidor solo guarda el hash del token.
 */
export function InvitarMiembro() {
  const router = useRouter()
  const [rol, setRol] = useState<Rol>('MEMBER')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [enlace, setEnlace] = useState<Enlace | null>(null)
  const [copiado, setCopiado] = useState(false)
  // Una clave por invitacion: si el envio se repite, el servidor no crea dos.
  const [idempotencia, setIdempotencia] = useState(() => crypto.randomUUID())

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const formulario = evento.currentTarget
    const correo = String(new FormData(formulario).get('correo') ?? '')
    setOcupado(true)
    setError(null)
    setCampos({})
    setCopiado(false)
    try {
      const respuesta = await invitarMiembro({ correo, rol, idempotencia })
      if (!respuesta.ok) {
        setError(respuesta.mensaje)
        setCampos(respuesta.campos ?? {})
        return
      }
      setEnlace({
        correo: correo.trim().toLowerCase(),
        url: enlaceInvitacion(window.location.origin, respuesta.token),
        vence: respuesta.vence,
      })
      setIdempotencia(crypto.randomUUID())
      formulario.reset()
      router.refresh()
    } catch (problema) {
      console.error(problema)
      setError('No se pudo crear la invitación. Intenta de nuevo.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="grid gap-6">
      <form onSubmit={enviar} noValidate className="grid gap-5">
        <Campo
          etiqueta="Correo de la persona"
          name="correo"
          type="email"
          required
          inputMode="email"
          error={campos.correo}
        />
        <fieldset>
          <legend className="text-sm font-medium">Rol</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {ROLES.map((opcion) => (
              <label
                key={opcion.valor}
                className="cursor-pointer rounded-lg border border-linea bg-superficie p-3 text-sm transition has-[:checked]:border-institucional has-[:checked]:bg-institucional-suave"
              >
                <input
                  type="radio"
                  name="rol"
                  value={opcion.valor}
                  checked={rol === opcion.valor}
                  onChange={() => setRol(opcion.valor)}
                  className="sr-only"
                />
                <span className="block font-semibold">{opcion.nombre}</span>
                <span className="mt-0.5 block text-xs text-tinta-suave">{opcion.texto}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <AvisoError mensaje={error} />
        <BotonPrincipal ocupado={ocupado} textoOcupado="Creando la invitación…">
          <UserPlus aria-hidden className="size-4" /> Crear enlace de invitación
        </BotonPrincipal>
      </form>

      {enlace ? (
        <div role="status" className="rounded-xl border border-exito/40 bg-superficie p-4">
          <p className="text-sm font-semibold">Invitación lista para {enlace.correo}</p>
          <p className="mt-1 text-xs text-tinta-suave">
            Compártela por un canal de confianza. Se muestra solo esta vez y vence el{' '}
            {enlace.vence ? new Date(enlace.vence).toLocaleDateString('es-CO', { dateStyle: 'long' }) : '—'}.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              readOnly
              value={enlace.url}
              aria-label="Enlace de invitación"
              onFocus={(evento) => evento.currentTarget.select()}
              className="min-w-0 flex-1 rounded-lg border border-linea bg-papel-hondo px-3 py-2 font-mono text-xs"
            />
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(enlace.url)
                  setCopiado(true)
                } catch {
                  setCopiado(false)
                }
              }}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-institucional px-3 py-2 text-xs font-semibold text-sobre-institucional"
            >
              {copiado ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
              {copiado ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
