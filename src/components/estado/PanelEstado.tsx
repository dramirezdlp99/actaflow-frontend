import { connection } from 'next/server'
import { obtenerEstado } from '@/lib/estado/obtenerEstado'
import { VistaEstadoSistema } from './VistaEstadoSistema'

/** Componente de servidor: consulta el backend a traves del BFF en cada peticion. */
export async function PanelEstado() {
  await connection() // el estado es siempre del momento: nada de prerenderizar
  const vista = await obtenerEstado()
  return <VistaEstadoSistema vista={vista} />
}

export function EsqueletoEstado() {
  return (
    <section className="mt-8" aria-busy="true" aria-live="polite">
      <p className="rounded-2xl border border-linea bg-superficie p-5 text-sm text-tinta-suave">
        Consultando cada capa… Si los servidores gratuitos estaban dormidos, despertarlos puede tardar cerca de un
        minuto.
      </p>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i} className="h-32 animate-pulse rounded-2xl border border-linea bg-superficie" />
        ))}
      </ul>
    </section>
  )
}
