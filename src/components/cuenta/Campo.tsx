import { useId } from 'react'

type Props = {
  etiqueta: string
  error?: string | undefined
  ayuda?: React.ReactNode
} & React.InputHTMLAttributes<HTMLInputElement>

/** Campo de formulario con etiqueta, ayuda y error enlazados para lectores de pantalla. */
export function Campo({ etiqueta, error, ayuda, className, ...input }: Props) {
  const id = useId()
  const idAyuda = `${id}-ayuda`
  const idError = `${id}-error`
  const descritoPor = [ayuda ? idAyuda : null, error ? idError : null].filter(Boolean).join(' ') || undefined
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-tinta">
        {etiqueta}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={descritoPor}
        className="mt-1.5 block w-full rounded-lg border border-linea bg-superficie px-3.5 py-2.5 text-[0.95rem] text-tinta shadow-[inset_0_1px_2px_rgb(0_0_0/0.04)] outline-none transition placeholder:text-tinta-suave/60 focus:border-institucional focus:ring-2 focus:ring-institucional/25 aria-[invalid=true]:border-error aria-[invalid=true]:ring-error/20 disabled:opacity-60"
        {...input}
      />
      {ayuda ? (
        <p id={idAyuda} className="mt-1.5 text-xs leading-relaxed text-tinta-suave">
          {ayuda}
        </p>
      ) : null}
      {error ? (
        <p id={idError} className="mt-1.5 text-sm font-medium text-error">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Mensaje de error general del formulario, anunciado al aparecer. */
export function AvisoError({ mensaje }: { mensaje: string | null }) {
  return (
    <div role="alert" aria-live="assertive" className="empty:hidden">
      {mensaje ? (
        <p className="rounded-lg border border-error/30 bg-lacre-suave px-4 py-3 text-sm font-medium text-error">
          {mensaje}
        </p>
      ) : null}
    </div>
  )
}

export function BotonPrincipal({
  ocupado,
  textoOcupado,
  children,
  ...boton
}: { ocupado?: boolean; textoOcupado?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="submit"
      disabled={ocupado || boton.disabled}
      aria-busy={ocupado || undefined}
      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-institucional px-5 py-3 text-sm font-semibold text-sobre-institucional shadow-suave transition hover:brightness-110 active:translate-y-px disabled:cursor-wait disabled:opacity-70"
      {...boton}
    >
      {ocupado ? (
        <>
          <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
          {textoOcupado ?? 'Procesando…'}
        </>
      ) : (
        children
      )}
    </button>
  )
}
