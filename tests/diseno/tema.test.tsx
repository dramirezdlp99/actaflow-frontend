import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BotonTema } from '@/components/tema/BotonTema'
import { CLAVE_TEMA, SCRIPT_TEMA_INICIAL, temaContrario, temaInicial } from '@/lib/tema/tema'

describe('tema claro y oscuro', () => {
  afterEach(() => {
    localStorage.clear()
    document.documentElement.dataset.theme = 'light'
  })

  it('respeta la preferencia guardada y si no, la del sistema', () => {
    expect(temaInicial('dark', false)).toBe('dark')
    expect(temaInicial('light', true)).toBe('light')
    expect(temaInicial(null, true)).toBe('dark')
    expect(temaInicial('otro', false)).toBe('light')
    expect(temaContrario('light')).toBe('dark')
  })

  it('el script de <head> fija el tema antes de pintar', () => {
    localStorage.setItem(CLAVE_TEMA, 'dark')
    new Function(SCRIPT_TEMA_INICIAL)()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('el boton alterna y recuerda la eleccion', () => {
    render(<BotonTema />)
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar entre modo claro y oscuro' }))
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem(CLAVE_TEMA)).toBe('dark')
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar entre modo claro y oscuro' }))
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})
