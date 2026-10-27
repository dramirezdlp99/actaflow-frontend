import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { despertarServicios } from '@/app/acciones/despertar'
import Inicio, { dynamic } from '@/app/page'

vi.mock('@/app/acciones/despertar', () => ({ despertarServicios: vi.fn(async () => {}) }))

describe('portada (SSG)', () => {
  it('se genera de forma estatica', () => {
    expect(dynamic).toBe('force-static')
  })

  it('presenta el proyecto funcionando y enlaza al estado del sistema', () => {
    render(<Inicio />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('La minuta se escribe mientras la audiencia ocurre')
    expect(screen.getByText(/Funcionando de punta a punta/)).toBeInTheDocument()
    const enlaces = screen.getAllByRole('link', { name: /estado del sistema/i })
    expect(enlaces.length).toBeGreaterThan(0)
    expect(enlaces.every((e) => e.getAttribute('href') === '/estado')).toBe(true)
  })

  it('muestra el recorrido, los cuatro pilares y la tarjeta de IA', () => {
    render(<Inicio />)

    for (const titulo of [
      'Cifrado en el navegador',
      'En vivo para todos',
      'Acta sellada y verificable',
      'Aceptación de las partes',
      'La IA propone; el abogado confirma',
      'La IA extrae lo que importa',
      'Se sella y las partes aceptan',
    ]) {
      expect(screen.getByRole('heading', { name: titulo })).toBeInTheDocument()
    }
  })

  it('despierta los servicios una sola vez con una Server Action (RPC, sin ruta REST)', () => {
    vi.mocked(despertarServicios).mockClear()
    render(<Inicio />)

    expect(despertarServicios).toHaveBeenCalledTimes(1)
  })

  it('no inventa estadisticas ni cifras', () => {
    const { container } = render(<Inicio />)
    expect(container.textContent).not.toMatch(/\d+\s*%|\d+x|\+\d+/)
  })
})
