# ActaFlow · Frontend

Interfaz web y **BFF** (Backend for Frontend) de ActaFlow, la plataforma de generación y
maquetación de minutas para audiencias de conciliación y mediaciones legales.

| | |
|---|---|
| Framework | Next.js 16.3 (App Router, Turbopack) + React 19.2 |
| Lenguaje | TypeScript estricto |
| Estilos | Tailwind CSS 4, `lucide-react`, fuentes Inter y Source Serif 4 servidas localmente |
| Pruebas | Vitest + Testing Library |
| Puerto local | **3001** |
| Despliegue | Vercel (plan Hobby) |

## El servidor de Next como BFF

El navegador **nunca** habla con el backend directamente:

1. El navegador llama a rutas del propio Next (`/api/...` o páginas de servidor).
2. El BFF (`src/lib/bff/`) firma cada petición con HMAC-SHA256 y la reenvía a la URL real
   del backend, que solo conoce el servidor (`ACTAFLOW_BACKEND_URL`, sin `NEXT_PUBLIC_`).
3. El backend rechaza todo lo que no venga firmado.

Mensaje canónico (idéntico en los tres repos, con vectores de prueba compartidos):
`timestamp \n MÉTODO \n ruta[?consulta] \n sha256_hex(cuerpo)`.

**Plan gratuito:** el BFF espera hasta 2 minutos a un backend dormido de Render, reintentando
errores de red y respuestas 502/503/504 solo en operaciones seguras de repetir. La portada
despierta los servicios en segundo plano y `/estado` reintenta sola cada 20 s mientras algo no
esté operativo.

## Patrones de renderizado

| Patrón | Ruta | Por qué | Cómo verificarlo en `next build` |
|---|---|---|---|
| **SSG** | `/` (portada) | Contenido idéntico para todos; se genera en el build y se sirve desde la CDN | `○ /` (Static) |
| **SSR dinámico + streaming** | `/estado` | El estado de las capas es del momento; el encabezado sale de inmediato y el resultado llega por streaming con `Suspense` | `ƒ /estado` (Dynamic) |
| **SSR (Route Handler)** | `/api/estado` | Punto del BFF que la portada usa como "despertador" | `ƒ /api/estado` |

El mapa completo de los cinco patrones del proyecto:

| Patrón | Ruta prevista | Bloque |
|---|---|---|
| SSG | `/`, `/como-funciona`, `/terminos`, `/privacidad` | 0 y 1 |
| ISR | `/plantillas`, `/plantillas/[slug]` (por tiempo y al publicar) | 5 |
| SSR | `/expedientes` | 4 |
| Streaming SSR | `/expedientes/[id]` | 4 |
| CSR | `/expedientes/[id]/audiencia`, `/sin-conexion` | 6 y 7 |

## Diseño

Modo claro principal con paleta "jurídica" definida en `src/app/globals.css`: papel, tinta, un
azul institucional y un **violeta reservado solo para lo que produce la IA**. Todos los pares de
color se verificaron con WCAG AA (la mayoría cumple AAA). Los tokens del modo oscuro ya están
definidos; el botón llega con el sistema de diseño.

## Desarrollo local (PowerShell)

```powershell
npm ci
[Environment]::SetEnvironmentVariable("ACTAFLOW_BACKEND_URL", "http://localhost:9097", "User")
[Environment]::SetEnvironmentVariable("ACTAFLOW_BFF_HMAC_SECRET", "<el mismo secreto BFF del backend>", "User")
# cierra y vuelve a abrir VS Code para que tome las variables
npm run dev
```

Verificación:

```powershell
npm test; npm run lint; npm run typecheck; npm run build
```

## Runbook de despliegue (Vercel)

1. Vercel → **Add New → Project** → importar `dramirezdlp99/actaflow-frontend`.
2. Framework: Next.js (detección automática). Sin cambios en comandos de build.
3. Variables de entorno (Production): `ACTAFLOW_BACKEND_URL` (URL de Render del backend),
   `ACTAFLOW_BFF_HMAC_SECRET` (el secreto BFF de producción) y, opcional,
   `ACTAFLOW_BACKEND_WAIT_MS=120000`.
4. Cada push a `main` despliega solo; los PR generan vistas previas.

## Seguridad

- Ningún secreto con prefijo `NEXT_PUBLIC_`; el código del BFF importa `server-only`, así que
  un error que lo arrastre al navegador rompe el build en lugar de filtrar secretos.
- Cabeceras de seguridad globales y sin `X-Powered-By`.
- `npm audit --omit=dev` limpio. La única alerta restante (`braces`) llega por
  `eslint-config-next`, solo en desarrollo, y no se publica.
