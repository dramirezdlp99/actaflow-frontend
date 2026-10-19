'use client'

import { Check, Copy, Download } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { confirmarAlta, registrarCuenta } from '@/app/acciones/identidad'
import { guardarClavePrivada } from '@/lib/cripto/almacen'
import { LARGO_MINIMO_CONTRASENA, revisarContrasena, type ClavesDerivadas } from '@/lib/cripto/claves'
import { abrirKit, prepararRegistro, textoKitRecuperacion } from '@/lib/cuenta/navegador'
import { leerInvitacion } from '@/lib/cuenta/invitacion'
import { AvisoError, BotonPrincipal, Campo } from './Campo'
import { CodigoQr } from './CodigoQr'
import { HojaTramite } from './MarcoCuenta'

type Inscripcion = { inscripcion: string; secreto: string; uri: string }
/** Lo que se muestra en el kit de recuperacion (solo en memoria de esta pestana). */
type DatosKit = { correo: string; claveRecuperacion: string; huella: string }
type Paso =
  | { tipo: 'datos' }
  | { tipo: 'totp'; inscripcion: Inscripcion; kit: DatosKit }
  | { tipo: 'kit'; kit: DatosKit; codigos: string[] }

const PROBLEMAS = {
  corta: `Usa al menos ${LARGO_MINIMO_CONTRASENA} caracteres. Una frase de varias palabras es fácil de recordar.`,
  larga: 'Máximo 128 caracteres.',
  distintas: 'Las contraseñas no coinciden.',
} as const

// El token llega en el fragmento (#): el navegador nunca lo envia al servidor ni a los logs.
// Se recuerda aqui y, despues de pintar, se quita de la barra de direcciones (ver el efecto).
let invitacionLeida: string | null = null

/** Lectura sin efectos secundarios: React la llama durante el render. */
function invitacionDelFragmento(): string | null {
  const nueva = leerInvitacion(window.location.hash)
  if (nueva) {
    invitacionLeida = nueva
  }
  return invitacionLeida
}

function alCambiarFragmento(avisar: () => void): () => void {
  window.addEventListener('hashchange', avisar)
  return () => window.removeEventListener('hashchange', avisar)
}

