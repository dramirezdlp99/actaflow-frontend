'use client'

import { BadgeCheck, FileSearch, ShieldAlert } from 'lucide-react'
import { useState } from 'react'
import { verificarDocumento, type Verificacion } from '@/app/acciones/actas'
import { sha256Hex } from '@/lib/actas/navegador'

const MAXIMO = 25 * 1024 * 1024

type Estado =
  | { tipo: 'inicio' }
  | { tipo: 'calculando' }
  | { tipo: 'listo'; sha256: string; resultado: Verificacion }
  | { tipo: 'error'; mensaje: string }

export function VerificarActa() {
  const [estado, setEstado] = useState<Estado>({ tipo: 'inicio' })

  async function elegir(archivo: File | undefined) {
    if (!archivo) return
    if (archivo.size > MAXIMO) {
      setEstado({ tipo: 'error', mensaje: 'El archivo es demasiado grande para ser un acta de ActaFlow.' })
      return
    }
    setEstado({ tipo: 'calculando' })
    const sha256 = await sha256Hex(new Uint8Array(await archivo.arrayBuffer()))
    const r = await verificarDocumento({ sha256 })
    setEstado(r.ok ? { tipo: 'listo', sha256, resultado: r } : { tipo: 'error', mensaje: r.mensaje })
  }

  return (
    <div className="grid gap-6">
      <label className="flex cursor-pointer flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-linea bg-superficie p-10 text-center transition hover:border-institucional">
        <FileSearch aria-hidden className="size-8 text-institucional" />
        <span className="font-semibold">Elegir el PDF del acta</span>
        <span className="text-sm text-tinta-suave">El archivo no se sube: solo se envía su huella.</span>
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(e) => void elegir(e.target.files?.[0])}
        />
      </label>

      <div aria-live="polite">
        {estado.tipo === 'calculando' ? <p className="text-sm text-tinta-suave">Comprobando…</p> : null}
        {estado.tipo === 'error' ? <p className="text-sm text-error">{estado.mensaje}</p> : null}
        {estado.tipo === 'listo' && estado.resultado.autentico ? (
          <section className="rounded-2xl border border-exito/40 bg-superficie p-6 shadow-suave">
            <h2 className="flex items-center gap-2 text-xl font-semibold text-exito">
              <BadgeCheck aria-hidden className="size-5" /> Acta auténtica
            </h2>
            <p className="mt-2 text-sm">
              Este PDF es exactamente el que ActaFlow selló. No ha sido modificado.
            </p>
            <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
              <dt className="text-tinta-suave">Radicado</dt>
              <dd>{estado.resultado.radicado}</dd>
              <dt className="text-tinta-suave">Sellado</dt>
              <dd>
                {estado.resultado.selladoEn
                  ? new Date(estado.resultado.selladoEn).toLocaleString('es-CO', { dateStyle: 'long', timeStyle: 'short' })
                  : ''}
              </dd>
              <dt className="text-tinta-suave">Aceptaciones</dt>
              <dd>{estado.resultado.aceptaciones}</dd>
              <dt className="text-tinta-suave">Firmante</dt>
              <dd>{estado.resultado.firmante}</dd>
              <dt className="text-tinta-suave">SHA-256</dt>
              <dd className="break-all font-mono text-xs">{estado.sha256}</dd>
            </dl>
          </section>
        ) : null}
        {estado.tipo === 'listo' && !estado.resultado.autentico ? (
          <section className="rounded-2xl border border-error/40 bg-superficie p-6 shadow-suave">
            <h2 className="flex items-center gap-2 text-xl font-semibold text-error">
              <ShieldAlert aria-hidden className="size-5" /> No coincide con ningún acta sellada
            </h2>
            <p className="mt-2 text-sm">
              O el PDF fue modificado, o no fue sellado por ActaFlow. Pide a la conciliación el documento original.
            </p>
            <p className="mt-3 break-all font-mono text-xs text-tinta-suave">{estado.sha256}</p>
          </section>
        ) : null}
      </div>
      <p className="text-xs text-tinta-suave">
        El sello de ActaFlow (SHA-256 + firma CMS) prueba integridad; no es una firma digital certificada en los
        términos de la Ley 527 de 1999.
      </p>
    </div>
  )
}
