import type { NextConfig } from 'next'

// Cabeceras de seguridad para todas las rutas. La CSP estricta con nonce por peticion la pone
// src/proxy.ts en las rutas de cuenta (ingreso, registro, panel); aqui van las que no dependen de la peticion.
const cabecerasSeguridad = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // El microfono se habilitara solo para la sala de audiencia, en su bloque.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
]

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: cabecerasSeguridad }]
  },
}

export default nextConfig
