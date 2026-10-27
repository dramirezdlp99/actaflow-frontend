<div align="center">

# 🖥️ ActaFlow · Frontend

**La minuta se escribe *mientras* la audiencia ocurre.**

Interfaz web y BFF (Backend for Frontend) de ActaFlow: audiencias en vivo, cifrado en el navegador, hilos de trabajo,
modo sin conexión y el acta sellada y verificable.

*Next.js 16 · React 19 · TypeScript · ConnectRPC · Web Workers · Service Worker · Shared Worker · Vercel*

![Next.js](https://img.shields.io/badge/Next.js-16.4-1d3557)
![React](https://img.shields.io/badge/React-19.2-1d3557)
![TypeScript](https://img.shields.io/badge/TypeScript-estricto-9b2335)
![Contratos](https://img.shields.io/badge/contratos-v0.4.0-1d3557)
![INP](https://img.shields.io/badge/INP-%3C%20200%20ms-2e7d32)
![Pruebas](https://img.shields.io/badge/pruebas-178%20en%20verde-2e7d32)

🌐 **En producción:** [actaflow-frontend.vercel.app](https://actaflow-frontend.vercel.app)

| | |
|---|---|
| 👨‍💻 **Desarrollado por** | David Fernando Ramírez de la Parra |
| 👨‍🏫 **Profesor** | Jhonatan Andrés Mideros Narváez |
| 📚 **Asignatura** | Programación Orientada a la Web |
| 🏛️ **Institución** | Universidad Cooperativa de Colombia |

</div>

---

## 📑 Contenido

1. [El caso de estudio y cómo se cumple](#-el-caso-de-estudio-y-cómo-se-cumple)
2. [Arquitectura y capas](#-arquitectura-y-capas)
3. [El motor del navegador: hilos, Event Loop e INP](#-el-motor-del-navegador-hilos-event-loop-e-inp)
4. [Paralelismo real: Web, Shared y Service Worker](#-paralelismo-real-web-shared-y-service-worker)
5. [Patrones de renderizado](#-patrones-de-renderizado)
6. [Comunicación: gRPC, Contract-First y tipado de punta a punta](#-comunicación-grpc-contract-first-y-tipado-de-punta-a-punta)
7. [Funcionalidades, pantalla por pantalla](#-funcionalidades-pantalla-por-pantalla)
8. [Seguridad](#-seguridad)
9. [Diseño](#-diseño-expediente-vivo)
10. [Desarrollo, pruebas y despliegue](#-desarrollo-pruebas-y-despliegue)

---

## ⚖️ El caso de estudio y cómo se cumple

**Caso de estudio 3: plataforma de generación y maquetación de minutas para audiencias y mediaciones legales.** Es un
sistema web para centros de conciliación, notarías y despachos jurídicos que automatiza la redacción, estructuración y
maquetación de minutas y actas de acuerdo **durante** la audiencia, eliminando la transcripción y la maquetación
posteriores.

ActaFlow está dividido en cuatro repositorios:

| Repositorio | Qué es |
|---|---|
| 📜 [actaflow-contracts](https://github.com/dramirezdlp99/actaflow-contracts) | La API (Contract-First, Protocol Buffers) |
| 🖥️ **actaflow-frontend** (este) | Interfaz web y BFF |
| ⚙️ [actaflow-backend](https://github.com/dramirezdlp99/actaflow-backend) | Microservicios Java de identidad y expedientes |
| 🧠 [actaflow-ai-engine](https://github.com/dramirezdlp99/actaflow-ai-engine) | Motor de IA: voz a texto, entidades y PDF |

### 3.2 · Arquitectura de navegador, rendimiento e interacción

| Requisito | ✅ Cómo se cumple |
|---|---|
| **Edición sin congelamientos:** aislar el audio y el cifrado del flujo visual | El micrófono se captura en un **AudioWorklet** y pasa por **SharedArrayBuffer + Atomics** a un **Web Worker**, que remuestrea, detecta la voz, arma el WAV y lo **cifra**. El armado del acta corre en otro **Web Worker**. El hilo principal solo pinta |
| **Cifrado en el cliente** en un proceso secundario | WebCrypto (AES-256-GCM, ECDH P-256, HKDF) dentro del Worker y del navegador: expedientes, audio, transcripciones, entidades, borradores y actas viajan cifrados. Los servidores guardan bytes que no pueden leer |
| **Offline-first:** consultar expedientes, cargar plantillas y redactar sin conexión, y sincronizar al volver | **Service Worker** (caché de la app y de las páginas visitadas) + **bandeja de salida en IndexedDB** cifrada para el borrador del acta, que se envía sola con `online` y **Background Sync** |
| **Edición colaborativa** sin peticiones duplicadas | Borrador del acta cifrado y sincronizado en vivo entre el conciliador, los asistentes y las partes; un **Shared Worker** mantiene **una** conexión por navegador para todas las pestañas |

### 3.3 · La IA, co-protagonista

| Paso | ✅ Cómo se cumple |
|---|---|
| 1. Capturar el audio de las intervenciones | La sala graba y corta cada intervención en las pausas, y la **sella para el motor de IA** |
| 2. Transcribir e identificar a cada hablante | El motor propio (faster-whisper) transcribe; cada intervención lleva sellado quién habló. Todos la ven **en vivo** |
| 3. Extraer las entidades jurídicas | Partes con su documento, montos, fechas límite de pago, compromisos y cláusulas penales. Una persona **confirma o corrige** cada una |
| 4. Autocompletar la minuta y dejarla lista para firma | Lo revisado llena la plantilla elegida; el motor genera el **PDF**, legal-case lo **sella** (SHA-256 + CMS) y las partes lo **aceptan con su segundo factor** |

---

## 🏛️ Arquitectura y capas

```
┌──────────────────────── CAPA CLIENTE (navegador) ────────────────────────┐
│ React 19 · hilo principal solo para la interfaz                           │
│ AudioWorklet ─SAB─► Web Worker (audio + cifrado)   Web Worker (acta)       │
│ Shared Worker (tiempo real, 1 conexión)   Service Worker (sin conexión)    │
│ IndexedDB: clave privada (no exportable) y bandeja de salida cifrada       │
└───────────────┬───────────────────────────────────────────────────────────┘
                │ Server Actions (RPC) · route handlers de solo lectura
┌───────────────▼──────── CAPA DE BORDE: BFF (Next.js en Vercel) ───────────┐
│ Única puerta de entrada: oculta las URLs de los servicios, valida con Zod, │
│ firma cada llamada con HMAC (un secreto por pareja), CSP con nonce         │
└───────────────┬───────────────────────────────────────────────────────────┘
                │ gRPC (local) · gRPC-Web (producción)
┌───────────────▼──── CAPA DE APLICACIÓN (Render) ───┐   ┌── CAPA DE IA ───┐
│ identity-service · legal-case-service (Java)        ├──►│ ai-engine (Py)  │
│ + CAPA ASÍNCRONA: cola de trabajos con reintentos   │   └─────────────────┘
└───────────────┬────────────────────────────────────┘
┌───────────────▼──── CAPA DE DATOS: PostgreSQL (Neon), un esquema por servicio ──┐
└─────────────────────────────────────────────────────────────────────────────────┘
 DEVOPS: GitHub Actions (lint, tipos, pruebas, auditoría, contratos) · Vercel · Render
```

**"El frontend se regala al atacante":** ninguna regla de negocio depende de él. El navegador nunca habla con los
microservicios ni con la base de datos; todo pasa por el BFF, y cada permiso se vuelve a comprobar en el backend.

---

## ⚙️ El motor del navegador: hilos, Event Loop e INP

> 🧪 Todo esto se puede **ver en vivo** en **[/rendimiento](https://actaflow-frontend.vercel.app/rendimiento)**, el
> laboratorio de la app.

### 🧵 Anatomía de un frame

| Hilo | Qué hace | En ActaFlow |
|---|---|---|
| **Main thread** | JavaScript, estilos, layout y comandos de pintado. Se bloquea con tareas largas | Solo la interfaz: el trabajo pesado se mueve a Workers |
| **Compositor thread** | Scroll y animaciones aceleradas (`transform`, `opacity`), independiente del hilo principal | La mayoría de las animaciones del sitio usan `transform` y `opacity`; en `/rendimiento` una animación sigue moviéndose con el hilo principal bloqueado |
| **Raster / GPU** | Convierte las capas en píxeles y compone el frame final | — |

**Pipeline de renderizado:** HTML → **DOM** · CSS → **CSSOM** · DOM + CSSOM → **Render Tree** → **Layout** →
**Paint** → **Composite**. Es el camino que sigue el navegador para convertir HTML, CSS y JavaScript en píxeles.

### 🔁 Event Loop: tasks y microtasks

Piensa en un restaurante:

| Pieza | Analogía | Ejemplos |
|---|---|---|
| **Call stack** | El cocinero que ejecuta el código | El código síncrono |
| **Microtask queue** | Los pedidos prioritarios | `Promise.then`, `queueMicrotask` |
| **Task queue** | Los pedidos normales | `setTimeout`, eventos, `postMessage` |
| **Event Loop** | El encargado que decide qué entra a la cocina | — |

**La regla:** cuando la pila queda vacía se atienden **todas** las microtasks, y solo después la siguiente task. Pasa
igual en React, Angular o Next, porque todos corren sobre este mismo Event Loop. En `/rendimiento`, un botón programa
trabajos de cada tipo y muestra **el orden real** en que corren.

### 🔓 Bloquear el hilo y desbloquearlo desde otro

En `/rendimiento`, **Bloquear el hilo principal** deja la página atrapada en un ciclo síncrono: no pinta y ningún clic
responde. La libera **otra petición**, sin cerrar la pestaña ni el navegador:

```
hilo principal:  while (Atomics.load(bandera) === 0) { … }      ← bloqueado
Web Worker:      Atomics.store(bandera, 1)                       ← lo desbloquea
                    ▲
otra pestaña ── BroadcastChannel ──┘   (o el propio Worker, a los 5 s)
```

### ⏱️ INP: Interaction to Next Paint

La métrica oficial de Google para medir qué tan rápido responde la interfaz durante **toda** la visita:

```
INP = input delay + processing + presentation
       │             │            └ recalcular estilo, layout, paint y composite
       │             └ los manejadores de eventos (nuestro JavaScript)
       └ la espera en cola porque el hilo principal estaba ocupado
```

| Umbral | Valor |
|---|---|
| 🟢 Bueno | **< 200 ms** |
| 🟡 Necesita mejorar | 200 – 500 ms |
| 🔴 Pobre | > 500 ms (sensación de pantalla congelada) |

**¿Por qué reemplazó a FID?** FID solo medía la primera interacción y solo su espera. INP evalúa **todas** las
interacciones de la sesión y el ciclo completo, hasta el siguiente pintado.

**En ActaFlow se mide de verdad:** un medidor montado en el layout escucha cada interacción de **todas las páginas**
(Event Timing API, `PerformanceObserver`), separa sus tres fases y calcula el **INP global de la app** (percentil 98,
como Google). En las pruebas con navegador real dio **80 ms**. El laboratorio se mide aparte, porque sus bloqueos son a
propósito.

---

## 🧵 Paralelismo real: Web, Shared y Service Worker

| | Web Worker | Shared Worker | Service Worker |
|---|---|---|---|
| **Para qué** | Tareas pesadas en segundo plano | Compartir un proceso entre pestañas | Interceptar peticiones, caché, sin conexión, sincronización |
| **¿Accede al DOM?** | No | No | No |
| **¿Vive sin la página abierta?** | No | No (mientras quede una pestaña) | Sí, temporalmente |
| **En ActaFlow** | `audio.worker.ts` (audio + cifrado), `plantillas.worker.ts` (acta), `bloqueo.worker.ts` (laboratorio) | `tiempoReal.worker.ts`: una conexión de eventos y una consulta del borrador para todas las pestañas | `public/sw.js`: app y páginas sin conexión, y Background Sync de la bandeja de salida |

### 📨 postMessage vs SharedArrayBuffer

- **`postMessage`** copia los datos entre contextos, o los **transfiere** sin copiar (`ArrayBuffer`, `MessagePort`).
  Lo usan los Workers del acta, el Shared Worker y el respaldo del audio.
- **`SharedArrayBuffer`** es **la misma memoria** para varios hilos, coordinada con `Atomics`. El audio pasa del
  AudioWorklet al Worker por un **anillo de memoria compartida** (un escritor y un lector, sin locks), sin una sola
  copia.

### 🛡️ crossOriginIsolated

Compartir memoria entre hilos facilita ataques de canal lateral si la página mezcla recursos de otros orígenes. Por eso
el navegador solo permite `SharedArrayBuffer` cuando la página está **aislada**. ActaFlow envía `Cross-Origin-Opener-
Policy: same-origin` y `Cross-Origin-Embedder-Policy: require-corp` en todo el sitio, y sirve todo desde su propio
origen (fuentes locales incluidas), así que `crossOriginIsolated === true`.

> **Ciberseguridad y Service Worker:** como intercepta peticiones, el Service Worker no toca nada que no sea `GET` del
> mismo sitio (Server Actions, audio, eventos en vivo y `/api` pasan directo). Lo que guarda de un expediente son
> metadatos y bytes **cifrados**, y **cerrar sesión borra** sus cachés y la bandeja de salida. La contraseña nunca
> viaja: el navegador deriva un verificador (conocimiento cero).

---

## 🧩 Patrones de renderizado

| Patrón | Rutas | Por qué | En `next build` |
|---|---|---|---|
| **SSG** | `/`, `/como-funciona`, `/verificar`, `/rendimiento`, `/sin-conexion`, `/terminos`, `/privacidad` | Igual para todos: se genera en el build y se sirve desde la CDN (TTFB casi instantáneo) | `○` |
| **ISR** | `/plantillas`, `/plantillas/[slug]` | Biblioteca pública: estática, se regenera cada 10 min y **al instante** cuando un admin publica (`revalidatePath`) | `○ /plantillas` · `● /plantillas/[slug]` · Revalidate 10m |
| **SSR** | `/expedientes`, `/panel`, `/ingresar`, `/registro` | Dependen de quién pide (y de los filtros); nunca se cachean (`private, no-store`) | `ƒ` |
| **SSR + streaming** | `/estado`, `/expedientes/[id]` | El encabezado sale de inmediato y lo lento llega por **streaming** con `Suspense`, sin bloquear la carga | `ƒ` |
| **CSR** | `/expedientes/[id]/audiencia`, `/expedientes/[id]/acta` | El servidor entrega una carcasa con bytes cifrados; micrófono, sellado, eventos en vivo, descifrado y llenado del acta pasan en el navegador | `ƒ` (carcasa) |

**El problema del "todo o nada":** el SSR tradicional retiene la respuesta hasta tener todos los datos. Con **Streaming
SSR**, en `/estado` el layout y el encabezado se ven de inmediato mientras el servidor consulta las 5 capas, y cada
resultado se inyecta al llegar.

**SEO técnico:** HTML semántico (`header`, `main`, `nav`, `section` con `aria-labelledby`), una jerarquía de títulos
correcta, un `<title>` por página con plantilla, `lang="es-CO"` y páginas públicas estáticas. Como es un proyecto
académico, el sitio pide **no ser indexado** (`robots: noindex`).

---

## 🔌 Comunicación: gRPC, Contract-First y tipado de punta a punta

### 🚫 Nada de REST

El navegador solo invoca **páginas de servidor y Server Actions** (funciones del BFF, es decir, RPC). El BFF llama
por **gRPC** a los microservicios con clientes **generados** desde los contratos (`src/gen/`, Protobuf-ES +
ConnectRPC). No hay recursos con verbos HTTP.

Las únicas rutas HTTP son técnicas: el audio (30 s de WAV superan el tope de 1 MB de una Server Action), los eventos
en vivo como NDJSON y el estado del borrador para el Shared Worker. Todas reenvían mensajes del contrato tal cual.

| Transporte | Cuándo | Variable |
|---|---|---|
| gRPC nativo (HTTP/2) | Local | `ACTAFLOW_RPC_TRANSPORT=grpc` |
| gRPC-Web (HTTP/1.1) | Vercel → Render Free | `grpc-web` (por defecto) |
| Mocks tipados | Desarrollo sin servicios | `ACTAFLOW_RPC_MODE=mock` |

### 📐 Contract-First

- `contracts/` es una copia **fijada** de actaflow-contracts (v0.4.0), con el SHA-256 de cada archivo. El CI comprueba
  que sea idéntica a la versión publicada.
- `npm run contracts:gen` regenera `src/gen/`. El CI falla si alguien lo editó a mano o lo dejó desactualizado.
- Los **mocks tipados** (`ACTAFLOW_RPC_MODE=mock`) responden exactamente los mensajes del contrato, con las mismas
  reglas que los servicios. Por eso el frontend pudo avanzar sin esperar al backend.

### 🔗 Tipado de punta a punta y la falsa seguridad de TypeScript

**PostgreSQL → Java (generado) → Protobuf en el cable → TypeScript (generado) → componentes.** Si el contrato cambia,
el proyecto deja de compilar en vez de fallar en producción.

Los tipos de TypeScript **desaparecen al ejecutar** (type erasure). Por eso lo que entra desde fuera **se parsea**:
**Zod** para el entorno y las Server Actions, **Protobuf** para los mensajes y guardas de tipo en tiempo de ejecución.
Además, una regla de ESLint **prohíbe los `as`** en el código de producción (`consistent-type-assertions: never`).

---

## 🗺️ Funcionalidades, pantalla por pantalla

### 👤 Cuentas: `/registro`, `/ingresar`, `/panel`

- **Alta solo por invitación** (no hay registro abierto ni roles que uno se asigne). El primer administrador sale de
  la configuración de identity, y después cada persona entra con el enlace que le comparte un administrador.
- **Conocimiento cero:** PBKDF2-SHA-256 (600 000 iteraciones) y luego HKDF. Al servidor solo viaja un verificador.
- **Segundo factor obligatorio:** app autenticadora (QR) y **kit de recuperación** con 10 códigos de un solo uso.
- **Par de claves por cuenta** (ECDH P-256). La clave privada vive en **IndexedDB** como `CryptoKey` **no
  exportable**, y cerrar sesión la borra.
- Los tokens viven solo en el BFF, en cookies `httpOnly`, `SameSite=Lax`, `Secure` y con prefijo `__Host-`. El
  navegador no las ve.

### 📁 Expedientes: `/expedientes`, `/expedientes/[id]`

- Cada expediente tiene **su propia clave AES-256-GCM**, creada en el navegador y envuelta para cada participante.
  Antes de entregarla se compara la **huella** de la clave pública del destinatario.
- Roles por caso: **conciliador**, **asistente** y **parte**, con lado y calidad. Quien no participa recibe "no
  encontrado".

### 📝 Plantillas: `/plantillas`, `/panel/plantillas`

- Biblioteca pública con **ISR**, y un **editor** con revisión en vivo: diagnósticos con línea y columna, variables
  deducidas, vista previa, versiones y publicación.
- Lenguaje propio: variables con formato, condicionales y cláusulas que se repiten.

### 🎙️ Sala de audiencia: `/expedientes/[id]/audiencia`

- **Micrófono en tres hilos:** AudioWorklet → SharedArrayBuffer → Web Worker (16 kHz, detector de voz, WAV y
  sellado). En pantalla dice "Audio en otro hilo · memoria compartida".
- **Transcripción en vivo** para todos, descifrada en el navegador de cada uno. Con varias pestañas: "2 pestañas, 1
  conexión".
- **Entidades:** el motor propone y el conciliador o el asistente confirma, corrige o descarta cada una, con control
  de "alguien guardó antes". Lo que viene de la IA se marca en **violeta** hasta confirmarlo.
- `Permissions-Policy` solo permite el micrófono en esta sala.

### 📜 Acta: `/expedientes/[id]/acta` y `/verificar`

- **Llenado en un Web Worker** con los datos del expediente y **solo** lo que una persona revisó. Lo que falta se
  resalta y bloquea el cierre.
- **Borrador colaborativo:** el conciliador y los asistentes editan, y las partes ven los cambios en vivo. **Sin
  conexión**, los cambios quedan en la bandeja de salida (cifrados), sobreviven a recargar y se envían solos al volver
  la red.
- **Cerrar y sellar:** el motor arma el PDF, legal-case firma el SHA-256 (CMS), y cada navegador descifra el PDF y
  **comprueba que coincide con el sello**.
- **Aceptar** pide un código TOTP **nuevo** (una prueba de presencia de 2 minutos). Con todas las partes, el acta queda
  **FINAL**.
- **`/verificar`** (pública): el navegador calcula la huella del PDF y solo esa huella viaja. Si cambió una sola
  letra, no coincide. Es un sello de integridad, no una firma digital certificada (Ley 527 de 1999).

### 📊 Estado y rendimiento: `/estado`, `/rendimiento`

- **`/estado`:** las 5 capas (BFF, identity, legal-case, motor y base de datos), con latencia, versión y transporte,
  con streaming.
- **`/rendimiento`:** el laboratorio de hilos, Event Loop, bloqueo y desbloqueo, Workers e INP global.

### 📴 Sin conexión: `/sin-conexion`

- Se muestra cuando no hay red ni una copia guardada de esa página. Hay un aviso flotante mientras falta la red.

---

## 🔐 Seguridad

- 🔒 **Cifrado de extremo a extremo** con WebCrypto: el HTML del servidor nunca trae texto en claro de un expediente
  (lo comprueban las pruebas de punta a punta).
- 🧱 **CSP estricta con nonce** por petición en las rutas con sesión (`'strict-dynamic'`, sin `'unsafe-inline'` para
  scripts, `worker-src 'self'`), y cabeceras de seguridad en todo el sitio (HSTS, nosniff, DENY, COOP, COEP, CORP,
  Permissions-Policy) sin `X-Powered-By`.
- 🗝️ **Ningún secreto con `NEXT_PUBLIC_`**. El código del BFF importa `server-only`, así que si algo lo arrastra al
  navegador, el build se rompe en vez de filtrar secretos. Los secretos van por variables de entorno y son distintos en
  local y en producción.
- ✍️ Cada llamada a los servicios va **firmada con HMAC-SHA256**, con un secreto por pareja.
- 📦 `npm audit --omit=dev` en el CI: una vulnerabilidad alta o crítica en producción detiene el despliegue (así se
  actualizaron Next a 16.4.2 y Zod a 4.6.7).

---

## 🎨 Diseño: "expediente vivo"

- **Modo claro principal** (y oscuro "tinta nocturna"): papel cálido con grano, hojas con margen rojo de notaría,
  titulares en Source Serif 4 e iconografía lucide.
- **Colores con significado:** azul institucional para acciones, **lacre** para lo oficial y **violeta solo para lo
  que produce la IA**. El contraste WCAG AA lo verifica una prueba, en claro y en oscuro.
- Animaciones con sentido, casi todas con `transform` y `opacity` (las que el compositor mueve sin el hilo principal), que se apagan con `prefers-reduced-motion`. También hay
  container queries, `aria-current` y foco siempre visible.
- **Isotipo propio** (hoja de expediente con sello de lacre) como favicon e icono de la app.

---

## 🛠️ Desarrollo, pruebas y despliegue

### Sin ningún servicio (mocks tipados)

```powershell
npm ci
$env:ACTAFLOW_RPC_MODE="mock"; npm run dev
```

Abre `http://localhost:3001/registro#invitacion=invitacion-simulada-publica-solo-para-desarrollo-0001` y crea el
administrador con `admin@actaflow.test`. El modo simulado incluye un **motor simulado** que abre los sobres de
verdad: lo único de mentira es el texto de la transcripción.

### Con los microservicios locales (gRPC nativo)

```powershell
[Environment]::SetEnvironmentVariable("ACTAFLOW_RPC_TRANSPORT", "grpc", "User")
[Environment]::SetEnvironmentVariable("ACTAFLOW_IDENTITY_URL", "http://localhost:9198", "User")
[Environment]::SetEnvironmentVariable("ACTAFLOW_LEGAL_CASE_URL", "http://localhost:9197", "User")
[Environment]::SetEnvironmentVariable("ACTAFLOW_IDENTITY_HMAC_SECRET", "<el mismo de identity-service>", "User")
[Environment]::SetEnvironmentVariable("ACTAFLOW_LEGAL_CASE_HMAC_SECRET", "<el mismo de legal-case-service>", "User")
npm run dev
```

### Verificación

```powershell
npm run lint; npm run typecheck; npm test; npm run build
```

**178 pruebas** (Vitest + Testing Library) cubren, entre otras cosas:

- Criptografía y sellado para el motor.
- El anillo de memoria compartida y el sellado dentro del Worker.
- La central del Shared Worker: una conexión para varias pestañas.
- El borrador colaborativo con la bandeja sin conexión.
- El Event Loop, el INP y el desbloqueo desde **un hilo real** (`worker_threads`).
- Los flujos completos de sala y acta en modo simulado.
- El contraste de colores, el tema y las páginas estáticas.

Además, se probó de punta a punta con un navegador real (Playwright): audiencia, acta, red cortada, varias pestañas y
el laboratorio.

### Despliegue (Vercel)

Variables de producción: `ACTAFLOW_IDENTITY_URL` y `ACTAFLOW_LEGAL_CASE_URL` (Render),
`ACTAFLOW_IDENTITY_HMAC_SECRET` y `ACTAFLOW_LEGAL_CASE_HMAC_SECRET`, y opcional `ACTAFLOW_BACKEND_WAIT_MS=120000`. Cada
push a `main` con el CI en verde despliega solo.

**Plan gratuito:** el BFF espera hasta 2 minutos a un servicio dormido de Render (solo reintenta `UNAVAILABLE` y
`DEADLINE_EXCEEDED`). La portada despierta los servicios en segundo plano, y `/estado` se vuelve a consultar sola
mientras algo no esté operativo.

---

<div align="center">

**ActaFlow** · Proyecto académico de Ingeniería de Software · Sin datos reales de personas ni de procesos

Desarrollado por **David Fernando Ramírez de la Parra** · Profesor **Jhonatan Andrés Mideros Narváez**<br>
**Programación Orientada a la Web** · **Universidad Cooperativa de Colombia**

</div>
