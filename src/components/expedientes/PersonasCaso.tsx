'use client'

import { KeyRound, ShieldCheck, UserMinus, UserPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  cambiarRolParticipante,
  clavePublicaParticipante,
  entregarClave,
  invitarParticipante,
  retirarParticipante,
} from '@/app/acciones/expedientes'
import { AvisoError, BotonPrincipal, Campo } from '@/components/cuenta/Campo'
import { CaseRole } from '@/gen/actaflow/cases/v1/case_pb'
import { ParticipantState } from '@/gen/actaflow/cases/v1/participant_pb'
import { desdeBase64Url } from '@/lib/cripto/bytes'
import { envolverClave } from '@/lib/cripto/casos'
import { CALIDAD, ESTADO_PERSONA, LADO, ROL } from '@/lib/expedientes/etiquetas'
import { envolturaATexto } from '@/lib/expedientes/formato'
import type { VistaPersona } from '@/lib/expedientes/servidor'
import { useClaveCaso } from './ClaveCaso'

type Props = {
  casoId: string
  personas: VistaPersona[]
  yo: { participanteId: string; rol: CaseRole }
  editable: boolean
}

const TONO: Record<ParticipantState, string> = {
  [ParticipantState.UNSPECIFIED]: 'bg-papel-hondo text-tinta-suave',
  [ParticipantState.INVITED]: 'bg-papel-hondo text-tinta-suave',
  [ParticipantState.AWAITING_KEY]: 'bg-lacre-suave text-alerta',
  [ParticipantState.ACTIVE]: 'bg-institucional-suave text-exito',
}

/** Huella en grupos de 4, para leerla en voz alta y compararla en persona. */
const agrupar = (huella: string) => (huella.slice(0, 32).match(/.{1,4}/g) ?? []).join(' ')

