import { ArrowRight, Boxes, Lock, Sparkles, Users, WifiOff, Zap, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { DespertarServicios } from '@/components/inicio/DespertarServicios'
import { LineaDeTiempo } from '@/components/inicio/LineaDeTiempo'
import { MinutaViva } from '@/components/inicio/MinutaViva'
import { Encabezado } from '@/components/marca/Encabezado'
import { PiePagina } from '@/components/marca/PiePagina'

// Portada: SSG. Contenido identico para todos, generado en el build y servido desde la CDN.
export const dynamic = 'force-static'
// La Server Action que despierta los servicios puede esperar a Render (~1 min) y a Neon.
export const maxDuration = 300

type Pilar = { icono: LucideIcon; titulo: string; texto: string; tecnica: string }

const PILARES: Pilar[] = [
  {
    icono: Zap,
    titulo: 'Edición sin congelamientos',
    texto:
      'El audio y el cifrado se procesan en segundo plano dentro del navegador, para que navegar por las cláusulas y editar el borrador nunca se detenga.',
    tecnica: 'Web Workers · AudioWorklet',
  },
  {
    icono: Lock,
    titulo: 'Cifrado en el navegador',
    texto:
      'Borradores, anexos y audio se cifran en tu equipo antes de viajar a la nube, para proteger el secreto profesional.',
    tecnica: 'WebCrypto · AES-GCM',
  },
  {
    icono: WifiOff,
    titulo: 'Funciona sin conexión',
    texto:
      'Consulta expedientes, carga plantillas y redacta en salas con mala señal. Todo se sincroniza solo al volver la red.',
    tecnica: 'Service Worker · IndexedDB',
  },
  {
    icono: Users,
    titulo: 'Revisión colaborativa',
    texto:
      'El conciliador, las partes y el asistente ven la misma minuta en tiempo real, sin peticiones duplicadas.',
    tecnica: 'CRDT · WebSocket',
  },
]

const TECNOLOGIAS = ['gRPC', 'gRPC-Web', 'Protocol Buffers', 'Contract-First', 'HTTP/2', 'Tipado de punta a punta']

export default function Inicio() {
  return (
    <>
      <DespertarServicios />
      <Encabezado />
      <main id="contenido">
        {/* ---------- Portada ---------- */}
        <section
          aria-labelledby="titulo-portada"
          className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-12 sm:px-6 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-10 lg:pt-20"
        >
          <div>
            <p className="entrada inline-flex items-center gap-2 rounded-full border border-linea bg-superficie/80 px-3 py-1 text-sm text-tinta-suave">
              <span className="en-vivo size-2 rounded-full bg-alerta" aria-hidden="true" />
              En construcción
            </p>
            <h1 id="titulo-portada" className="titular entrada mt-6 text-[2.6rem] sm:text-6xl" style={{ '--i': 1 }}>
              La minuta se escribe <em className="font-serif italic text-lacre">mientras</em> la audiencia ocurre.
            </h1>
            <p className="entrada mt-6 max-w-xl text-lg leading-relaxed text-tinta-suave" style={{ '--i': 2 }}>
              ActaFlow redacta, estructura y maqueta las minutas, actas de acuerdo y contratos de las audiencias de
              conciliación y mediación. Para centros de conciliación, notarías y despachos jurídicos: sin transcribir
              ni maquetar después.
            </p>
            <div className="entrada mt-9 flex flex-wrap gap-3" style={{ '--i': 3 }}>
              <Link
                href="/como-funciona"
                className="group inline-flex items-center gap-2 rounded-full bg-institucional px-6 py-3 font-medium text-sobre-institucional shadow-suave transition hover:-translate-y-0.5"
              >
                Cómo funciona
                <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                href="/estado"
                className="inline-flex items-center gap-2 rounded-full border border-linea bg-superficie px-6 py-3 font-medium text-tinta transition hover:border-institucional"
              >
                Ver el estado del sistema
              </Link>
            </div>
          </div>
          <MinutaViva />
        </section>

        {/* ---------- Recorrido ---------- */}
        <section aria-labelledby="titulo-recorrido" className="border-y border-linea bg-papel-hondo/50">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <p className="folio text-lacre">Del audio al acta</p>
              <h2 id="titulo-recorrido" className="titular mt-3 text-4xl">
                Cinco pasos, una sola sesión.
              </h2>
              <p className="mt-4 max-w-md leading-relaxed text-tinta-suave">
                Lo que hoy se transcribe y maqueta durante días, ActaFlow lo deja listo para revisión antes de que las
                partes se levanten de la mesa.
              </p>
            </div>
            <LineaDeTiempo />
          </div>
        </section>

        {/* ---------- Pilares ---------- */}
        <section aria-labelledby="titulo-pilares" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <p className="folio text-lacre">El navegador trabaja</p>
          <h2 id="titulo-pilares" className="titular mt-3 text-4xl">
            Lo que estamos construyendo
          </h2>
          <ul className="mt-10 grid gap-5 sm:grid-cols-2">
            {PILARES.map(({ icono: Icono, titulo, texto, tecnica }) => (
              <li key={titulo} className="revelar @container">
                <article className="group h-full rounded-2xl border border-linea bg-superficie p-6 shadow-suave transition duration-300 hover:-translate-y-1 hover:border-institucional/50 @md:grid @md:grid-cols-[auto_1fr] @md:gap-5">
                  <span className="flex size-12 items-center justify-center rounded-xl bg-institucional-suave text-institucional transition-transform duration-300 group-hover:-rotate-6">
                    <Icono aria-hidden="true" className="size-6" strokeWidth={1.75} />
                  </span>
                  <div className="mt-4 @md:mt-0">
                    <h3 className="font-serif text-xl font-semibold">{titulo}</h3>
                    <p className="mt-2 leading-relaxed text-tinta-suave">{texto}</p>
                    <p className="mt-4 font-mono text-xs text-tinta-suave">{tecnica}</p>
                  </div>
                </article>
              </li>
            ))}
          </ul>

          <article
            className="revelar relative mt-5 overflow-hidden rounded-2xl border border-ia/30 bg-ia-suave p-8"
            aria-labelledby="titulo-ia"
          >
            <Sparkles aria-hidden="true" className="absolute -right-6 -top-6 size-40 text-ia opacity-10" strokeWidth={1} />
            <p className="inline-flex items-center gap-2 text-sm font-medium text-ia">
              <Sparkles aria-hidden="true" className="size-4" />
              Inteligencia artificial
            </p>
            <h3 id="titulo-ia" className="mt-3 font-serif text-2xl font-semibold">
              La IA propone; el abogado confirma
            </h3>
            <p className="mt-3 max-w-3xl leading-relaxed text-tinta-suave">
              Transcribe la audiencia, distingue las intervenciones de cada hablante y extrae la identificación de las
              partes, los montos acordados, las fechas límite de pago, los compromisos de entrega y las cláusulas
              penales. Con eso autocompleta la plantilla legal elegida. El color violeta se reserva solo para lo que
              produce la IA, para que siempre sepas qué revisar.
            </p>
          </article>
        </section>

        {/* ---------- Arquitectura ---------- */}
        <section aria-labelledby="titulo-arquitectura" className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="revelar relative overflow-hidden rounded-3xl bg-institucional px-8 py-14 text-sobre-institucional sm:px-14">
            <Boxes aria-hidden="true" className="absolute -bottom-10 -right-10 size-64 opacity-10" strokeWidth={0.8} />
            <p className="folio opacity-80">Por dentro</p>
            <h2 id="titulo-arquitectura" className="titular mt-3 max-w-2xl text-4xl">
              Microservicios que hablan gRPC, con el contrato primero.
            </h2>
            <p className="mt-4 max-w-2xl leading-relaxed opacity-85">
              Cada servicio publica funciones definidas antes de programar, en un contrato único del que se genera el
              código de Java, Python y TypeScript. Nada de rutas REST escritas a mano.
            </p>
            <ul className="mt-8 flex flex-wrap gap-2" aria-label="Tecnologías">
              {TECNOLOGIAS.map((t) => (
                <li key={t} className="rounded-full border border-sobre-institucional/30 px-3 py-1 text-sm">
                  {t}
                </li>
              ))}
            </ul>
            <Link
              href="/como-funciona"
              className="group mt-10 inline-flex items-center gap-2 rounded-full bg-sobre-institucional px-6 py-3 font-medium text-institucional transition hover:-translate-y-0.5"
            >
              Ver la arquitectura
              <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </section>
      </main>
      <PiePagina />
    </>
  )
}
