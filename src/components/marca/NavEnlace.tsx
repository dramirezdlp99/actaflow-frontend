'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** Enlace de navegacion que marca la pagina actual (aria-current) para lectores de pantalla y a la vista. */
export function NavEnlace({ href, children }: { href: string; children: React.ReactNode }) {
  const ruta = usePathname() ?? ''
  // /expedientes/123 tambien marca "Expedientes".
  const actual = ruta === href || (href !== '/' && ruta.startsWith(`${href}/`))
  return (
    <Link
      href={href}
      aria-current={actual ? 'page' : undefined}
      className="relative rounded-md px-3 py-2 text-sm font-medium text-tinta-suave transition-colors hover:text-tinta aria-[current=page]:text-tinta after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:origin-left after:scale-x-0 after:rounded-full after:bg-lacre after:transition-transform after:duration-300 hover:after:scale-x-100 aria-[current=page]:after:scale-x-100"
    >
      {children}
    </Link>
  )
}
