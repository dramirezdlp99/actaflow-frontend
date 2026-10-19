import { aBase64Url, desdeBase64Url } from '@/lib/cripto/bytes'
import {
  abrirConContrasena,
  crearKit,
  derivarClaves,
  ITERACIONES_KDF,
  nuevaSal,
  type ClavesDerivadas,
} from '@/lib/cripto/claves'
import type { DatosRegistro } from '@/lib/sesion/esquemas'

/**
 * Pasos del navegador antes de llamar a las Server Actions. Todo lo secreto (contrasena, clave
 * derivada, clave privada abierta, clave de recuperacion) se queda en esta pestana.
 */

export type RegistroPreparado = {
  datos: DatosRegistro
  claves: ClavesDerivadas
  claveRecuperacion: string
  huella: string
}

export async function prepararRegistro(entrada: {
  invitacion: string
  correo: string
  nombre: string
  contrasena: string
  idempotencia: string
  iteraciones?: number
}): Promise<RegistroPreparado> {
  const sal = nuevaSal()
  const iteraciones = entrada.iteraciones ?? ITERACIONES_KDF
  const claves = await derivarClaves(entrada.contrasena, sal, iteraciones)
  const kit = await crearKit(claves.kek)
  const blob = (b: typeof kit.porContrasena) => ({
    idClave: b.idClave,
    nonce: aBase64Url(b.nonce),
    cifrado: aBase64Url(b.cifrado),
  })
  return {
    datos: {
      invitacion: entrada.invitacion,
      correo: entrada.correo,
      nombre: entrada.nombre,
      sal: aBase64Url(sal),
      iteraciones,
      verificador: aBase64Url(claves.verificador),
      idClavePublica: kit.idClavePublica,
      clavePublica: aBase64Url(kit.clavePublica),
      huella: kit.huella,
      porContrasena: blob(kit.porContrasena),
      porRecuperacion: blob(kit.porRecuperacion),
      idempotencia: entrada.idempotencia,
    },
    claves,
    claveRecuperacion: kit.claveRecuperacion,
    huella: kit.huella,
  }
}

export async function prepararIngreso(
  contrasena: string,
  parametros: { sal: string; iteraciones: number },
): Promise<{ verificador: string; claves: ClavesDerivadas }> {
  const claves = await derivarClaves(contrasena, desdeBase64Url(parametros.sal), parametros.iteraciones)
  return { verificador: aBase64Url(claves.verificador), claves }
}

export async function abrirKit(
  claves: ClavesDerivadas,
  kit: { idClave: string; nonce: string; cifrado: string },
): Promise<CryptoKey> {
  return abrirConContrasena(claves.kek, {
    idClave: kit.idClave,
    nonce: desdeBase64Url(kit.nonce),
    cifrado: desdeBase64Url(kit.cifrado),
  })
}

/** Texto del kit de recuperacion para descargar e imprimir. */
export function textoKitRecuperacion(datos: {
  correo: string
  claveRecuperacion: string
  codigos: readonly string[]
  huella: string
  fecha: Date
}): string {
  return [
    'ActaFlow - Kit de recuperacion',
    `Cuenta: ${datos.correo}`,
    `Generado: ${datos.fecha.toISOString().slice(0, 10)}`,
    '',
    'CLAVE DE RECUPERACION (abre tu clave privada si olvidas la contrasena):',
    datos.claveRecuperacion,
    '',
    'CODIGOS DE UN SOLO USO (reemplazan el codigo de la app si pierdes el telefono):',
    ...datos.codigos.map((codigo, i) => `${String(i + 1).padStart(2, '0')}. ${codigo}`),
    '',
    `Huella de tu clave publica (SHA-256): ${datos.huella}`,
    '',
    'Guarda este archivo fuera del computador (impreso o en un gestor de contrasenas).',
    'ActaFlow no puede recuperarlo por ti: el servidor nunca conoce tu contrasena ni esta clave.',
    '',
  ].join('\n')
}
