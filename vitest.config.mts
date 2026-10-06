import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // 'server-only' lanza un error fuera del entorno de servidor de React; en las pruebas
      // se reemplaza por un modulo vacio para poder probar el codigo del BFF.
      'server-only': fileURLToPath(new URL('./tests/soporte/server-only-vacio.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/soporte/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
