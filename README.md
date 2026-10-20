# ActaFlow · Frontend

Interfaz web y **BFF** (Backend for Frontend) de ActaFlow, la plataforma de generación y
maquetación de minutas para audiencias de conciliación y mediaciones legales.

| | |
|---|---|
| Framework | Next.js 16.3 (App Router, Turbopack) + React 19.2 |
| Lenguaje | TypeScript estricto |
| Estilos | Tailwind CSS 4, `lucide-react`, fuentes Inter y Source Serif 4 servidas localmente |
| RPC | gRPC / gRPC-Web con ConnectRPC 2 y Protobuf-ES 2, código generado desde los contratos |
| Validación | Zod 4 en las fronteras (entorno, Server Actions) |
| Pruebas | Vitest + Testing Library |
| Puerto local | **3001** |
| Despliegue | Vercel (plan Hobby) |

## El servidor de Next como BFF (gRPC hacia los microservicios)

El navegador **nunca** habla con los microservicios, y **no hay API REST**:

1. El navegador solo invoca páginas de servidor y **Server Actions** (funciones del BFF, RPC;
   no recursos con verbos HTTP).
2. El BFF llama por **gRPC** a `identity-service` y `legal-case-service` con clientes **generados**
   desde `actaflow-contracts` (`src/gen/`, Protobuf-ES + ConnectRPC). Sus URLs y secretos solo los
   conoce el servidor (sin `NEXT_PUBLIC_`).
3. Cada llamada va firmada con HMAC-SHA256 en los metadatos, con **un secreto por par**
   (`ACTAFLOW_IDENTITY_HMAC_SECRET`, `ACTAFLOW_LEGAL_CASE_HMAC_SECRET`). Mensaje canónico idéntico
   en Java, Python y TypeScript, con vectores de prueba compartidos:
   `{timestamp}\nRPC\n/{paquete.Servicio}/{Metodo}\n{sha256 hex de los bytes protobuf}`.

| Transporte | Cuándo | Variable |
|---|---|---|
| gRPC nativo (HTTP/2) | local | `ACTAFLOW_RPC_TRANSPORT=grpc` |
| gRPC-Web (HTTP/1.1) | Vercel → Render Free (sin HTTP/2 público) | `ACTAFLOW_RPC_TRANSPORT=grpc-web` (por defecto) |
| Mocks tipados | desarrollo sin servicios | `ACTAFLOW_RPC_MODE=mock` |

### Contract-First y tipado de punta a punta

- `contracts/` es una copia **fijada** de `actaflow-contracts` (`contracts.lock.json` guarda la
  versión y el sha256 de cada archivo). CI comprueba que es idéntica a la versión publicada.
- `npm run contracts:gen` regenera `src/gen/` con `buf generate`; CI falla si alguien lo editó a
  mano o lo dejó desactualizado.
- La cadena de tipos no se rompe: PostgreSQL → Java (código generado) → Protobuf en el cable →
  TypeScript generado → componentes. Si el contrato cambia, `/estado` deja de compilar en vez de
  fallar en producción.
- **La falsa seguridad de TypeScript:** los tipos desaparecen al ejecutar. Por eso lo que entra
  desde fuera se **parsea** (Zod para el entorno, Protobuf para los mensajes) y ESLint prohíbe
  los `as` en el código de producción (`consistent-type-assertions: never`).

Actualizar a otra versión del contrato:

```powershell
node scripts/contracts.mjs sync v0.3.0
npm run contracts:gen
```

**Plan gratuito:** el BFF espera hasta 2 minutos a un servicio dormido de Render, reintentando
solo `UNAVAILABLE` y `DEADLINE_EXCEEDED` (nunca una firma rechazada). La portada despierta los
servicios en segundo plano con una Server Action y `/estado` reintenta sola cada 20 s mientras
algo no esté operativo.

## Patrones de renderizado