export function FormularioRegistro() {
  const router = useRouter()
  // undefined en el servidor (no hay fragmento alli); en el navegador, el token o null.
  const invitacion = useSyncExternalStore(alCambiarFragmento, invitacionDelFragmento, () => undefined)
  const [paso, setPaso] = useState<Paso>({ tipo: 'datos' })
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [idempotencia] = useState(() => crypto.randomUUID())

  useEffect(() => {
    // Fuera del render (Next no permite cambiar la URL mientras React pinta). No cambia estado.
    if (invitacion && window.location.hash) {
      window.history.replaceState(window.history.state, '', window.location.pathname)
    }
  }, [invitacion])
  // La clave derivada de la contrasena: solo en memoria de esta pestana, nunca en el estado visible.
  const claves = useRef<ClavesDerivadas | null>(null)

  async function enviarDatos(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (!invitacion) {
      return
    }
    const formulario = new FormData(evento.currentTarget)
    const correo = String(formulario.get('correo') ?? '')
    const nombre = String(formulario.get('nombre') ?? '')
    const contrasena = String(formulario.get('contrasena') ?? '')
    const problema = revisarContrasena(contrasena, String(formulario.get('confirmacion') ?? ''))
    setError(null)
    setCampos({})
    if (problema) {
      setCampos(problema === 'distintas' ? { confirmacion: PROBLEMAS[problema] } : { contrasena: PROBLEMAS[problema] })
      return
    }
    setOcupado('Creando tus claves en este navegador…')
    try {
      const preparado = await prepararRegistro({ invitacion, correo, nombre, contrasena, idempotencia })
      setOcupado('Registrando la cuenta…')
      const respuesta = await registrarCuenta(preparado.datos)
      if (!respuesta.ok) {
        setError(respuesta.mensaje)
        setCampos(respuesta.campos ?? {})
        return
      }
      claves.current = preparado.claves
      setPaso({
        tipo: 'totp',
        inscripcion: respuesta,
        kit: {
          correo: preparado.datos.correo.trim().toLowerCase(),
          claveRecuperacion: preparado.claveRecuperacion,
          huella: preparado.huella,
        },
      })
    } catch (problema) {
      console.error(problema)
      setError('No se pudo crear la cuenta. Revisa tu conexión e intenta de nuevo.')
    } finally {
      setOcupado(null)
    }
  }

  async function enviarCodigo(evento: React.FormEvent<HTMLFormElement>, inscripcion: Inscripcion, kit: DatosKit) {
    evento.preventDefault()
    const codigo = String(new FormData(evento.currentTarget).get('codigo') ?? '').trim()
    setError(null)
    setCampos({})
    setOcupado('Confirmando…')
    try {
      const respuesta = await confirmarAlta({ inscripcion: inscripcion.inscripcion, codigo })
      if (!respuesta.ok) {
        setError(respuesta.mensaje)
        setCampos(respuesta.campos ?? {})
        return
      }
      if (claves.current && respuesta.kit) {
        try {
          await guardarClavePrivada(respuesta.cuentaId, await abrirKit(claves.current, respuesta.kit))
        } catch (problema) {
          console.warn('No se pudo guardar la clave privada en este navegador', problema)
        }
      }
      claves.current = null
      setPaso({ tipo: 'kit', kit, codigos: respuesta.codigos })
    } catch (problema) {
      console.error(problema)
      setError('No se pudo confirmar el código. Intenta de nuevo.')
    } finally {
      setOcupado(null)
    }
  }

  if (invitacion === undefined) {
    return (
      <HojaTramite paso={1} total={3} titulo="Leyendo tu invitación…">
        <p className="text-sm text-tinta-suave">Un momento.</p>
      </HojaTramite>
    )
  }

  if (invitacion === null) {
    return (
      <HojaTramite paso={1} total={3} titulo="Necesitas una invitación">
        <p className="leading-relaxed text-tinta-suave">
          En ActaFlow nadie se registra solo: el administrador de tu centro de conciliación te envía un enlace de
          invitación personal. Ábrelo completo, tal como te llegó (incluye todo lo que va después del símbolo #).
        </p>
        <p className="mt-5 text-sm">
          ¿Ya tienes cuenta?{' '}
          <Link href="/ingresar" className="font-medium text-institucional underline-offset-4 hover:underline">
            Ingresar
          </Link>
        </p>
      </HojaTramite>
    )
  }

  if (paso.tipo === 'totp') {
    return (
      <HojaTramite paso={2} total={3} titulo="Configura tu app autenticadora">
        <ol className="grid gap-4 text-sm leading-relaxed text-tinta-suave">
          <li>
            <strong className="text-tinta">1.</strong> Abre Google Authenticator, Microsoft Authenticator, Aegis u otra
            app TOTP y escanea este código.
          </li>
        </ol>
        <div className="mt-5 grid items-center gap-6 sm:grid-cols-[auto_1fr]">
          <CodigoQr texto={paso.inscripcion.uri} etiqueta="Código QR para tu app autenticadora" />
          <div className="min-w-0">
            <p className="folio text-tinta-suave">¿No puedes escanear?</p>
            <p className="mt-2 text-sm text-tinta-suave">Escribe esta clave en la app:</p>
            <p className="mt-2 break-words rounded-lg bg-papel-hondo px-3 py-2 font-mono text-sm tracking-wider">
              {(paso.inscripcion.secreto.match(/.{1,4}/g) ?? []).join(' ')}
            </p>
          </div>
        </div>
        <form
          onSubmit={(evento) => enviarCodigo(evento, paso.inscripcion, paso.kit)}
          noValidate
          className="mt-7 grid gap-5"
        >
          <Campo
            etiqueta="2. Escribe el código de 6 dígitos que muestra la app"
            name="codigo"
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="000000"
            className="[&_input]:font-mono [&_input]:text-lg [&_input]:tracking-[0.3em]"
            error={campos.codigo}
          />
          <AvisoError mensaje={error} />
          <BotonPrincipal ocupado={ocupado !== null} textoOcupado={ocupado ?? undefined}>
            Confirmar
          </BotonPrincipal>
        </form>
      </HojaTramite>
    )
  }

  if (paso.tipo === 'kit') {
    return (
      <KitRecuperacion
        {...paso.kit}
        codigos={paso.codigos}
        alTerminar={() => {
          router.replace('/panel')
          router.refresh()
        }}
      />
    )
  }

  return (
    <HojaTramite paso={1} total={3} titulo="Tus datos">
      <form onSubmit={enviarDatos} noValidate className="grid gap-5">
        <Campo
          etiqueta="Correo (el mismo al que te invitaron)"
          name="correo"
          type="email"
          required
          autoComplete="username"
          inputMode="email"
          error={campos.correo}
        />
        <Campo
          etiqueta="Nombre que verán los demás"
          name="nombre"
          required
          autoComplete="name"
          minLength={2}
          maxLength={120}
          error={campos.nombre}
        />
        <Campo
          etiqueta="Contraseña"
          name="contrasena"
          type="password"
          required
          autoComplete="new-password"
          minLength={LARGO_MINIMO_CONTRASENA}
          ayuda={`Al menos ${LARGO_MINIMO_CONTRASENA} caracteres. Nadie puede restablecerla por ti: si la olvidas, necesitarás tu kit de recuperación.`}
          error={campos.contrasena}
        />
        <Campo
          etiqueta="Repite la contraseña"
          name="confirmacion"
          type="password"
          required
          autoComplete="new-password"
          error={campos.confirmacion}
        />
        <AvisoError mensaje={error ?? (campos.invitacion ? 'El enlace de invitación está incompleto.' : null)} />
        <BotonPrincipal ocupado={ocupado !== null} textoOcupado={ocupado ?? undefined}>
          Crear cuenta
        </BotonPrincipal>
      </form>
    </HojaTramite>
  )
}

function KitRecuperacion({
  correo,
  claveRecuperacion,
  huella,
  codigos,
  alTerminar,
}: {
  correo: string
  claveRecuperacion: string
  huella: string
  codigos: string[]
  alTerminar: () => void
}) {
  const [guardado, setGuardado] = useState(false)
  const [copiado, setCopiado] = useState(false)
  const texto = textoKitRecuperacion({ correo, claveRecuperacion, codigos, huella, fecha: new Date() })

  function descargar() {
    const enlace = document.createElement('a')
    enlace.href = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }))
    enlace.download = 'actaflow-kit-de-recuperacion.txt'
    enlace.click()
    URL.revokeObjectURL(enlace.href)
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
    } catch {
      setCopiado(false)
    }
  }

  return (
    <HojaTramite paso={3} total={3} titulo="Guarda tu kit de recuperación">
      <div className="relative">
        <span
          aria-hidden
          className="sello absolute -top-16 right-0 grid size-16 sm:-top-14 sm:size-20 rotate-[-12deg] place-items-center rounded-full border-2 border-lacre text-center text-[0.5rem] font-bold uppercase sm:text-[0.6rem] leading-tight tracking-widest text-lacre"
          style={{ '--retraso-sello': '0.2s' }}
        >
          Cuenta
          <br />
          creada
        </span>
        <p className="max-w-prose pr-14 text-sm leading-relaxed text-tinta-suave sm:pr-24">
          Se muestra <strong className="text-tinta">una sola vez</strong>. Sin él, si pierdes el teléfono o olvidas la
          contraseña, nadie podrá devolverte el acceso: ni ActaFlow ni tu centro conocen tus claves.
        </p>
        <p className="folio mt-6 text-tinta-suave">Clave de recuperación</p>
        <p className="mt-2 break-words rounded-lg bg-papel-hondo px-3 py-2.5 font-mono text-sm tracking-wider">
          {claveRecuperacion}
        </p>
        <p className="folio mt-6 text-tinta-suave">Códigos de un solo uso</p>
        <ol className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 font-mono text-sm sm:grid-cols-2">
          {codigos.map((codigo, i) => (
            <li key={codigo} className="flex gap-2">
              <span className="text-tinta-suave">{String(i + 1).padStart(2, '0')}</span>
              {codigo}
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={descargar}
            className="inline-flex items-center gap-2 rounded-lg border border-linea bg-superficie px-4 py-2 text-sm font-medium transition hover:border-institucional"
          >
            <Download aria-hidden className="size-4" /> Descargar .txt
          </button>
          <button
            type="button"
            onClick={copiar}
            className="inline-flex items-center gap-2 rounded-lg border border-linea bg-superficie px-4 py-2 text-sm font-medium transition hover:border-institucional"
          >
            {copiado ? <Check aria-hidden className="size-4 text-exito" /> : <Copy aria-hidden className="size-4" />}
            {copiado ? 'Copiado' : 'Copiar'}
          </button>
        </div>
        <label className="mt-7 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={guardado}
            onChange={(evento) => setGuardado(evento.target.checked)}
            className="mt-0.5 size-4 accent-[var(--institucional)]"
          />
          Guardé mi kit fuera de este computador (impreso o en un gestor de contraseñas).
        </label>
        <div className="mt-5">
          <BotonPrincipal type="button" disabled={!guardado} onClick={alTerminar}>
            Entrar a mi panel
          </BotonPrincipal>
        </div>
      </div>
    </HojaTramite>
  )
}
