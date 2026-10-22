import type { Metadata } from 'next'
import Link from 'next/link'
import { SalaAudiencia } from '@/components/audiencias/SalaAudiencia'
import { ProveedorClaveCaso } from '@/components/expedientes/ClaveCaso'
import { Encabezado } from '@/components/marca/Encabezado'
import { PiePagina } from '@/components/marca/PiePagina'
import { CaseRole, CaseStatus } from '@/gen/actaflow/cases/v1/case_pb'
import { estadoSala } from '@/lib/audiencias/servidor'
import { ROL } from '@/lib/expedientes/etiquetas'
import { listarPersonas, obtenerCaso } from '@/lib/expedientes/servidor'
import { exigirSesion } from '@/lib/sesion/sesion'

export const metadata: Metadata = { title: 'Sala de audiencia' }
export const dynamic = 'force-dynamic'
// Las Server Actions de la sala corren aqui: pedir la clave del motor puede esperar a que despierte.
export const maxDuration = 300

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Sala de audiencia: el servidor solo entrega metadatos y bytes cifrados; el audio se graba, se
 * sella y se descifra en el navegador (componente cliente). Permissions-Policy habilita el
 * microfono SOLO en esta ruta (next.config.ts).
 */
export default async function Sala({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sesion = await exigirSesion(`/expedientes/${UUID.test(id) ? `${id}/audiencia` : ''}`)
  const [{ caso, membresia }, personas] = await Promise.all([obtenerCaso(sesion, id), listarPersonas(sesion, id)])
  const sala = await estadoSala(sesion, id)
  const yo = { participanteId: membresia?.participanteId ?? '', rol: membresia?.rol ?? CaseRole.UNSPECIFIED }
  const presentes = personas.map((p) => ({ id: p.id, nombre: p.nombre || p.correo, rol: p.rol }))

  return (
    <>
      <Encabezado enSesion />
      <main id="contenido" className="mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <Link
          href={`/expedientes/${caso.id}`}
          prefetch={false}
          className="text-sm font-medium text-institucional hover:underline"
        >
          ← Expediente {caso.radicado}
        </Link>
        <header className="mt-6">
          <p className="folio entrada text-lacre">Tu rol: {ROL[yo.rol]}</p>
          <h1 className="entrada mt-3 text-4xl font-semibold sm:text-5xl" style={{ '--i': 1 }}>
            Sala de audiencia
          </h1>
        </header>
        <div className="entrada mt-8" style={{ '--i': 2 }}>
          <ProveedorClaveCaso cuentaId={sesion.cuenta.id} envoltura={membresia?.clave ?? null}>
            <SalaAudiencia
              casoId={caso.id}
              idClaveCaso={caso.detalles?.idClave ?? ''}
              yo={yo}
              personas={presentes}
              audienciaInicial={sala.audiencia}
              segmentosIniciales={sala.segmentos}
              extraccionInicial={sala.extraccion}
              puedeIniciar={caso.estado === CaseStatus.OPEN || caso.estado === CaseStatus.IN_HEARING}
            />
          </ProveedorClaveCaso>
        </div>
      </main>
      <PiePagina />
    </>
  )
}
