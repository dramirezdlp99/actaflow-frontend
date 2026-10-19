import { timestampDate } from '@bufbuild/protobuf/wkt'
import { Building2, ShieldAlert } from 'lucide-react'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { BotonSalir } from '@/components/cuenta/BotonSalir'
import { InvitarMiembro } from '@/components/cuenta/InvitarMiembro'
import { Encabezado } from '@/components/marca/Encabezado'
import { PiePagina } from '@/components/marca/PiePagina'
import { PlatformRole } from '@/gen/actaflow/identity/v1/account_pb'
import { clientes, comoPersona, exigirSesion, type SesionActual } from '@/lib/sesion/sesion'

export const metadata: Metadata = { title: 'Mi panel' }
// Pagina personal: siempre en el servidor, en cada peticion, nunca en una cache compartida.
export const dynamic = 'force-dynamic'

const NOMBRE_ROL: Record<PlatformRole, string> = {
  [PlatformRole.UNSPECIFIED]: 'Sin rol',
  [PlatformRole.ADMIN]: 'Administrador',
  [PlatformRole.MEMBER]: 'Miembro',
  [PlatformRole.EXTERNAL]: 'Externo',
}

const fecha = (valor: Parameters<typeof timestampDate>[0] | undefined) =>
  valor ? timestampDate(valor).toLocaleDateString('es-CO', { dateStyle: 'medium' }) : 'Nunca'

export default async function Panel({ searchParams }: { searchParams: Promise<{ aviso?: string }> }) {
  const sesion = await exigirSesion('/panel')
  const { aviso } = await searchParams
  const { cuenta } = sesion
  const { organization } = await clientes().identidad.organizacion.getOrganization({}, comoPersona(sesion.tokenAcceso))
  const esAdmin = cuenta.role === PlatformRole.ADMIN

  return (
    <>
      <Encabezado enSesion />
      <main id="contenido" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="folio entrada text-lacre">Mi panel</p>
            <h1 className="titular entrada mt-3 text-4xl sm:text-5xl" style={{ '--i': 1 }}>
              Hola, {cuenta.displayName}
            </h1>
            <p className="entrada mt-3 flex items-center gap-2 text-tinta-suave" style={{ '--i': 2 }}>
              <Building2 aria-hidden className="size-4" />
              {organization?.name ?? 'Tu organización'} · {NOMBRE_ROL[cuenta.role]}
            </p>
          </div>
          <BotonSalir />
        </div>

        {aviso === 'codigos' ? (
          <p
            role="status"
            className="mt-8 flex items-start gap-3 rounded-xl border border-alerta/40 bg-superficie p-4 text-sm"
          >
            <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-alerta" />
            Te quedan pocos códigos de recuperación. Cuando recuperes tu teléfono, genera códigos nuevos desde tu
            cuenta.
          </p>
        ) : null}

        <div className="mt-10 grid items-start gap-8 lg:grid-cols-[1fr_1.2fr]">
          <section
            aria-labelledby="titulo-cuenta"
            className="hoja entrada rounded-2xl py-7 pl-14 pr-5 sm:pl-16 sm:pr-6"
            style={{ '--i': 3 }}
          >
            <h2 id="titulo-cuenta" className="folio text-tinta-suave">
              Tu cuenta
            </h2>
            <dl className="mt-4 grid gap-4 text-sm">
              <Dato nombre="Correo" valor={cuenta.email} />
              <Dato nombre="Rol" valor={NOMBRE_ROL[cuenta.role]} />
              <Dato nombre="Miembro desde" valor={fecha(cuenta.createdAt)} />
              <Dato
                nombre="Clave pública"
                valor={<span className="break-all font-mono text-xs">{cuenta.publicKeyId}</span>}
              />
            </dl>
            <p className="mt-6 text-xs leading-relaxed text-tinta-suave">
              Tu clave privada está abierta solo en este navegador y se borra al cerrar sesión. Los expedientes se
              cifrarán con ella en los próximos bloques.
            </p>
          </section>

          {cuenta.role === PlatformRole.EXTERNAL ? null : (
            <section
              aria-labelledby="titulo-miembros"
              className="entrada rounded-2xl border border-linea bg-superficie p-6 shadow-suave"
              style={{ '--i': 4 }}
            >
              <h2 id="titulo-miembros" className="titular text-2xl">
                Miembros de {organization?.name ?? 'la organización'}
              </h2>
              <Suspense fallback={<p className="mt-4 text-sm text-tinta-suave">Cargando miembros…</p>}>
                <ListaMiembros sesion={sesion} />
              </Suspense>
            </section>
          )}
        </div>

        {esAdmin ? (
          <section
            aria-labelledby="titulo-invitar"
            className="entrada mt-8 rounded-2xl border border-linea bg-superficie p-6 shadow-suave"
            style={{ '--i': 5 }}
          >
            <h2 id="titulo-invitar" className="titular text-2xl">
              Invitar a una persona
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-tinta-suave">
              Nadie puede registrarse sin invitación. Crea un enlace personal para el correo de la persona; vence en 7
              días y sirve una sola vez.
            </p>
            <div className="mt-6 max-w-3xl">
              <InvitarMiembro />
            </div>
          </section>
        ) : null}
      </main>
      <PiePagina />
    </>
  )
}

function Dato({ nombre, valor }: { nombre: string; valor: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-tinta-suave">{nombre}</dt>
      <dd className="mt-0.5 font-medium">{valor}</dd>
    </div>
  )
}

/** Componente asincrono en su propio Suspense: la pagina sale antes y la lista llega por streaming. */
async function ListaMiembros({ sesion }: { sesion: SesionActual }) {
  const { members } = await clientes().identidad.organizacion.listMembers(
    { page: { pageSize: 50 } },
    comoPersona(sesion.tokenAcceso),
  )
  return (
    <ul className="mt-4 divide-y divide-linea">
      {members.map(({ account, active, lastSignInAt }) =>
        account ? (
          <li key={account.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium">
                {account.displayName}
                {account.id === sesion.cuenta.id ? <span className="text-tinta-suave"> (tú)</span> : null}
              </p>
              <p className="truncate text-xs text-tinta-suave">{account.email}</p>
            </div>
            <div className="text-right text-xs text-tinta-suave">
              <p>
                <span className="rounded-full bg-institucional-suave px-2 py-0.5 font-semibold text-institucional">
                  {NOMBRE_ROL[account.role]}
                </span>
                {active ? null : <span className="ml-2 text-error">Inactiva</span>}
              </p>
              <p className="mt-1">Último ingreso: {fecha(lastSignInAt)}</p>
            </div>
          </li>
        ) : null,
      )}
    </ul>
  )
}
