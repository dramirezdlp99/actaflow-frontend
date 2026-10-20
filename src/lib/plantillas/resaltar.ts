/**
 * Divide la fuente de una plantilla en trozos para mostrarla resaltada (sin HTML: React escapa cada
 * trozo). Variables {{ }}, etiquetas {% %} y comentarios {# #}; lo demas es texto.
 */
export type Trozo = { tipo: 'texto' | 'variable' | 'etiqueta' | 'comentario'; texto: string }

const APERTURAS: Record<string, { cierre: string; tipo: Trozo['tipo'] }> = {
  '{{': { cierre: '}}', tipo: 'variable' },
  '{%': { cierre: '%}', tipo: 'etiqueta' },
  '{#': { cierre: '#}', tipo: 'comentario' },
}

export function resaltar(fuente: string): Trozo[] {
  const trozos: Trozo[] = []
  const agregar = (tipo: Trozo['tipo'], texto: string) => {
    const ultimo = trozos.at(-1)
    if (!texto) {
      return
    }
    if (tipo === 'texto' && ultimo?.tipo === 'texto') {
      ultimo.texto += texto
    } else {
      trozos.push({ tipo, texto })
    }
  }
  let i = 0
  while (i < fuente.length) {
    const j = buscarApertura(fuente, i)
    if (j < 0) {
      agregar('texto', fuente.slice(i))
      break
    }
    agregar('texto', fuente.slice(i, j))
    const apertura = APERTURAS[fuente.slice(j, j + 2)]
    const k = apertura ? fuente.indexOf(apertura.cierre, j + 2) : -1
    if (!apertura || k < 0) {
      agregar('texto', fuente.slice(j))
      break
    }
    agregar(apertura.tipo, fuente.slice(j, k + 2))
    i = k + 2
  }
  return trozos
}

function buscarApertura(fuente: string, desde: number): number {
  let i = fuente.indexOf('{', desde)
  while (i >= 0 && i + 1 < fuente.length) {
    if (`{%#`.includes(fuente[i + 1] ?? '')) {
      return i
    }
    i = fuente.indexOf('{', i + 1)
  }
  return -1
}
