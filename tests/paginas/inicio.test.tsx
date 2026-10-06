import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Inicio, { dynamic } from '@/app/page'

describe('portada (SSG)', () => {
  it('se genera de forma estatica', () => {
    expect(dynamic).toBe('force-static')
  })

  it('presenta el proyecto en construccion y enlaza al estado del sistema', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    render(<Inicio />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ActaFlow')
    expect(screen.getByText('En construcción')).toBeInTheDocument()
    const enlaces = screen.getAllByRole('link', { name: /estado del sistema/i })
    expect(enlaces.every((e) => e.getAttribute('href') === '/estado')).toBe(true)
  })

  it('muestra los cuatro pilares del navegador y la tarjeta de IA', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    render(<Inicio />)

    for (const titulo of [
      'Edición sin congelamientos',
      'Cifrado en el navegador',
      'Funciona sin conexión',
      'Revisión colaborativa',
      'La IA propone; el abogado confirma',
    ]) {
      expect(screen.getByRole('heading', { name: titulo })).toBeInTheDocument()
    }
  })

  it('despierta los servicios en segundo plano una sola vez y por el BFF', () => {
    const espia = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    render(<Inicio />)

    expect(espia).toHaveBeenCalledTimes(1)
    expect(espia.mock.calls[0]?.[0]).toBe('/api/estado')
  })

  it('no inventa estadisticas ni cifras', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
    const { container } = render(<Inicio />)
    expect(container.textContent).not.toMatch(/\d+\s*%|\d+x|\+\d+/)
  })
})
