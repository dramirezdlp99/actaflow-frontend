'use client'

import { Moon, Sun } from 'lucide-react'
import { flushSync } from 'react-dom'
import { CLAVE_TEMA, temaContrario, type Tema } from '@/lib/tema/tema'

function temaActual(): Tema {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function aplicar(tema: Tema) {
  document.documentElement.dataset.theme = tema
  try {
    localStorage.setItem(CLAVE_TEMA, tema)
  } catch {
    // Almacenamiento bloqueado (modo privado): el tema dura solo esta visita.
  }
}

/**
 * Alterna claro/oscuro. Los dos iconos se pintan siempre y el CSS muestra el que corresponde,
 * asi el HTML del servidor y el del cliente coinciden (sin errores de hidratacion).
 */
export function BotonTema() {
  const alternar = (evento: React.MouseEvent<HTMLButtonElement>) => {
    const siguiente = temaContrario(temaActual())
    const sinMovimiento = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    if (!document.startViewTransition || sinMovimiento) {
      aplicar(siguiente)
      return
    }
    // Revelacion circular desde el boton hasta la esquina mas lejana de la pantalla.
    const x = evento.clientX || window.innerWidth - 40
    const y = evento.clientY || 40
    const radio = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))
    const transicion = document.startViewTransition(() => flushSync(() => aplicar(siguiente)))
    transicion.ready
      .then(() => {
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radio}px at ${x}px ${y}px)`] },
          { duration: 650, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' },
        )
      })
      .catch(() => {})
  }

  return (
    <button
      type="button"
      onClick={alternar}
      aria-label="Cambiar entre modo claro y oscuro"
      title="Cambiar entre modo claro y oscuro"
      className="relative inline-flex size-10 items-center justify-center rounded-full border border-linea bg-superficie text-tinta transition-colors hover:border-institucional hover:text-institucional"
    >
      <Sun aria-hidden="true" className="size-[1.15rem] dark:hidden" strokeWidth={1.75} />
      <Moon aria-hidden="true" className="hidden size-[1.15rem] dark:block" strokeWidth={1.75} />
    </button>
  )
}
