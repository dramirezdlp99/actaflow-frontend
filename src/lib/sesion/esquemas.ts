import { z } from 'zod'
import { desdeBase64Url } from '@/lib/cripto/bytes'

/**
 * Lo que el navegador envia a las Server Actions se PARSEA aqui (no se confia en los tipos de
 * TypeScript: en tiempo de ejecucion llega cualquier cosa). Los bytes viajan en base64url.
 */

const bytes = (largo: { exacto?: number; min?: number; max?: number }) =>
  z
    .string()
    .max(8_000_000)
    .transform((texto, ctx) => {
      try {
        return desdeBase64Url(texto)
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Bytes en base64url no validos' })
        return z.NEVER
      }
    })
    .refine((valor) => largo.exacto === undefined || valor.length === largo.exacto, 'Largo de bytes inesperado')
    .refine((valor) => largo.min === undefined || valor.length >= largo.min, 'Muy pocos bytes')
    .refine((valor) => largo.max === undefined || valor.length <= largo.max, 'Demasiados bytes')

export const correo = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: 'Escribe un correo válido' }))

const blob = z.object({
  idClave: z.string().min(1).max(120),
  nonce: bytes({ exacto: 12 }),
  cifrado: bytes({ min: 16, max: 16_384 }),
})

export const esquemaRegistro = z.object({
  invitacion: z.string().min(32, { error: 'El enlace de invitación está incompleto' }).max(128),
  correo,
  nombre: z
    .string()
    .trim()
    .min(2, { error: 'Escribe al menos 2 caracteres' })
    .max(120, { error: 'Máximo 120 caracteres' }),
  sal: bytes({ exacto: 16 }),
  iteraciones: z.number().int().min(600_000).max(10_000_000),
  verificador: bytes({ exacto: 32 }),
  idClavePublica: z.string().min(1).max(120),
  clavePublica: bytes({ exacto: 65 }).refine((valor) => valor[0] === 0x04, 'Clave publica no valida'),
  huella: z.string().regex(/^[0-9a-f]{64}$/),
  porContrasena: blob,
  porRecuperacion: blob,
  idempotencia: z.uuid(),
})

export const esquemaConfirmacion = z.object({
  inscripcion: z.uuid(),
  codigo: z.string().regex(/^[0-9]{6}$/, { error: 'El código tiene 6 dígitos' }),
})

export const esquemaIngreso = z.object({ correo, verificador: bytes({ exacto: 32 }) })

export const esquemaSegundoFactor = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('totp'), codigo: z.string().regex(/^[0-9]{6}$/, { error: 'El código tiene 6 dígitos' }) }),
  z.object({
    tipo: z.literal('recuperacion'),
    codigo: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/, { error: 'El formato es XXXXX-XXXXX' }),
  }),
])

export const esquemaInvitacion = z.object({
  correo,
  rol: z.enum(['MEMBER', 'EXTERNAL', 'ADMIN']),
  idempotencia: z.uuid(),
})

export type DatosRegistro = z.input<typeof esquemaRegistro>
export type DatosSegundoFactor = z.input<typeof esquemaSegundoFactor>
export type DatosInvitacion = z.input<typeof esquemaInvitacion>

/** Primer mensaje de cada campo con problema, para mostrarlo junto al campo. */
export function camposConProblema(error: z.ZodError): Record<string, string> {
  const campos: Record<string, string> = {}
  for (const problema of error.issues) {
    const campo = String(problema.path[0] ?? 'formulario')
    campos[campo] ??= problema.message
  }
  return campos
}
