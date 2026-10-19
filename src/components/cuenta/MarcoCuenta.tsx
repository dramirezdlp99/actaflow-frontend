import { KeyRound, ShieldCheck, Smartphone } from 'lucide-react'
import { DespertarServicios } from '@/components/inicio/DespertarServicios'
import { Encabezado } from '@/components/marca/Encabezado'
import { PiePagina } from '@/components/marca/PiePagina'

const GARANTIAS = [
  {
    icono: KeyRound,
    titulo: 'Tu contraseña no sale de este equipo',
    texto: 'El navegador deriva con PBKDF2 un verificador; el servidor solo guarda una huella de ese verificador.',
  },
  {
    icono: Smartphone,
    titulo: 'Segundo factor obligatorio',
    texto: 'Un código de tu app autenticadora (TOTP) en cada ingreso. Cada código sirve una sola vez.',
  },
  {
    icono: ShieldCheck,
    titulo: 'Tu clave privada viaja cifrada',
    texto: 'Se abre aquí, con tu contraseña. Ni ActaFlow ni el centro de conciliación pueden abrirla.',
  },
]

/** Pagina de cuenta: a la izquierda las garantias, a la derecha la hoja del tramite. */
export function MarcoCuenta({
  folio,
  titulo,
  bajada,
  children,
}: {
  folio: string
  titulo: string
  bajada: string
  children: React.ReactNode
}) {
  return (
    <>
      <DespertarServicios />
      <Encabezado />
      <main
        id="contenido"
        className="mx-auto grid max-w-6xl gap-x-12 gap-y-10 px-4 py-12 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:grid-rows-[auto_1fr] lg:py-16"
      >
        <div className="lg:pt-6">
          <p className="folio entrada text-lacre">{folio}</p>
          <h1 id="titulo-cuenta" className="titular entrada mt-3 text-4xl sm:text-5xl" style={{ '--i': 1 }}>
            {titulo}
          </h1>
          <p className="entrada mt-4 max-w-md leading-relaxed text-tinta-suave" style={{ '--i': 2 }}>
            {bajada}
          </p>
        </div>
        <div className="entrada lg:col-start-2 lg:row-span-2 lg:row-start-1" style={{ '--i': 2 }}>
          {children}
        </div>
        <section aria-label="Cómo se protege tu cuenta">
          <ul className="grid max-w-md gap-6">
            {GARANTIAS.map(({ icono: Icono, titulo: t, texto }, i) => (
              <li key={t} className="entrada flex gap-4" style={{ '--i': 3 + i }}>
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-institucional-suave text-institucional">
                  <Icono aria-hidden className="size-5" />
                </span>
                <div>
                  <p className="font-semibold">{t}</p>
                  <p className="mt-1 text-sm leading-relaxed text-tinta-suave">{texto}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <PiePagina />
    </>
  )
}

/** Hoja del tramite: papel de expediente con el paso actual en el margen. */
export function HojaTramite({
  paso,
  total,
  titulo,
  children,
}: {
  paso: number
  total: number
  titulo: string
  children: React.ReactNode
}) {
  return (
    <section
      aria-labelledby="titulo-paso"
      className="hoja relative overflow-hidden rounded-2xl py-8 pl-14 pr-5 sm:pl-16 sm:pr-10"
    >
      <p className="folio text-tinta-suave">
        Paso <span className="text-institucional">{String(paso).padStart(2, '0')}</span> de{' '}
        {String(total).padStart(2, '0')}
      </p>
      <h2 id="titulo-paso" className="titular mt-2 text-2xl">
        {titulo}
      </h2>
      <ol aria-hidden className="absolute left-4 top-9 grid gap-2">
        {Array.from({ length: total }, (_, i) => (
          <li
            key={i}
            className={`size-2.5 rounded-full transition-colors duration-500 ${i < paso ? 'bg-lacre' : 'bg-linea'}`}
          />
        ))}
      </ol>
      <div className="mt-6">{children}</div>
    </section>
  )
}
