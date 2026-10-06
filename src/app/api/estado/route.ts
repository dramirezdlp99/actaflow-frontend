import { NextResponse } from 'next/server'
import { obtenerEstado } from '@/lib/estado/obtenerEstado'

// Route Handler del BFF: el navegador llama aqui y nunca conoce la URL real del backend.
// La portada lo usa para despertar los servicios de Render en segundo plano.
export const maxDuration = 300

export async function GET() {
  const vista = await obtenerEstado()
  return NextResponse.json(vista, { headers: { 'Cache-Control': 'no-store' } })
}
