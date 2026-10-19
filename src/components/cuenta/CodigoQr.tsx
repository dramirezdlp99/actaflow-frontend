import { encode } from 'uqr'

/**
 * Codigo QR dibujado como SVG con React (sin innerHTML ni imagenes remotas). Siempre oscuro sobre
 * blanco, con margen: las apps autenticadoras leen mal los QR invertidos.
 */
export function CodigoQr({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const { data, size } = encode(texto, { ecc: 'M', border: 2 })
  let trazo = ''
  data.forEach((fila, y) => {
    fila.forEach((oscuro, x) => {
      if (oscuro) {
        trazo += `M${x},${y}h1v1h-1z`
      }
    })
  })
  return (
    <svg
      role="img"
      aria-label={etiqueta}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="aspect-square w-full max-w-56 rounded-md bg-white"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={trazo} fill="#111111" />
    </svg>
  )
}
