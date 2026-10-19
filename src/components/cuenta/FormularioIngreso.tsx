'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { completarIngreso, ingresar, parametrosDeIngreso } from '@/app/acciones/identidad'
import { guardarClavePrivada } from '@/lib/cripto/almacen'
import type { ClavesDerivadas } from '@/lib/cripto/claves'
import { abrirKit, prepararIngreso } from '@/lib/cuenta/navegador'
import { AvisoError, BotonPrincipal, Campo } from './Campo'
import { HojaTramite } from './MarcoCuenta'

type Paso = 'credenciales' | 'factor'

export function FormularioIngreso({ destino }: { destino: string }) {
  const router = useRouter()
  const [paso, setPaso] = useState<Paso>('credenciales')
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [campos, setCampos] = useState<Record<string, string>>({})
  const [usarRecuperacion, setUsarRecuperacion] = useState(false)
  // La clave derivada de la contrasena vive solo en memoria, entre el paso 1 y el 2.
  const claves = useRef<ClavesDerivadas | null>(null)

  async function enviarCredenciales(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const formulario = new FormData(evento.currentTarget)
    const correo = String(formulario.get('correo') ?? '')
    const contrasena = String(formulario.get('contrasena') ?? '')
    setError(null)
    setCampos({})
    if (!contrasena) {
      setCampos({ contrasena: 'Escribe tu contraseña' })
      return
    }
    setOcupado('Consultando…')
    try {
      const parametros = await parametrosDeIngreso(correo)
      if (!parametros.ok) {
        setError(parametros.mensaje)
        setCampos(parametros.campos ?? {})
        return
      }
      setOcupado('Derivando tu clave en este navegador…')
      const preparado = await prepararIngreso(contrasena, parametros)
      setOcupado('Verificando…')
      const respuesta = await ingresar({ correo, verificador: preparado.verificador })
      if (!respuesta.ok) {
        setError(respuesta.mensaje)
        return
      }
      claves.current = preparado.claves
      setPaso('factor')
    } catch (problema) {
      console.error(problema)
      setError('No se pudo completar el ingreso. Revisa tu conexión e intenta de nuevo.')
    } finally {
      setOcupado(null)
    }
  }

  async function enviarFactor(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    const codigo = String(new FormData(evento.currentTarget).get('codigo') ?? '').trim()
    setError(null)
    setCampos({})
    setOcupado('Comprobando el código…')
    try {
      const respuesta = await completarIngreso(
        usarRecuperacion ? { tipo: 'recuperacion', codigo } : { tipo: 'totp', codigo },
      )
      if (!respuesta.ok) {
        setError(respuesta.mensaje)
        setCampos(respuesta.campos ?? {})
        if ('reiniciar' in respuesta) {
          claves.current = null
          setPaso('credenciales')
        }
        return
      }
      setOcupado('Abriendo tu clave privada…')
      if (claves.current && respuesta.kit) {
        try {
          await guardarClavePrivada(respuesta.cuentaId, await abrirKit(claves.current, respuesta.kit))
        } catch (problema) {
          // La sesion ya esta abierta; la clave se volvera a abrir en el siguiente ingreso.
          console.warn('No se pudo abrir la clave privada en este navegador', problema)
        }
      }
      claves.current = null
      router.replace(respuesta.restantes <= 3 && usarRecuperacion ? '/panel?aviso=codigos' : destino)
      router.refresh()
    } catch (problema) {
      console.error(problema)
      setError('No se pudo completar el ingreso. Intenta de nuevo.')
      setOcupado(null)
    }
  }

  if (paso === 'factor') {
    return (
      <HojaTramite paso={2} total={2} titulo="Segundo factor">
        <form onSubmit={enviarFactor} noValidate className="grid gap-5">
          <p className="text-sm leading-relaxed text-tinta-suave">
            {usarRecuperacion
              ? 'Escribe uno de los códigos de tu kit de recuperación. Cada uno sirve una sola vez.'
              : 'Abre tu app autenticadora y escribe el código de 6 dígitos de ActaFlow.'}
          </p>
          <Campo
            key={usarRecuperacion ? 'recuperacion' : 'totp'}
            etiqueta={usarRecuperacion ? 'Código de recuperación' : 'Código de la app'}
            name="codigo"
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode={usarRecuperacion ? 'text' : 'numeric'}
            pattern={usarRecuperacion ? '[A-Za-z0-9]{5}-[A-Za-z0-9]{5}' : '[0-9]{6}'}
            maxLength={usarRecuperacion ? 11 : 6}
            placeholder={usarRecuperacion ? 'XXXXX-XXXXX' : '000000'}
            className="[&_input]:font-mono [&_input]:text-lg [&_input]:tracking-[0.3em]"
            error={campos.codigo}
          />
          <AvisoError mensaje={error} />
          <BotonPrincipal ocupado={ocupado !== null} textoOcupado={ocupado ?? undefined}>
            Entrar
          </BotonPrincipal>
          <button
            type="button"
            onClick={() => {
              setUsarRecuperacion((valor) => !valor)
              setError(null)
              setCampos({})
            }}
            className="justify-self-start text-sm font-medium text-institucional underline-offset-4 hover:underline"
          >
            {usarRecuperacion ? 'Usar el código de la app' : 'No tengo el teléfono: usar un código de recuperación'}
          </button>
        </form>
      </HojaTramite>
    )
  }

  return (
    <HojaTramite paso={1} total={2} titulo="Correo y contraseña">
      <form onSubmit={enviarCredenciales} noValidate className="grid gap-5">
        <Campo
          etiqueta="Correo"
          name="correo"
          type="email"
          required
          autoComplete="username"
          inputMode="email"
          error={campos.correo}
        />
        <Campo
          etiqueta="Contraseña"
          name="contrasena"
          type="password"
          required
          autoComplete="current-password"
          error={campos.contrasena}
        />
        <AvisoError mensaje={error} />
        <BotonPrincipal ocupado={ocupado !== null} textoOcupado={ocupado ?? undefined}>
          Continuar
        </BotonPrincipal>
        <p className="text-sm text-tinta-suave">
          ¿No tienes cuenta? Las cuentas se crean con el enlace de invitación que te envía el administrador de tu
          centro.{' '}
          <Link href="/como-funciona" className="font-medium text-institucional underline-offset-4 hover:underline">
            Cómo funciona
          </Link>
        </p>
      </form>
    </HojaTramite>
  )
}
