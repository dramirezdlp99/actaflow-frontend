/**
 * Defensa en profundidad para la vista previa: legal-case ya escapa todo y solo emite estas
 * etiquetas, pero el BFF vuelve a comprobarlo antes de que el navegador lo inserte. Cualquier otra
 * etiqueta (o atributo) se escapa y se ve como texto.
 */
const PERMITIDAS = new Set([
  '<h2>',
  '</h2>',
  '<h3>',
  '</h3>',
  '<p>',
  '</p>',
  '<br>',
  '<strong>',
  '</strong>',
  '<span class="valor">',
  '</span>',
  '<mark class="falta">',
  '</mark>',
])

const escapar = (texto: string) =>
  texto.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** Deja las etiquetas permitidas y las entidades HTML validas; todo lo demas se escapa. */
export function sanearHtml(html: string): string {
  return html.replace(/<[^>]*>?|&(?:[a-z]+|#\d+|#x[0-9a-f]+);|[&<>"]/gi, (pieza) => {
    if (PERMITIDAS.has(pieza)) {
      return pieza
    }
    if (/^&(?:amp|lt|gt|quot|#39|nbsp);$/i.test(pieza)) {
      return pieza
    }
    return escapar(pieza)
  })
}