export function PersonasCaso({ casoId, personas, yo, editable }: Props) {
  const router = useRouter()
  const clave = useClaveCaso()
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [verificando, setVerificando] = useState<{
    persona: VistaPersona
    idClave: string
    publica: string
    huella: string
  } | null>(null)
  const soyConciliador = yo.rol === CaseRole.CONCILIATOR

  async function prepararEntrega(persona: VistaPersona) {
    setError(null)
    setOcupado(persona.id)
    const respuesta = await clavePublicaParticipante({ casoId, participanteId: persona.id })
    setOcupado(null)
    if (!respuesta.ok) {
      setError(respuesta.mensaje)
      return
    }
    setVerificando({ persona, idClave: respuesta.idClave, publica: respuesta.publica, huella: respuesta.huella })
  }

  async function confirmarEntrega() {
    if (!verificando || clave.tipo !== 'lista') {
      return
    }
    setOcupado(verificando.persona.id)
    try {
      const envoltura = await envolverClave(clave.clave, {
        idClave: verificando.idClave,
        publica: desdeBase64Url(verificando.publica),
      })
      const respuesta = await entregarClave({
        casoId,
        participanteId: verificando.persona.id,
        clave: envolturaATexto(envoltura),
      })
      if (!respuesta.ok) {
        setError(respuesta.mensaje)
        return
      }
      setVerificando(null)
      router.refresh()
    } catch (problema) {
      console.error(problema)
      setError('No se pudo envolver la clave para esa persona.')
    } finally {
      setOcupado(null)
    }
  }

  async function ejecutar(id: string, accion: () => Promise<{ ok: boolean; mensaje?: string }>) {
    setError(null)
    setOcupado(id)
    const respuesta = await accion()
    setOcupado(null)
    if (!respuesta.ok) {
      setError(respuesta.mensaje ?? 'No se pudo completar la acción.')
      return
    }
    router.refresh()
  }

  return (
    <div className="grid gap-5">
      <ul className="divide-y divide-linea" aria-label="Participantes">
        {personas.map((p) => {
          const esYo = p.id === yo.participanteId
          const parte = p.rol === CaseRole.PARTY
          return (
            <li key={p.id} className="py-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {p.nombre}
                    {esYo ? <span className="text-tinta-suave"> (tú)</span> : null}
                  </p>
                  <p className="truncate text-xs text-tinta-suave">{p.correo}</p>
                  <p className="mt-1 text-xs">
                    <span className="font-semibold text-institucional">{ROL[p.rol]}</span>
                    {parte ? (
                      <span className="text-tinta-suave">
                        {' '}
                        · {LADO[p.lado]} {CALIDAD[p.calidad]}
                      </span>
                    ) : null}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TONO[p.estado]}`}>
                  {ESTADO_PERSONA[p.estado]}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {p.estado === ParticipantState.AWAITING_KEY && clave.tipo === 'lista' && editable ? (
                  <button
                    type="button"
                    disabled={ocupado !== null}
                    onClick={() => prepararEntrega(p)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-institucional px-3 py-1.5 text-xs font-semibold text-sobre-institucional disabled:opacity-60"
                  >
                    <KeyRound aria-hidden className="size-3.5" /> Entregar clave
                  </button>
                ) : null}
                {soyConciliador && editable && !esYo && !parte ? (
                  <button
                    type="button"
                    disabled={ocupado !== null}
                    onClick={() =>
                      ejecutar(p.id, () =>
                        cambiarRolParticipante({
                          casoId,
                          participanteId: p.id,
                          rol: p.rol === CaseRole.CONCILIATOR ? 'ASSISTANT' : 'CONCILIATOR',
                        }),
                      )
                    }
                    className="rounded-lg border border-linea px-3 py-1.5 text-xs font-medium hover:border-institucional disabled:opacity-60"
                  >
                    {p.rol === CaseRole.CONCILIATOR ? 'Pasar a asistente' : 'Hacer conciliador'}
                  </button>
                ) : null}
                {soyConciliador && editable && !esYo ? (
                  <button
                    type="button"
                    disabled={ocupado !== null}
                    onClick={() => {
                      if (window.confirm(`¿Retirar a ${p.nombre} del expediente?`)) {
                        void ejecutar(p.id, () => retirarParticipante({ casoId, participanteId: p.id }))
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-linea px-3 py-1.5 text-xs font-medium hover:border-lacre hover:text-lacre disabled:opacity-60"
                  >
                    <UserMinus aria-hidden className="size-3.5" /> Retirar
                  </button>
                ) : null}
              </div>
              {verificando?.persona.id === p.id ? (
                <div
                  role="dialog"
                  aria-label="Verificar huella"
                  className="mt-3 rounded-xl border border-ia/40 bg-ia-suave/40 p-4"
                >
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <ShieldCheck aria-hidden className="size-4 text-ia" /> Compara la huella con {p.nombre}
                  </p>
                  <p className="mt-2 text-xs text-tinta-suave">
                    Pídele que lea la huella de su clave en su panel. Si coincide, nadie se hizo pasar por esa persona.
                  </p>
                  <p className="mt-3 font-mono text-sm tracking-wider" data-prueba="huella">
                    {agrupar(verificando.huella)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={ocupado !== null}
                      onClick={confirmarEntrega}
                      className="rounded-lg bg-institucional px-3 py-1.5 text-xs font-semibold text-sobre-institucional disabled:opacity-60"
                    >
                      {ocupado === p.id ? 'Envolviendo…' : 'Coincide: entregar la clave'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setVerificando(null)}
                      className="rounded-lg border border-linea px-3 py-1.5 text-xs font-medium"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      <AvisoError mensaje={error} />
      {soyConciliador && editable ? <InvitarAlCaso casoId={casoId} /> : null}
    </div>
  )
}

function InvitarAlCaso({ casoId }: { casoId: string }) {
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [rol, setRol] = useState<'ASSISTANT' | 'PARTY' | 'CONCILIATOR'>('PARTY')
  const [lado, setLado] = useState<'CLAIMANT' | 'RESPONDENT'>('CLAIMANT')
  const [calidad, setCalidad] = useState<'PRINCIPAL' | 'ATTORNEY'>('PRINCIPAL')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [idempotencia, setIdempotencia] = useState(() => crypto.randomUUID())

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex items-center gap-2 justify-self-start rounded-lg border border-linea bg-superficie px-4 py-2 text-sm font-medium hover:border-institucional"
      >
        <UserPlus aria-hidden className="size-4" /> Invitar al expediente
      </button>
    )
  }

  async function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const formulario = evento.currentTarget
    const datos = new FormData(formulario)
    setOcupado(true)
    setError(null)
    setCampos({})
    const respuesta = await invitarParticipante({
      casoId,
      correo: String(datos.get('correo') ?? ''),
      nombre: String(datos.get('nombre') ?? ''),
      rol,
      lado: rol === 'PARTY' ? lado : undefined,
      calidad: rol === 'PARTY' ? calidad : undefined,
      idempotencia,
    })
    setOcupado(false)
    if (!respuesta.ok) {
      setError(respuesta.mensaje)
      setCampos(respuesta.campos ?? {})
      return
    }
    setIdempotencia(crypto.randomUUID())
    formulario.reset()
    setAbierto(false)
    router.refresh()
  }

  const opcion =
    'cursor-pointer rounded-lg border border-linea bg-superficie px-3 py-2 text-sm transition has-[:checked]:border-institucional has-[:checked]:bg-institucional-suave'

  return (
    <form onSubmit={enviar} noValidate className="grid gap-4 rounded-xl border border-linea bg-papel/60 p-4">
      <p className="text-sm text-tinta-suave">
        La persona necesita una cuenta de tu centro (el administrador la invita desde su panel). Al entrar, el
        expediente le aparece solo; luego alguien que tenga la clave se la entrega aquí.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Correo" name="correo" type="email" required inputMode="email" error={campos.correo} />
        <Campo etiqueta="Nombre" name="nombre" required error={campos.nombre} />
      </div>
      <fieldset>
        <legend className="text-sm font-medium">Rol en el expediente</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(['PARTY', 'ASSISTANT', 'CONCILIATOR'] as const).map((valor) => (
            <label key={valor} className={opcion}>
              <input
                type="radio"
                name="rol"
                className="sr-only"
                checked={rol === valor}
                onChange={() => setRol(valor)}
              />
              {ROL[CaseRole[valor]]}
            </label>
          ))}
        </div>
      </fieldset>
      {rol === 'PARTY' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset>
            <legend className="text-sm font-medium">Lado</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(['CLAIMANT', 'RESPONDENT'] as const).map((valor) => (
                <label key={valor} className={opcion}>
                  <input
                    type="radio"
                    name="lado"
                    className="sr-only"
                    checked={lado === valor}
                    onChange={() => setLado(valor)}
                  />
                  {valor === 'CLAIMANT' ? 'Convocante' : 'Convocado'}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-sm font-medium">Calidad</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(['PRINCIPAL', 'ATTORNEY'] as const).map((valor) => (
                <label key={valor} className={opcion}>
                  <input
                    type="radio"
                    name="calidad"
                    className="sr-only"
                    checked={calidad === valor}
                    onChange={() => setCalidad(valor)}
                  />
                  {valor === 'PRINCIPAL' ? 'En nombre propio' : 'Apoderado'}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      ) : null}
      <AvisoError mensaje={error} />
      <div className="flex flex-wrap gap-3">
        <div className="min-w-44">
          <BotonPrincipal ocupado={ocupado} textoOcupado="Invitando…">
            Invitar
          </BotonPrincipal>
        </div>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="rounded-lg border border-linea px-4 py-2 text-sm font-medium"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}
