import { BotonTema } from '@/components/tema/BotonTema'
import { Logo } from './Logo'
import { NavEnlace } from './NavEnlace'

export function Encabezado() {
  return (
    <header className="sticky top-0 z-40 border-b border-linea/70 bg-papel/80 backdrop-blur-md supports-[backdrop-filter]:bg-papel/65">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Logo />
        <div className="flex items-center gap-1 sm:gap-2">
          <nav aria-label="Principal" className="flex items-center">
            <NavEnlace href="/como-funciona">
              <span className="sm:hidden">Cómo</span>
              <span className="hidden sm:inline">Cómo funciona</span>
            </NavEnlace>
            <NavEnlace href="/estado">
              <span className="sm:hidden">Estado</span>
              <span className="hidden sm:inline">Estado del sistema</span>
            </NavEnlace>
          </nav>
          <BotonTema />
        </div>
      </div>
    </header>
  )
}
