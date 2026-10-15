import Link from 'next/link'
import { Isotipo } from './Logo'

const ENLACES = [
  { href: '/como-funciona', texto: 'Cómo funciona' },
  { href: '/estado', texto: 'Estado del sistema' },
  { href: '/terminos', texto: 'Términos de uso' },
  { href: '/privacidad', texto: 'Privacidad' },
]

export function PiePagina() {
  return (
    <footer className="mt-24 border-t border-linea bg-papel-hondo/60">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-[1.4fr_1fr] sm:px-6">
        <div className="max-w-md">
          <div className="flex items-center gap-2.5">
            <Isotipo className="size-8" />
            <span className="font-serif text-lg font-semibold">ActaFlow</span>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-tinta-suave">
            Minutas de audiencias de conciliación y mediación, redactadas mientras la audiencia ocurre. Proyecto
            académico de Ingeniería de Software, en construcción.
          </p>
        </div>
        <nav aria-label="Pie de página">
          <p className="folio text-tinta-suave">Explorar</p>
          <ul className="mt-4 grid gap-2.5 text-sm">
            {ENLACES.map(({ href, texto }) => (
              <li key={href}>
                <Link href={href} className="text-tinta underline-offset-4 hover:text-institucional hover:underline">
                  {texto}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-linea/70">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-tinta-suave sm:px-6">
          Contratos gRPC de <span className="font-mono">actaflow-contracts</span> · Sin datos reales de personas ni de
          procesos.
        </p>
      </div>
    </footer>
  )
}
