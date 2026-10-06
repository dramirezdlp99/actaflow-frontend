import Link from 'next/link'
import { Logo } from './Logo'

export function Encabezado() {
  return (
    <header className="border-b border-linea bg-superficie">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo />
        <nav aria-label="Principal">
          <Link
            href="/estado"
            className="rounded-md px-3 py-2 text-sm font-medium text-institucional hover:bg-institucional-suave"
          >
            Estado del sistema
          </Link>
        </nav>
      </div>
    </header>
  )
}
