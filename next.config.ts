import type { NextConfig } from 'next'

// Cabeceras de seguridad para todas las rutas. La CSP estricta con nonce por peticion la pone
// src/proxy.ts en las rutas de cuenta (ingreso, registro, panel); aqui van las que no dependen de la peticion.
const cabecerasSeguridad = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
]

// El microfono solo se permite en la sala de audiencia (y solo para este mismo sitio). Cuando dos
// reglas ponen la misma cabecera, Next usa la ultima: por eso esta va despues de la general.
const cabecerasSala = [
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), payment=()' },
]

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      { source: '/:path*', headers: cabecerasSeguridad },
      { source: '/expedientes/:id/audiencia', headers: cabecerasSala },
    ]
  },
}

export default nextConfig
