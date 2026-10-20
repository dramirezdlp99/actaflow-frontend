import type { Metadata } from 'next'
import Link from 'next/link'
import { FormularioExpediente } from '@/components/expedientes/FormularioExpediente'
import { Encabezado } from '@/components/marca/Encabezado'
import { PiePagina } from '@/components/marca/PiePagina'
import { PlatformRole } from '@/gen/actaflow/identity/v1/account_pb'
import { clavePublicaDe } from '@/lib/expedientes/servidor'
import { exigirSesion } from '@/lib/sesion/sesion'

export const metadata: Metadata = { title: 'Nuevo expediente' }
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export default async function NuevoExpediente() {
  const sesion = await exigirSesion('/expedientes/nuevo')
  const externo = sesion.cuenta.role === PlatformRole.EXTERNAL
  // La clave del caso se envuelve en el navegador para la clave publica de quien lo crea.
  const miClave = externo ? null : await clavePublicaDe(sesion, sesion.cuenta.id)

  return (
    <>
      <Encabezado enSesion />
      <main id="contenido" className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <Link href="/expedientes" prefetch={false} className="text-sm font-medium text-institucional hover:underline">
          ← Expedientes
        </Link>
        <p className="folio entrada mt-6 text-lacre">Radicación</p>
        <h1 className="titular entrada mt-3 text-4xl" style={{ '--i': 1 }}>
          Nuevo expediente
        </h1>
        <p className="entrada mt-3 text-tinta-suave" style={{ '--i': 2 }}>
          Quedarás como conciliador del caso. Después podrás invitar a las partes, sus apoderados y a tu asistente.
        </p>
        <section className="hoja entrada mt-8 rounded-2xl py-8 pl-14 pr-5 sm:pl-16 sm:pr-10" style={{ '--i': 3 }}>
          {externo ? (
            <p className="text-tinta-suave">Las cuentas externas no crean expedientes: te invitan a ellos.</p>
          ) : miClave ? (
            <FormularioExpediente miClave={{ idClave: miClave.idClave, publica: miClave.publica }} />
          ) : (
            <p className="text-tinta-suave">No se encontró tu clave pública. Cierra sesión y vuelve a ingresar.</p>
          )}
        </section>
      </main>
      <PiePagina />
    </>
  )
}
