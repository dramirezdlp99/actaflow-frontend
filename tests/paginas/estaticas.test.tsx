import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ComoFunciona, { dynamic as dinamicaComo } from '@/app/como-funciona/page'
import NoEncontrado from '@/app/not-found'
import Privacidad, { dynamic as dinamicaPrivacidad } from '@/app/privacidad/page'
import Terminos, { dynamic as dinamicaTerminos } from '@/app/terminos/page'

vi.mock('next/navigation', () => ({ usePathname: () => '/como-funciona' }))

describe('paginas estaticas (SSG)', () => {
  it('se generan en el build', () => {
    expect([dinamicaComo, dinamicaTerminos, dinamicaPrivacidad]).toEqual(['force-static', 'force-static', 'force-static'])
  })

  it('como funciona explica microservicios, Contract-First y tipado', () => {
    render(<ComoFunciona />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('nada de REST')
    for (const nombre of ['identity-service', 'legal-case-service', 'ai-engine']) {
      expect(screen.getByText(nombre)).toBeInTheDocument()
    }
    expect(screen.getByRole('heading', { name: 'Programar es el último paso.' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'La falsa seguridad de TypeScript' })).toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveTextContent('SSR + streaming')
  })

  it('marca la pagina actual en la navegacion', () => {
    render(<ComoFunciona />)
    const actual = screen.getAllByRole('link', { current: 'page' })
    expect(actual.every((enlace) => enlace.getAttribute('href') === '/como-funciona')).toBe(true)
  })

  it('terminos y privacidad son honestos sobre el caracter academico', () => {
    const { unmount } = render(<Terminos />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Condiciones para usar ActaFlow')
    expect(document.body).toHaveTextContent('proyecto académico')
    unmount()
    render(<Privacidad />)
    expect(document.body).toHaveTextContent('Ningún audio ni texto se envía a servicios de IA de terceros')
  })

  it('la pagina 404 ofrece volver al inicio', () => {
    render(<NoEncontrado />)
    expect(screen.getByRole('link', { name: 'Volver al inicio' })).toHaveAttribute('href', '/')
  })
})