| Patrón | Ruta | Por qué | Cómo verificarlo en `next build` |
|---|---|---|---|
| **SSG** | `/`, `/como-funciona`, `/terminos`, `/privacidad` | Contenido idéntico para todos; se genera en el build y se sirve desde la CDN | `○` (Static) |
| **SSR dinámico + streaming** | `/estado` | El estado de las capas es del momento; el encabezado sale de inmediato y el resultado llega por streaming con `Suspense` | `ƒ /estado` (Dynamic) |
| **SSR por persona** | `/ingresar`, `/registro`, `/panel` | Llevan el nonce de la CSP de cada petición y datos de la sesión; nunca se cachean (`private, no-store`) | `ƒ` (Dynamic) |
| **SSR** | `/expedientes` | La lista depende de quién pide y de los filtros (`?estado=`, `?pagina=`); se arma en el servidor con el token de la persona | `ƒ /expedientes` (Dynamic) |
| **Streaming SSR** | `/expedientes/[id]` | La cabecera del caso sale de inmediato; participantes y línea de tiempo llegan después, cada uno en su `Suspense` | `ƒ /expedientes/[id]` (Dynamic) |
| **ISR** | `/plantillas`, `/plantillas/[slug]` | La biblioteca es pública e igual para todos: se genera en el build, se regenera cada 10 minutos y **al instante** cuando un administrador publica (`revalidatePath` en la Server Action) | `○ /plantillas` y `● /plantillas/[slug]` con `Revalidate 10m` |

El mapa completo de los cinco patrones del proyecto:

| Patrón | Ruta prevista | Bloque |
|---|---|---|
| SSG | `/`, `/como-funciona`, `/terminos`, `/privacidad` | 0 y 1 |
| ISR | `/plantillas`, `/plantillas/[slug]` (por tiempo y al publicar) | 5 (hecho) |
| SSR | `/expedientes` | 4 (hecho) |
| Streaming SSR | `/expedientes/[id]` | 4 (hecho) |
| CSR | `/expedientes/[id]/audiencia`, `/sin-conexion` | 6 y 7 |

## Cuentas (bloque FE-3)

| Ruta | Qué hace |
|---|---|
| `/registro#invitacion=<token>` | Alta por invitación: datos → app autenticadora (QR) → kit de recuperación |
| `/ingresar` | Correo y contraseña → código TOTP (o un código de recuperación) |
| `/panel` | Cuenta, miembros de la organización y, para administradores, invitaciones |

- **Conocimiento cero:** el navegador deriva con PBKDF2-SHA-256 (600 000 iteraciones) una
  semilla y de ella, con HKDF, el **verificador** (lo único que viaja) y la clave que cifra la
  clave privada. La contraseña nunca sale del navegador.
- **Par de claves por cuenta (ECDH P-256):** la clave privada se guarda en el servidor cifrada con
  AES-256-GCM dos veces: con la clave de la contraseña y con una **clave de recuperación** que solo
  ve la persona (kit descargable con los 10 códigos de un solo uso). Al ingresar se abre en el
  navegador y queda en IndexedDB como `CryptoKey` **no exportable**; cerrar sesión la borra.
- **Tokens solo en el BFF:** las Server Actions guardan los tokens en cookies `httpOnly`,
  `SameSite=Lax` y, en producción, `Secure` con prefijo `__Host-`. El JavaScript del navegador no
  las ve. El desafío del segundo factor también va en una cookie `httpOnly` de 5 minutos.
- **Renovación en `src/proxy.ts`:** si el token de acceso (15 min) venció, el proxy lo rota con
  `RefreshSession` antes de renderizar `/panel`. Reusar un token ya rotado cierra toda la sesión.
- **CSP estricta con nonce** en las rutas de cuenta: solo corren los scripts de Next con el nonce
  de esa petición y el script del tema por su hash (`'strict-dynamic'`, sin `'unsafe-inline'`).
