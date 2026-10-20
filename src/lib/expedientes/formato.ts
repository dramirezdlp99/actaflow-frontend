import { z } from 'zod'
import { aBase64Url, desdeBase64Url } from '@/lib/cripto/bytes'
import type { BlobCaso, Envoltura } from '@/lib/cripto/casos'

/**
 * Formato en que viajan los datos cifrados entre el navegador y el BFF (Server Actions y props):
 * texto base64url. En el servidor se PARSEA con Zod antes de armar el mensaje protobuf.
 */

export type BlobTexto = { idClave: string; nonce: string; cifrado: string; tipo: string }
export type EnvolturaTexto = { idDestinatario: string; efimera: string; nonce: string; envuelta: string }

export const blobATexto = (b: BlobCaso): BlobTexto => ({
  idClave: b.idClave,
  nonce: aBase64Url(b.nonce),
  cifrado: aBase64Url(b.cifrado),
  tipo: b.tipo,
})

export const textoABlob = (b: BlobTexto): BlobCaso => ({
  idClave: b.idClave,
  nonce: desdeBase64Url(b.nonce),
  cifrado: desdeBase64Url(b.cifrado),
  tipo: b.tipo,
})

export const envolturaATexto = (e: Envoltura): EnvolturaTexto => ({
  idDestinatario: e.idDestinatario,
  efimera: aBase64Url(e.efimera),
  nonce: aBase64Url(e.nonce),
  envuelta: aBase64Url(e.envuelta),
})

export const textoAEnvoltura = (e: EnvolturaTexto): Envoltura => ({
  idDestinatario: e.idDestinatario,
  efimera: desdeBase64Url(e.efimera),
  nonce: desdeBase64Url(e.nonce),
  envuelta: desdeBase64Url(e.envuelta),
})

const bytes = (largo: { exacto?: number; min?: number; max?: number }) =>
  z
    .string()
    .max(200_000)
    .transform((texto, ctx) => {
      try {
        return desdeBase64Url(texto)
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Bytes en base64url no validos' })
        return z.NEVER
      }
    })
    .refine((v) => largo.exacto === undefined || v.length === largo.exacto, 'Largo de bytes inesperado')
    .refine((v) => largo.min === undefined || v.length >= largo.min, 'Muy pocos bytes')
    .refine((v) => largo.max === undefined || v.length <= largo.max, 'Demasiados bytes')

/** Mismas reglas que EncryptedBlob y WrappedKey del contrato. */
export const esquemaBlob = z.object({
  idClave: z.string().min(1).max(120),
  nonce: bytes({ exacto: 12 }),
  cifrado: bytes({ min: 16, max: 100_000 }),
  tipo: z.string().max(200),
})

export const esquemaEnvoltura = z.object({
  idDestinatario: z.string().min(1).max(120),
  efimera: bytes({ exacto: 65 }).refine((v) => v[0] === 0x04, 'Clave efimera no valida'),
  nonce: bytes({ exacto: 12 }),
  envuelta: bytes({ exacto: 48 }),
})
