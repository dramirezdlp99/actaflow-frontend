import Link from 'next/link'
import { BotonTema } from '@/components/tema/BotonTema'
import { Logo } from './Logo'
import { NavEnlace } from './NavEnlace'

/** `enSesion`: en las paginas con sesion aparecen Expedientes y Mi panel en lugar de Ingresar. */
export function Encabezado({ enSesion = false }: { enSesion?: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-linea/70 bg-papel/80 backdrop-blur-md supports-[backdrop-filter]:bg-papel/65">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Logo />
        <div className="flex items-center gap-1 sm:gap-2">
          <nav aria-label="Principal" className="flex items-center">
            {/* En pantallas angostas no cabe: sigue en el pie de pagina. */}
            <span className="hidden lg:contents">
              <NavEnlace href="/como-funciona">Cómo funciona</NavEnlace>
            </span>
            <span className="hidden sm:contents">
              <NavEnlace href="/plantillas">Plantillas</NavEnlace>
            </span>
            <span className="hidden md:contents">
              <NavEnlace href="/verificar">Verificar</NavEnlace>
            </span>
            {/* Con sesion, en telefonos manda lo de la cuenta; el estado sigue en el pie de pagina. */}
            <span className={enSesion ? 'hidden sm:contents' : 'contents'}>
              <NavEnlace href="/estado">
                <span className="sm:hidden">Estado</span>
                <span className="hidden sm:inline">Estado del sistema</span>
              </NavEnlace>
            </span>
            {enSesion ? (
              <>
                <NavEnlace href="/expedientes">Expedientes</NavEnlace>
                <NavEnlace href="/panel">Mi panel</NavEnlace>
              </>
            ) : (
              <Link
                href="/ingresar"
                className="ml-1 rounded-full bg-institucional px-4 py-1.5 text-sm font-semibold text-sobre-institucional shadow-suave transition hover:brightness-110"
              >
                Ingresar
              </Link>
            )}
          </nav>
          <BotonTema />
        </div>
      </div>
    </header>
  )
}
