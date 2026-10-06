import { Scale } from 'lucide-react'
import Link from 'next/link'

export function Logo() {
  return (
    <Link href="/" className="inline-flex items-center gap-2 rounded-md text-tinta" aria-label="ActaFlow, inicio">
      <span className="flex size-9 items-center justify-center rounded-md bg-institucional text-white">
        <Scale aria-hidden="true" className="size-5" strokeWidth={1.75} />
      </span>
      <span className="font-serif text-xl font-semibold tracking-tight">ActaFlow</span>
    </Link>
  )
}
