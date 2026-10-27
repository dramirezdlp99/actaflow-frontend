import type { Bandeja } from './borrador'

/**
 * La bandeja de salida del borrador en IndexedDB: sobrevive a recargar la pagina y a cerrar el
 * navegador sin conexion. Todo lo que se guarda va cifrado con la clave del caso. Cerrar sesion la
 * borra (borrarDatosSinConexion).
 */

const BASE = 'actaflow-sin-conexion'
const FOTOS = 'fotos'
const SALIDA = 'salida'

type Registro = { clave: string; actaId: string; creado: number; cambio: Uint8Array }

function esRegistro(x: unknown): x is Registro {
  return typeof x === 'object' && x !== null && 'cambio' in x && x.cambio instanceof Uint8Array && 'creado' in x
}

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolver, rechazar) => {
    const p = indexedDB.open(BASE, 1)
    p.onupgradeneeded = () => {
      p.result.createObjectStore(FOTOS)
      p.result.createObjectStore(SALIDA, { keyPath: 'clave' })
    }
    p.onsuccess = () => resolver(p.result)
    p.onerror = () => rechazar(p.error)
  })
}

async function operar<T>(almacen: string, modo: IDBTransactionMode, accion: (a: IDBObjectStore) => IDBRequest<T>) {
  const base = await abrir()
  try {
    return await new Promise<T>((resolver, rechazar) => {
      const p = accion(base.transaction(almacen, modo).objectStore(almacen))
      p.onsuccess = () => resolver(p.result)
      p.onerror = () => rechazar(p.error)
    })
  } finally {
    base.close()
  }
}

const rango = (actaId: string) => IDBKeyRange.bound(`${actaId}|`, `${actaId}|￿`)

export class BandejaIndexada implements Bandeja {
  async leerFoto(actaId: string) {
    const v: unknown = await operar(FOTOS, 'readonly', (a) => a.get(actaId))
    return v instanceof Uint8Array ? v : null
  }

  async guardarFoto(actaId: string, foto: Uint8Array) {
    await operar(FOTOS, 'readwrite', (a) => a.put(foto, actaId))
  }

  async pendientes(actaId: string) {
    const todos: unknown[] = await operar(SALIDA, 'readonly', (a) => a.getAll(rango(actaId)))
    return todos
      .filter(esRegistro)
      .sort((x, y) => x.creado - y.creado)
      .map((r) => r.cambio)
  }

  async agregar(actaId: string, updateId: string, cambio: Uint8Array) {
    const registro: Registro = { clave: `${actaId}|${updateId}`, actaId, creado: Date.now(), cambio }
    await operar(SALIDA, 'readwrite', (a) => a.put(registro))
  }

  async quitar(actaId: string, updateIds: string[]) {
    for (const id of updateIds) {
      await operar(SALIDA, 'readwrite', (a) => a.delete(`${actaId}|${id}`))
    }
  }
}

/** Cerrar sesion: se borran los borradores guardados y las paginas que guardo el Service Worker. */
export async function borrarDatosSinConexion(): Promise<void> {
  try {
    await new Promise<void>((resolver) => {
      const p = indexedDB.deleteDatabase(BASE)
      p.onsuccess = p.onerror = p.onblocked = () => resolver()
    })
    if ('caches' in globalThis) {
      for (const nombre of await caches.keys()) {
        if (nombre.startsWith('actaflow-')) await caches.delete(nombre)
      }
    }
  } catch (error) {
    console.warn('No se pudieron borrar los datos sin conexion', error)
  }
}
