import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Encabezado } from '@/components/marca/Encabezado'
import { PiePagina } from '@/components/marca/PiePagina'
import { EditorPlantilla } from '@/components/plantillas/EditorPlantilla'
import { VersionesPlantilla } from '@/components/plantillas/VersionesPlantilla'
import { PlatformRole } from '@/gen/actaflow/identity/v1/account_pb'
import { CATEGORIAS } from '@/lib/plantillas/etiquetas'
import { plantillaParaEditar } from '@/lib/plantillas/servidor'
import { exigirSesion } from '@/lib/sesion/sesion'

export const metadata: Metadata = { title: 'Editar plantilla' }
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function EditarPlantilla({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ version?: string }>
}) {
  const { id } = await params
  const sesion = await exigirSesion(`/panel/plantillas/${id}`)
  if (sesion.cuenta.role !== PlatformRole.ADMIN || !UUID.test(id)) {
    notFound()
  }
  const { version } = await searchParams
  const numero = version && /^[1-9]\d{0,5}$/.test(version) ? Number(version) : undefined
  const { versiones, actual } = await plantillaParaEditar(sesion, id, numero)
  const categoria = CATEGORIAS.find((c) => c.categoria === actual.categoria)?.valor ?? 'CONCILIATION_AGREEMENT'

  return (
    <>
      <Encabezado enSesion />
      <main id="contenido" className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <Link
          href="/panel/plantillas"
          prefetch={false}
          className="inline-flex items-center gap-1.5 text-sm text-institucional underline-offset-4 hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" /> Plantillas
        </Link>
        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div>
            <h1 className="titular text-4xl">{actual.titulo}</h1>
            <p className="mt-2 text-tinta-suave">
              Editando la versión {actual.version}. Guardar reemplaza el borrador o abre una versión nueva si esta ya
              se publicó.
            </p>
          </div>
          <VersionesPlantilla
            id={actual.id}
            slug={actual.slug}
            enEdicion={actual.version}
            versiones={versiones.map((v) => ({
              numero: v.version,
              estado: v.estado,
              actualizada: v.actualizada,
              publicada: v.publicada,
            }))}
          />
        </div>
        <EditorPlantilla
          key={`${actual.id}/${actual.version}`}
          inicial={{
            id: actual.id,
            slug: actual.slug,
            titulo: actual.titulo,
            descripcion: actual.descripcion,
            categoria,
            fuente: actual.fuente,
          }}
        />
      </main>
      <PiePagina />
    </>
  )
}
