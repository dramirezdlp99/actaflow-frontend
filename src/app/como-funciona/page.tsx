import type { Metadata } from 'next'
import {
  ArrowDown,
  Brain,
  Database,
  FileCode2,
  Globe,
  KeyRound,
  Server,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { Encabezado } from '@/components/marca/Encabezado'
import { PiePagina } from '@/components/marca/PiePagina'

export const metadata: Metadata = { title: 'Cómo funciona' }

// SSG: contenido identico para todos, generado en el build.
export const dynamic = 'force-static'

type Nodo = { icono: LucideIcon; nombre: string; tecnologia: string; detalle: string; ia?: boolean }

const SERVICIOS: Nodo[] = [
  {
    icono: KeyRound,
    nombre: 'identity-service',
    tecnologia: 'Java 21 · Spring Boot · gRPC',
    detalle: 'Cuentas, sesiones con TOTP, organizaciones, llaves públicas y pruebas de presencia. Esquema identity.',
  },
  {
    icono: Server,
    nombre: 'legal-case-service',
    tecnologia: 'Java 21 · Spring Boot · gRPC',
    detalle: 'Casos, audiencias, plantillas, actas, el sello del PDF y la cola de trabajos. Esquema legal_case.',
  },
]

const PASOS_CONTRATO = [
  {
    titulo: 'Diseñar el contrato',
    texto:
      'Antes de programar, cada servicio, mensaje y regla de validación se define en archivos .proto, en inglés, en el repositorio actaflow-contracts.',
  },
  {
    titulo: 'Fijar una versión',
    texto:
      'Cada repositorio copia una versión exacta (por ejemplo v0.1.0) con el sha256 de cada archivo. CI verifica que sea idéntica a la publicada.',
  },
  {
    titulo: 'Generar el código',
    texto:
      'De los mismos .proto salen las clases de Java, Python y TypeScript. Nadie escribe a mano un DTO, un cliente ni una ruta.',
  },
  {
    titulo: 'Trabajar en paralelo con mocks',
    texto:
      'El frontend funciona con respuestas simuladas y tipadas desde el contrato, sin esperar a que el backend exista.',
  },
]

const CADENA_TIPOS = [
  { capa: 'PostgreSQL', detalle: 'esquema por servicio, migrado con Flyway' },
  { capa: 'Java', detalle: 'clases generadas desde el contrato' },
  { capa: 'Protobuf', detalle: 'bytes tipados en el cable' },
  { capa: 'TypeScript', detalle: 'tipos generados con Protobuf-ES' },
  { capa: 'Interfaz', detalle: 'componentes que no compilan si el contrato cambia' },
]

const PATRONES = [
  { patron: 'SSG', rutas: '/, /como-funciona, /verificar, /terminos, /privacidad', estado: 'Hecho' },
  { patron: 'SSR + streaming', rutas: '/estado', estado: 'Hecho' },
  { patron: 'ISR', rutas: '/plantillas, /plantillas/[slug]', estado: 'Hecho' },
  { patron: 'SSR', rutas: '/expedientes, /panel', estado: 'Hecho' },
  { patron: 'Streaming SSR', rutas: '/expedientes/[id]', estado: 'Hecho' },
  { patron: 'CSR', rutas: '/expedientes/[id]/audiencia, /expedientes/[id]/acta', estado: 'Hecho' },
]

function Caja({ icono: Icono, nombre, tecnologia, detalle, ia }: Nodo) {
  return (
    <div
      className={`rounded-2xl border bg-superficie p-5 shadow-suave ${ia ? 'border-ia/40' : 'border-linea'}`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex size-10 items-center justify-center rounded-xl ${
            ia ? 'bg-ia-suave text-ia' : 'bg-institucional-suave text-institucional'
          }`}
        >
          <Icono aria-hidden="true" className="size-5" strokeWidth={1.75} />
        </span>
        <div>
          <p className="font-mono text-sm font-semibold">{nombre}</p>
          <p className="text-xs text-tinta-suave">{tecnologia}</p>
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-tinta-suave">{detalle}</p>
    </div>
  )
}

function Flecha({ texto }: { texto: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-3 text-xs font-medium text-tinta-suave">
      <ArrowDown aria-hidden="true" className="size-4 text-lacre" />
      <span className="rounded-full border border-linea bg-papel px-3 py-1 font-mono">{texto}</span>
    </div>
  )
}

export default function ComoFunciona() {
  return (
    <>
      <Encabezado />
      <main id="contenido" className="mx-auto max-w-6xl px-4 sm:px-6">
        <header className="max-w-3xl py-16">
          <p className="folio entrada text-lacre">Cómo funciona</p>
          <h1 className="titular entrada mt-3 text-5xl sm:text-6xl" style={{ '--i': 1 }}>
            Microservicios, contratos primero y nada de REST.
          </h1>
          <p className="entrada mt-6 text-lg leading-relaxed text-tinta-suave" style={{ '--i': 2 }}>
            ActaFlow no expone rutas con verbos HTTP. Los servicios publican funciones definidas en un contrato único y
            se llaman entre sí por gRPC: mensajes binarios tipados sobre HTTP/2.
          </p>
        </header>

        {/* ---------- Arquitectura ---------- */}
        <section aria-labelledby="titulo-mapa" className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <h2 id="titulo-mapa" className="titular text-3xl">
              El mapa de servicios
            </h2>
            <p className="mt-4 leading-relaxed text-tinta-suave">
              El navegador solo habla con el servidor de Next (el BFF). El BFF llama por gRPC a cada microservicio con
              una firma HMAC distinta por pareja de servicios. En local viaja gRPC nativo sobre HTTP/2; en producción,
              como Render Free no expone HTTP/2 público, viaja gRPC-Web sobre HTTP/1.1 hasta una pasarela que lo
              convierte en una llamada al mismo servidor gRPC.
            </p>
            <p className="mt-4 leading-relaxed text-tinta-suave">
              Cada servicio informa por qué transporte le llegó la llamada: puedes verlo en{' '}
              <Link href="/estado" className="font-medium text-institucional underline underline-offset-4">
                el estado del sistema
              </Link>
              .
            </p>
          </div>

          <figure aria-label="Diagrama de la arquitectura de ActaFlow" className="revelar">
            <Caja
              icono={Globe}
              nombre="Navegador"
              tecnologia="React 19 · Web Workers · WebCrypto"
              detalle="Interfaz, captura de audio y cifrado. Nunca conoce las URLs ni los secretos de los servicios."
            />
            <Flecha texto="Server Actions (RPC)" />
            <Caja
              icono={FileCode2}
              nombre="BFF · Next.js en Vercel"
              tecnologia="TypeScript · ConnectRPC · Zod"
              detalle="Firma cada llamada con HMAC y valida todo lo que entra antes de confiar en ello."
            />
            <Flecha texto="gRPC (local) · gRPC-Web (producción)" />
            <div className="grid gap-4 sm:grid-cols-2">
              {SERVICIOS.map((s) => (
                <Caja key={s.nombre} {...s} />
              ))}
            </div>
            <Flecha texto="gRPC con su propio secreto" />
            <div className="grid gap-4 sm:grid-cols-2">
              <Caja
                icono={Brain}
                nombre="ai-engine"
                tecnologia="Python 3.12 · FastAPI · grpcio"
                detalle="Transcripción, extracción de entidades y PDF del acta, con modelos locales y gratuitos."
                ia
              />
              <Caja
                icono={Database}
                nombre="PostgreSQL · Neon"
                tecnologia="Un esquema por servicio"
                detalle="Misma base, tablas separadas: identidad no ve las de expedientes ni al revés."
              />
            </div>
          </figure>
        </section>

        {/* ---------- Contract-First ---------- */}
        <section aria-labelledby="titulo-contrato" className="py-24">
          <p className="folio text-lacre">Contract-First</p>
          <h2 id="titulo-contrato" className="titular mt-3 max-w-2xl text-4xl">
            Programar es el último paso.
          </h2>
          <ol className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {PASOS_CONTRATO.map(({ titulo, texto }, i) => (
              <li key={titulo} className="revelar rounded-2xl border border-linea bg-superficie p-6 shadow-suave">
                <span className="font-serif text-5xl font-semibold text-lacre/80">{i + 1}</span>
                <h3 className="mt-3 font-serif text-xl font-semibold">{titulo}</h3>
                <p className="mt-2 text-sm leading-relaxed text-tinta-suave">{texto}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------- Tipado de punta a punta ---------- */}
        <section aria-labelledby="titulo-tipos" className="hoja rounded-3xl border border-linea p-8 sm:p-12 sm:pl-20">
          <p className="folio text-lacre">Tipado de punta a punta</p>
          <h2 id="titulo-tipos" className="titular mt-3 max-w-3xl text-4xl">
            Un cambio en el contrato rompe la compilación, no la producción.
          </h2>
          <ol className="mt-10 flex flex-col gap-3 lg:flex-row lg:items-stretch">
            {CADENA_TIPOS.map(({ capa, detalle }) => (
              <li key={capa} className="flex flex-1 items-center gap-3 lg:flex-col lg:items-start">
                <div className="revelar flex-1 rounded-xl border border-linea bg-papel p-4">
                  <p className="font-mono text-sm font-semibold">{capa}</p>
                  <p className="mt-1 text-sm text-tinta-suave">{detalle}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <div>
              <h3 className="font-serif text-xl font-semibold">La falsa seguridad de TypeScript</h3>
              <p className="mt-2 leading-relaxed text-tinta-suave">
                Los tipos desaparecen al ejecutar. Un <code className="font-mono text-sm">as</code> le dice al
                compilador «confía en mí» sin comprobar nada. Por eso, lo que entra desde fuera se{' '}
                <strong>parsea</strong> (Zod para la configuración, Protobuf para los mensajes) y una regla de ESLint
                prohíbe los <code className="font-mono text-sm">as</code> en el código de producción.
              </p>
            </div>
            <div>
              <h3 className="font-serif text-xl font-semibold">Validar en el contrato</h3>
              <p className="mt-2 leading-relaxed text-tinta-suave">
                Las reglas (un UUID, un monto positivo, una fecha válida) viven en el propio contrato con protovalidate,
                y cada servicio las aplica antes de ejecutar: una sola definición para todos los lenguajes.
              </p>
            </div>
          </div>
        </section>

        {/* ---------- Seguridad ---------- */}
        <section aria-labelledby="titulo-seguridad" className="grid gap-10 py-24 lg:grid-cols-2">
          <div>
            <p className="folio text-lacre">Secreto profesional</p>
            <h2 id="titulo-seguridad" className="titular mt-3 text-4xl">
              Cada pareja de servicios, su propio secreto.
            </h2>
          </div>
          <ul className="grid gap-4">
            {[
              'Cada llamada gRPC lleva una firma HMAC-SHA256 sobre los bytes exactos del mensaje y una marca de tiempo: sin firma válida, el servicio ni siquiera se ejecuta.',
              'El BFF, identidad, expedientes y el motor usan secretos distintos por pareja, distintos también entre local y producción, y siempre desde variables de entorno.',
              'Los errores viajan como códigos gRPC con detalles tipados, y a quien no participa en un caso se le responde «no encontrado», sin revelar que existe.',
            ].map((texto) => (
              <li key={texto} className="revelar flex gap-3 rounded-2xl border border-linea bg-superficie p-5">
                <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-exito" strokeWidth={1.75} />
                <p className="leading-relaxed text-tinta-suave">{texto}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ---------- Patrones de renderizado ---------- */}
        <section aria-labelledby="titulo-patrones">
          <p className="folio text-lacre">Patrones de renderizado</p>
          <h2 id="titulo-patrones" className="titular mt-3 text-4xl">
            Cada página, el patrón que le corresponde.
          </h2>
          <div className="mt-8 overflow-x-auto rounded-2xl border border-linea bg-superficie">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">Patrón de renderizado de cada ruta y su estado</caption>
              <thead className="border-b border-linea bg-papel-hondo/60">
                <tr>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Patrón
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Rutas
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Estado
                  </th>
                </tr>
              </thead>
              <tbody>
                {PATRONES.map(({ patron, rutas, estado }) => (
                  <tr key={patron} className="border-b border-linea/70 last:border-0">
                    <th scope="row" className="px-5 py-3 font-medium">
                      {patron}
                    </th>
                    <td className="px-5 py-3 font-mono text-xs text-tinta-suave">{rutas}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          estado === 'Hecho' ? 'bg-exito/10 text-exito' : 'bg-alerta/10 text-alerta'
                        }`}
                      >
                        {estado}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      <PiePagina />
    </>
  )
}
