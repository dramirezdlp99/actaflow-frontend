import type { Metadata, Viewport } from 'next'
import '@fontsource-variable/inter/opsz.css'
import '@fontsource-variable/source-serif-4/opsz.css'
import '@fontsource-variable/source-serif-4/opsz-italic.css'
import { MedidorInp } from '@/components/rendimiento/MedidorInp'
import { ServiceWorker } from '@/components/sinConexion/ServiceWorker'
import { SCRIPT_TEMA_INICIAL } from '@/lib/tema/tema'
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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f1e8' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1117' },
  ],
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // El script de <head> fija data-theme antes de pintar; por eso el atributo puede diferir del HTML del servidor.
    <html lang="es-CO" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA_INICIAL }} />
      </head>
      <body className="min-h-dvh bg-papel text-tinta">
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-institucional focus:px-4 focus:py-2 focus:text-sobre-institucional"
        >
          Saltar al contenido
        </a>
        {children}
        <ServiceWorker />
        <MedidorInp />
      </body>
    </html>
  )
}
