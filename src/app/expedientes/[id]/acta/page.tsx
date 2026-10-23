import type { Metadata } from 'next'
import Link from 'next/link'
import { SalaActa } from '@/components/actas/SalaActa'
import { ProveedorClaveCaso } from '@/components/expedientes/ClaveCaso'
import { Encabezado } from '@/components/marca/Encabezado'
import { PiePagina } from '@/components/marca/PiePagina'
import { CaseRole } from '@/gen/actaflow/cases/v1/case_pb'
import { HearingSchema } from '@/gen/actaflow/hearings/v1/hearing_pb'
import { estadoActa } from '@/lib/actas/servidor'
import { desdeTexto } from '@/lib/audiencias/protocolo'
import { estadoSala } from '@/lib/audiencias/servidor'
import { ROL } from '@/lib/expedientes/etiquetas'
import { listarPersonas, obtenerCaso } from '@/lib/expedientes/servidor'
import { exigirSesion } from '@/lib/sesion/sesion'

export const metadata: Metadata = { title: 'Acta' }
export const dynamic = 'force-dynamic'
// Cerrar el acta pide la clave del motor: puede esperar a que despierte.
export const maxDuration = 300

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Acta del expediente (ADR 0004): el servidor entrega la plantilla publica, metadatos y bytes
 * cifrados. El llenado, el sellado para el motor, el descifrado del PDF y su comprobacion contra el
 * sello ocurren en el navegador (componente cliente).
 */
export default async function Acta({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sesion = await exigirSesion(`/expedientes/${UUID.test(id) ? `${id}/acta` : ''}`)
  const [{ caso, membresia }, personas] = await Promise.all([obtenerCaso(sesion, id), listarPersonas(sesion, id)])
  const [sala, estado] = await Promise.all([estadoSala(sesion, id), estadoActa(sesion, id)])
  const yo = { participanteId: membresia?.participanteId ?? '', rol: membresia?.rol ?? CaseRole.UNSPECIFIED }
  const inicio = sala.audiencia ? desdeTexto(HearingSchema, sala.audiencia).startedAt : undefined
  const presentes = personas.map((p) => ({
    id: p.id,
    nombre: p.nombre || p.correo,
    rol: p.rol,
    lado: p.lado,
    calidad: p.calidad,
  }))

  return (
    <>
      <Encabezado enSesion />
      <main id="contenido" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
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
            Acta de la audiencia
          </h1>
        </header>
        <div className="entrada mt-8" style={{ '--i': 2 }}>
          <ProveedorClaveCaso cuentaId={sesion.cuenta.id} envoltura={membresia?.clave ?? null}>
            {/* Al crear el acta, router.refresh() trae la plantilla fijada: la llave cambia y el componente arranca con ella. */}
            <SalaActa
              key={estado.acta ? 'con-acta' : 'sin-acta'}
              casoId={caso.id}
              idClaveCaso={caso.detalles?.idClave ?? ''}
              radicado={caso.radicado}
              yo={yo}
              personas={presentes}
              audienciaInicio={inicio ? new Date(Number(inicio.seconds) * 1000).toISOString() : null}
              extraccion={sala.extraccion}
              acta={estado.acta}
              fuente={estado.fuente}
              tituloPlantilla={estado.tituloPlantilla}
              documento={estado.documento}
              plantillas={estado.plantillas}
            />
          </ProveedorClaveCaso>
        </div>
      </main>
      <PiePagina />
    </>
  )
}
