'use server'

import { Code, ConnectError } from '@connectrpc/connect'
import { z } from 'zod'
import { PushUpdatesRequestSchema } from '@/gen/actaflow/collaboration/v1/collaboration_pb'
import { falloActa } from '@/lib/actas/errores'
import { desdeTexto } from '@/lib/audiencias/protocolo'
import { clientes, comoPersona, sesionActual } from '@/lib/sesion/sesion'

/**
 * Server Action del borrador colaborativo (la lectura va por el route handler acta/borrador). Los cambios llegan ya cifrados con la clave del caso: el
 * BFF solo valida la forma (Zod y el esquema protobuf) y los reenvia a legal-case.
 */

type Fallo = { ok: false; mensaje: string; definitivo: boolean }
type Resultado<T> = ({ ok: true } & T) | Fallo

const malFormado: Fallo = { ok: false, mensaje: 'El navegador envió datos con un formato inesperado.', definitivo: true }

/** Lo que no se arregla reintentando: el acta se cerro, ya no participas o no puedes editar. */
const DEFINITIVOS = new Set([Code.FailedPrecondition, Code.PermissionDenied, Code.NotFound, Code.InvalidArgument])

async function conSesion<T>(trabajo: (como: ReturnType<typeof comoPersona>) => Promise<Resultado<T>>) {
  const sesion = await sesionActual().catch(() => null)
  if (!sesion) {
    return { ok: false, mensaje: 'Tu sesión venció. Recarga la página para volver a ingresar.', definitivo: false } satisfies Fallo
  }
  try {
    return await trabajo(comoPersona(sesion.tokenAcceso))
  } catch (error) {
    const definitivo = error instanceof ConnectError && DEFINITIVOS.has(error.code)
    return { ...falloActa(error), definitivo } satisfies Fallo
  }
}

export async function enviarBorrador(datos: { peticion: string }) {
  const entrada = z.object({ peticion: z.string().min(1).max(2_000_000) }).safeParse(datos)
  if (!entrada.success) return malFormado
  let peticion
  try {
    peticion = desdeTexto(PushUpdatesRequestSchema, entrada.data.peticion)
  } catch {
    return malFormado
  }
  return conSesion<{ secuencias: number[] }>(async (como) => {
    const r = await clientes().expedientes.colaboracion.pushUpdates(peticion, como)
    return { ok: true, secuencias: r.sequences.map(Number) }
  })
}
