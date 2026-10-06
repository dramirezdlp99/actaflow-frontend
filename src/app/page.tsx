import { ArrowRight, Lock, Sparkles, Users, WifiOff, Zap, type LucideIcon } from 'lucide-react'
import Link from 'next/link'
import { DespertarServicios } from '@/components/inicio/DespertarServicios'
import { Encabezado } from '@/components/marca/Encabezado'
import { PiePagina } from '@/components/marca/PiePagina'

// Portada: SSG. Contenido identico para todos, generado en el build y servido desde la CDN.
export const dynamic = 'force-static'

type Pilar = { icono: LucideIcon; titulo: string; texto: string }

const PILARES: Pilar[] = [
  {
    icono: Zap,
    titulo: 'Edición sin congelamientos',
    texto:
      'El audio y el cifrado se procesan en segundo plano dentro del navegador, para que navegar por las cláusulas y editar el borrador nunca se detenga.',
  },
  {
    icono: Lock,
    titulo: 'Cifrado en el navegador',
    texto:
      'Borradores, anexos y audio se cifran en tu equipo antes de viajar a la nube, para proteger el secreto profesional.',
  },
  {
    icono: WifiOff,
    titulo: 'Funciona sin conexión',
    texto:
      'Consulta expedientes, carga plantillas y redacta en salas con mala señal. Todo se sincroniza solo al volver la red.',
  },
  {
    icono: Users,
    titulo: 'Revisión colaborativa',
    texto:
      'El conciliador, las partes y el asistente ven la misma minuta en tiempo real, sin peticiones duplicadas.',
  },
]

export default function Inicio() {
  return (
    <>
      <DespertarServicios />
      <Encabezado />
      <main id="contenido" className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <section aria-labelledby="titulo-portada" className="max-w-3xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-linea bg-superficie px-3 py-1 text-sm text-tinta-suave">
            <span className="size-2 rounded-full bg-alerta" aria-hidden="true" />
            En construcción
          </p>
          <h1 id="titulo-portada" className="mt-6 font-serif text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            ActaFlow — minutas de audiencia listas para revisión mientras la audiencia ocurre
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-tinta-suave">
            Plataforma para centros de conciliación, notarías y despachos jurídicos. Automatiza la redacción,
            estructuración y maquetación de minutas, actas de acuerdo y contratos durante audiencias de conciliación y
            mediaciones, sin transcribir ni maquetar después.
          </p>
          <Link
            href="/estado"
            className="mt-8 inline-flex items-center gap-2 rounded-md bg-institucional px-5 py-3 font-medium text-white hover:opacity-90"
          >
            Ver el estado del sistema
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </section>

        <section aria-labelledby="titulo-pilares" className="mt-16">
          <h2 id="titulo-pilares" className="font-serif text-2xl font-semibold">
            Lo que estamos construyendo
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            {PILARES.map(({ icono: Icono, titulo, texto }) => (
              <li key={titulo} className="rounded-lg border border-linea bg-superficie p-6">
                <Icono aria-hidden="true" className="size-6 text-institucional" strokeWidth={1.75} />
                <h3 className="mt-4 text-lg font-semibold">{titulo}</h3>
                <p className="mt-2 leading-relaxed text-tinta-suave">{texto}</p>
              </li>
            ))}
          </ul>

          <article className="mt-4 rounded-lg border border-ia/30 bg-ia-suave p-6" aria-labelledby="titulo-ia">
            <p className="inline-flex items-center gap-2 text-sm font-medium text-ia">
              <Sparkles aria-hidden="true" className="size-4" />
              Inteligencia artificial
            </p>
            <h3 id="titulo-ia" className="mt-3 text-lg font-semibold">
              La IA propone; el abogado confirma
            </h3>
            <p className="mt-2 leading-relaxed text-tinta-suave">
              Transcribe la audiencia, distingue las intervenciones de cada hablante y extrae la identificación de las
              partes, los montos acordados, las fechas límite de pago, los compromisos de entrega y las cláusulas
              penales. Con eso autocompleta la plantilla legal elegida. El color violeta se reserva solo para lo que
              produce la IA, para que siempre sepas qué revisar.
            </p>
          </article>
        </section>
      </main>
      <PiePagina />
    </>
  )
}