- **El token de invitación va en el fragmento (`#`)**: nunca llega al servidor web, a los logs ni
  al `Referer`, y se quita de la barra de direcciones al leerlo.
- Todo lo que llega a una Server Action se **parsea con Zod** (bytes en base64url con su largo
  exacto) antes de armar el mensaje protobuf.

Con `ACTAFLOW_RPC_MODE=mock` la identidad es una **simulación en memoria** con las mismas reglas
(TOTP real, bloqueo, rotación con detección de robo). Para probar el alta abre
`http://localhost:3001/registro#invitacion=invitacion-simulada-publica-solo-para-desarrollo-0001`
y usa el correo `admin@actaflow.test`. Esa invitación es pública a propósito y solo existe en el
modo simulado; reiniciar `npm run dev` borra las cuentas simuladas.

## Expedientes (bloque FE-4)

| Ruta | Qué hace |
|---|---|
| `/expedientes` | Casos donde participas, con filtros por estado y paginación |
| `/expedientes/nuevo` | Abre un expediente: radicado, tipo, título, resumen y primera audiencia |
| `/expedientes/[id]` | Detalle: título y resumen descifrados, estado, participantes y línea de tiempo |

- **Cifrado de extremo a extremo:** cada expediente tiene su propia clave AES-256-GCM, creada en
  el navegador. El título y el resumen viajan como `EncryptedBlob` (`CaseDetails` cifrado, con el
  id de la clave como AAD). El HTML que arma el servidor nunca contiene el texto en claro.
- **Entrega de la clave:** se envuelve para cada persona con ECDH P-256 efímero → HKDF-SHA-256 →
  AES-256-GCM (`WrappedKey` del contrato). Antes de entregarla se muestra la **huella** de la clave
  pública de esa persona, para compararla con la que ella ve en su panel.
- Quien entra a un caso sin haber recibido la clave ve el expediente con el aviso "Aún no tienes la
  clave"; en cuanto un conciliador se la entrega, lo descifra con su propia clave privada.
- Las reglas las aplica legal-case-service: solo los participantes ven el caso (los demás reciben
  404), las ediciones llevan la revisión esperada (conflicto si alguien guardó antes) y los
  cambios de estado siguen el flujo Abierto → En audiencia → Acuerdo / Sin acuerdo → Archivado.

En modo simulado (`ACTAFLOW_RPC_MODE=mock`) los expedientes también viven en memoria con las mismas
reglas.

## Plantillas (bloque FE-5)

| Ruta | Qué hace |
|---|---|
| `/plantillas` | Biblioteca pública por categoría (ISR) |
| `/plantillas/[slug]` | Texto resaltado y tabla de variables de una plantilla (ISR) |
| `/panel/plantillas` | Plantillas de la organización (borradores incluidos) y "Usar como base" |
| `/panel/plantillas/nueva`, `/panel/plantillas/[id]` | Editor con revisión en vivo, vista previa, versiones y publicación |

- **Lectura sin sesión:** la biblioteca se lee con la firma HMAC del BFF pero sin token, así la
  página no depende de cookies y puede ser estática.
- **Build tolerante:** si legal-case no responde durante `next build` (Render dormido), la
  biblioteca sale con un aviso y se regenera en el siguiente ciclo. En tiempo de ejecución un error
  no reemplaza la última versión buena.
- **Editor:** mientras se escribe, legal-case devuelve los diagnósticos (línea y columna), las
  variables deducidas y una vista previa con datos de ejemplo. El HTML de la vista previa ya viene
  escapado y el BFF lo vuelve a sanear (`sanearHtml`, lista blanca de etiquetas) antes de mostrarlo.
- **Solo administradores** editan, y solo los de la organización autora. Las plantillas del
  sistema se copian con "Usar como base".
- En modo simulado, `lenguajeSimulado.ts` reproduce el mismo lenguaje que el servicio Java
  (mismos diagnósticos y mismo HTML).

## Diseño: "expediente vivo"

