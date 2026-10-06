import type { Metadata, Viewport } from 'next'
import '@fontsource-variable/inter'
import '@fontsource-variable/source-serif-4'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'ActaFlow',
    template: '%s · ActaFlow',
  },
  description:
    'Generación y maquetación de minutas en tiempo real para audiencias de conciliación y mediaciones legales.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: '#1e3a5f',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es-CO">
      <body className="min-h-dvh bg-papel text-tinta">
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-institucional focus:px-4 focus:py-2 focus:text-white"
        >
          Saltar al contenido
        </a>
        {children}
      </body>
    </html>
  )
}
