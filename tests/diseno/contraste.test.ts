// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** Contraste WCAG calculado sobre los tokens reales de globals.css, en los dos temas. */
const css = readFileSync(new URL('../../src/app/globals.css', import.meta.url), 'utf8')

function tokens(selector: string): Record<string, string> {
  const inicio = css.indexOf(`${selector} {`)
  const bloque = css.slice(inicio, css.indexOf('}', inicio))
  return Object.fromEntries([...bloque.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1] ?? '', m[2] ?? '']))
}

function luminancia(hex: string): number {
  const canales = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r = 0, g = 0, b = 0] = canales.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return ((claro ?? 0) + 0.05) / ((oscuro ?? 0) + 0.05)
}

const TEXTOS = ['tinta', 'tinta-suave', 'institucional', 'lacre', 'ia', 'exito', 'alerta', 'error']
const FONDOS = ['papel', 'superficie']

describe.each([
  ['claro', ':root'],
  ['oscuro', "[data-theme='dark']"],
])('modo %s', (_nombre, selector) => {
  const t = tokens(selector)

  it.each(TEXTOS.flatMap((texto) => FONDOS.map((fondo) => [texto, fondo])))(
    '%s sobre %s cumple WCAG AA (4.5:1)',
    (texto, fondo) => {
      expect(contraste(t[texto] ?? '', t[fondo] ?? '')).toBeGreaterThanOrEqual(4.5)
    },
  )

  it('los textos sobre los fondos suaves tambien cumplen AA', () => {
    expect(contraste(t.ia ?? '', t['ia-suave'] ?? '')).toBeGreaterThanOrEqual(4.5)
    expect(contraste(t.lacre ?? '', t['lacre-suave'] ?? '')).toBeGreaterThanOrEqual(4.5)
    expect(contraste(t.institucional ?? '', t['institucional-suave'] ?? '')).toBeGreaterThanOrEqual(4.5)
    expect(contraste(t['sobre-institucional'] ?? '', t.institucional ?? '')).toBeGreaterThanOrEqual(4.5)
    expect(contraste(t['tinta-suave'] ?? '', t['papel-hondo'] ?? '')).toBeGreaterThanOrEqual(4.5)
  })
})
