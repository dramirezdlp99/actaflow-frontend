import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Herramientas de linea de comandos: escribir en consola es su trabajo.
    files: ['scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
  {
    // La falsa seguridad de TypeScript: un `as` le dice al compilador "confia en mi" sin comprobar
    // nada en tiempo de ejecucion. En el codigo de produccion los datos externos se PARSEAN
    // (Zod, mensajes protobuf generados); nunca se afirman con `as`.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/gen/**'],
    rules: {
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'coverage/**', 'next-env.d.ts', 'src/gen/**']),
])

export default eslintConfig
