/**
 * Guarda la clave privada YA ABIERTA en IndexedDB del navegador, como CryptoKey no exportable:
 * los bloques de expedientes la usaran para abrir las claves de cada caso sin pedir la contrasena
 * en cada pagina. Se borra al cerrar sesion.
 */

const BASE = 'actaflow-claves'
const ALMACEN = 'privadas'

function abrirBase(): Promise<IDBDatabase> {
  return new Promise((resolver, rechazar) => {
    const peticion = indexedDB.open(BASE, 1)
    peticion.onupgradeneeded = () => {
      peticion.result.createObjectStore(ALMACEN)
    }
    peticion.onsuccess = () => resolver(peticion.result)
    peticion.onerror = () => rechazar(peticion.error)
  })
}

async function operar(modo: IDBTransactionMode, accion: (almacen: IDBObjectStore) => IDBRequest): Promise<unknown> {
  const base = await abrirBase()
  try {
    return await new Promise((resolver, rechazar) => {
      const peticion = accion(base.transaction(ALMACEN, modo).objectStore(ALMACEN))
      peticion.onsuccess = () => resolver(peticion.result)
      peticion.onerror = () => rechazar(peticion.error)
    })
  } finally {
    base.close()
  }
}

export async function guardarClavePrivada(cuentaId: string, clave: CryptoKey): Promise<void> {
  await operar('readwrite', (almacen) => almacen.put(clave, cuentaId))
}

export async function leerClavePrivada(cuentaId: string): Promise<CryptoKey | null> {
  const valor = await operar('readonly', (almacen) => almacen.get(cuentaId))
  return valor instanceof CryptoKey ? valor : null
}

/** Cerrar sesion borra todas las claves abiertas de este navegador. Nunca falla. */
export async function borrarClaves(): Promise<void> {
  try {
    await operar('readwrite', (almacen) => almacen.clear())
  } catch (error) {
    console.warn('No se pudieron borrar las claves locales', error)
  }
}