- **Papel y tinta:** fondo cálido con grano (SVG en línea), hojas con reglas y margen rojo de
  notaría, titulares en Source Serif 4 con tamaño óptico y rótulos en versalitas.
- **Colores con significado:** azul institucional para acciones, **lacre** para lo oficial y
  **violeta reservado solo para lo que produce la IA**. Contraste WCAG AA verificado por un test
  sobre los tokens reales, en claro y en oscuro (`tests/diseno/contraste.test.ts`).
- **Modo claro principal y oscuro "tinta nocturna":** un script en `<head>` fija el tema antes
  de pintar (sin destello) y el botón lo cambia con una revelación circular (View Transitions).
- **Animaciones con sentido:** la minuta de la portada se escribe sola, la IA marca en violeta y
  el abogado la sella; la línea del recorrido se traza con el scroll (`animation-timeline`, CSS
  puro). Todo se desactiva con `prefers-reduced-motion`.
- Container queries en las tarjetas, navegación con `aria-current` y foco siempre visible.

## Desarrollo local (PowerShell)

Sin ningún servicio levantado (mocks tipados):

```powershell
npm ci
$env:ACTAFLOW_RPC_MODE="mock"; npm run dev
```

Con los microservicios locales (gRPC nativo), una sola vez:

```powershell
[Environment]::SetEnvironmentVariable("ACTAFLOW_RPC_TRANSPORT", "grpc", "User")
[Environment]::SetEnvironmentVariable("ACTAFLOW_IDENTITY_URL", "http://localhost:9198", "User")
[Environment]::SetEnvironmentVariable("ACTAFLOW_LEGAL_CASE_URL", "http://localhost:9197", "User")
[Environment]::SetEnvironmentVariable("ACTAFLOW_IDENTITY_HMAC_SECRET", "<el mismo de identity-service>", "User")
[Environment]::SetEnvironmentVariable("ACTAFLOW_LEGAL_CASE_HMAC_SECRET", "<el mismo de legal-case-service>", "User")
# cierra y vuelve a abrir VS Code para que tome las variables
npm run dev
```

Verificación:

```powershell
npm test; npm run lint; npm run typecheck; npm run build
```

Prueba opcional contra un servicio real (interoperabilidad entre lenguajes):

```powershell
$env:ACTAFLOW_IT_URL="http://localhost:9098"; $env:ACTAFLOW_IT_TRANSPORT="grpc-web"
$env:ACTAFLOW_IT_SECRET="<secreto del par>"; npx vitest run tests/integracion
```

## Runbook de despliegue (Vercel)

1. Proyecto `actaflow-frontend` en Vercel, framework Next.js, sin cambios en comandos de build.
2. Variables de entorno (Production): `ACTAFLOW_IDENTITY_URL` y `ACTAFLOW_LEGAL_CASE_URL` (URLs de
   Render), `ACTAFLOW_IDENTITY_HMAC_SECRET` y `ACTAFLOW_LEGAL_CASE_HMAC_SECRET` (los de
   producción) y, opcional, `ACTAFLOW_BACKEND_WAIT_MS=120000`. `ACTAFLOW_RPC_TRANSPORT` no hace
   falta: el valor por defecto es `grpc-web`. Borra las antiguas `ACTAFLOW_BACKEND_URL` y
   `ACTAFLOW_BFF_HMAC_SECRET`.
3. Cada push a `main` despliega solo; los PR generan vistas previas.

## Seguridad

- Ningún secreto con prefijo `NEXT_PUBLIC_`; el código del BFF importa `server-only`, así que
  un error que lo arrastre al navegador rompe el build en lugar de filtrar secretos.
- Cabeceras de seguridad globales y sin `X-Powered-By`; CSP con nonce por petición en las rutas
  de cuenta (`src/proxy.ts`).
- `npm audit --omit=dev` limpio. La única alerta restante (`braces`) llega por
  `eslint-config-next`, solo en desarrollo, y no se publica.
