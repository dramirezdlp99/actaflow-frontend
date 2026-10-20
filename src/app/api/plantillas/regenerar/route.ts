import { revalidatePath } from 'next/cache'

/**
 * Pide regenerar la biblioteca ISR cuando quedo con el aviso de "no disponible" (por ejemplo, si el
 * build de Vercel encontro dormido a legal-case). Es una ruta normal y no una Server Action: el
 * aviso la llama apenas se monta, y React no permite Server Actions mientras hidrata la pagina.
 * Acotada a una vez cada 30 s por instancia, para que nadie la use para martillar el backend.
 */
let ultima = 0
const ESPERA_MS = 30_000

export function POST(): Response {
  const ahora = Date.now()
  if (ahora - ultima < ESPERA_MS) {
    return Response.json({ pedida: false }, { status: 429 })
  }
  ultima = ahora
  revalidatePath('/plantillas')
  return Response.json({ pedida: true })
}
