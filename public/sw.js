/*
 * ActaFlow · Service Worker (offline-first, caso de estudio 3.2).
 *
 * Intercepta las peticiones GET de este mismo sitio:
 *  - /_next/static/... (JavaScript, CSS, fuentes): primero la cache. Sus nombres llevan un hash, asi
 *    que nunca cambian: una vez guardados sirven para siempre.
 *  - Paginas (navegaciones): primero la red, con tiempo maximo; si no hay red, la ultima copia
 *    guardada; y si nunca se abrio esa pagina, /sin-conexion.
 * No toca lo que no es GET (Server Actions, envio de audio), ni los eventos en vivo, ni /api. Lo que
 * se guarda de un expediente es lo mismo que manda el servidor: metadatos y bytes CIFRADOS (el
 * contenido solo se abre en el navegador con la clave del caso). Cerrar sesion borra estas caches.
 *
 * El borrador del acta editado sin red lo guarda la pagina en IndexedDB; cuando el navegador
 * recupera la red, el evento "sync" (Background Sync, donde exista) avisa a las pestanas abiertas
 * para que envien la bandeja de salida. En los demas navegadores lo hace el evento "online".
 */
const VERSION = 'v1'
const ESTATICOS = `actaflow-estaticos-${VERSION}`
const PAGINAS = `actaflow-paginas-${VERSION}`
const SIN_CONEXION = '/sin-conexion'
const PRECARGA = ['/', '/como-funciona', '/plantillas', '/verificar', SIN_CONEXION, '/icon.svg', '/worklets/captura-audio.js']
const ESPERA_RED_MS = 4000

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    (async () => {
      const cache = await caches.open(PAGINAS)
      // Una por una: si alguna falla (servicio dormido), las demas igual quedan.
      await Promise.all(PRECARGA.map((url) => cache.add(url).catch(() => undefined)))
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    (async () => {
      for (const nombre of await caches.keys()) {
        if (nombre.startsWith('actaflow-') && nombre !== ESTATICOS && nombre !== PAGINAS) await caches.delete(nombre)
      }
      await self.clients.claim()
    })(),
  )
})

function guardable(respuesta) {
  return respuesta && respuesta.ok && respuesta.type === 'basic' && !respuesta.redirected
}

async function primeroCache(peticion) {
  const cache = await caches.open(ESTATICOS)
  const guardada = await cache.match(peticion)
  if (guardada) return guardada
  const respuesta = await fetch(peticion)
  if (guardable(respuesta)) await cache.put(peticion, respuesta.clone())
  return respuesta
}

async function primeroRed(peticion) {
  const cache = await caches.open(PAGINAS)
  try {
    const respuesta = await Promise.race([
      fetch(peticion),
      new Promise((_, rechazar) => setTimeout(() => rechazar(new Error('lenta')), ESPERA_RED_MS)),
    ])
    if (guardable(respuesta)) await cache.put(peticion, respuesta.clone())
    return respuesta
  } catch {
    const url = new URL(peticion.url)
    const guardada = (await cache.match(peticion, { ignoreSearch: false })) ?? (await cache.match(url.pathname))
    return guardada ?? (await cache.match(SIN_CONEXION)) ?? Response.error()
  }
}

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request
  if (peticion.method !== 'GET') return
  const url = new URL(peticion.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.endsWith('/audiencia/eventos')) return
  // Los scripts de Workers no se tocan: Turbopack les pasa su configuracion en el fragmento (#) de la
  // URL, y una respuesta servida desde aqui lo pierde. Sin red, la pagina usa su respaldo en el hilo
  // principal (ClientePlantillas).
  if (peticion.destination === 'worker' || peticion.destination === 'sharedworker') return
  if (url.pathname.startsWith('/_next/static/')) {
    evento.respondWith(primeroCache(peticion))
    return
  }
  if (peticion.mode === 'navigate') {
    evento.respondWith(primeroRed(peticion))
  }
})

self.addEventListener('sync', (evento) => {
  if (evento.tag !== 'actaflow-borrador') return
  evento.waitUntil(
    (async () => {
      for (const cliente of await self.clients.matchAll({ type: 'window' })) {
        cliente.postMessage({ tipo: 'sincronizar' })
      }
    })(),
  )
})
