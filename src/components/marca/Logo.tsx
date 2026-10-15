import Link from 'next/link'

/** Monograma: una hoja de expediente con la esquina doblada y un sello de lacre. */
export function Isotipo({ className = 'size-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <rect x="1" y="1" width="38" height="38" rx="10" className="fill-institucional" />
      <path d="M12 9h11l6 6v16a1 1 0 0 1-1 1H12a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Z" className="fill-sobre-institucional" />
      <path d="M23 9v5a1 1 0 0 0 1 1h5" className="fill-none stroke-institucional" strokeWidth="1.4" />
      <path d="M14.5 18h8M14.5 21.5h10M14.5 25h5" className="stroke-institucional" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="27" cy="28" r="5.5" className="fill-lacre stroke-sobre-institucional" strokeWidth="1.5" />
      <path d="m24.8 28 1.5 1.5 2.9-3" className="fill-none stroke-sobre-institucional" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Logo() {
  return (
    <Link href="/" className="group inline-flex items-center gap-2.5 rounded-md text-tinta" aria-label="ActaFlow, inicio">
      <Isotipo className="size-9 transition-transform duration-300 group-hover:-rotate-6" />
      <span className="font-serif text-[1.35rem] font-semibold tracking-tight">
        Acta<span className="text-lacre">Flow</span>
      </span>
    </Link>
  )
}
