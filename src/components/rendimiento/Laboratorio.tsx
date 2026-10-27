'use client'

import { Activity, Cpu, Gauge, Lock, RotateCcw, Unlock, Workflow } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  bloquearHasta,
  CANAL_DESBLOQUEO,
  contarPrimos,
  crearBandera,
  type Liberado,
  type MensajeDelBloqueo,
} from '@/lib/rendimiento/bloqueo'
import { recorrerEventLoop, type Clase, type Paso } from '@/lib/rendimiento/eventLoop'
import { calificar, inp, UMBRAL_BUENO, UMBRAL_POBRE, type Calificacion, type Interaccion } from '@/lib/rendimiento/inp'
import {
  eventTimingSoportado,
  interaccionesMedidas,
  interaccionesServidor,
  reiniciarMedidor,
  suscribirMedidor,
} from '@/lib/rendimiento/medidor'

const CAJA = 'rounded-2xl border border-linea bg-superficie p-6 shadow-suave'
const PRIMARIO =
  'inline-flex items-center gap-2 rounded-lg bg-institucional px-4 py-2 text-sm font-semibold text-sobre-institucional shadow-suave transition hover:brightness-110 disabled:opacity-60'
const SECUNDARIO =
  'inline-flex items-center gap-2 rounded-lg border border-linea bg-superficie px-4 py-2 text-sm font-medium transition hover:border-institucional disabled:opacity-60'

const RUTA_LAB = '/rendimiento'
const PRIMOS_HASTA = 25_000_000

const COLOR_CLASE: Record<Clase, string> = {
  sincrono: 'bg-institucional-suave text-institucional',
  microtask: 'bg-ia-suave text-ia',
  task: 'bg-lacre-suave text-lacre',
  animacion: 'bg-exito/10 text-exito',
}
const NOMBRE_CLASE: Record<Clase, string> = {
  sincrono: 'Pila (síncrono)',
  microtask: 'Microtask',
  task: 'Task',
  animacion: 'Animación',
}
const COLOR_CALIFICACION: Record<Calificacion, string> = {
  bueno: 'text-exito',
  mejorable: 'text-alerta',
  pobre: 'text-error',
}
const TEXTO_CALIFICACION: Record<Calificacion, string> = {
  bueno: 'Bueno (< 200 ms)',
  mejorable: 'Necesita mejorar (200 – 500 ms)',
  pobre: 'Pobre (> 500 ms)',
}
const LIBERADO: Record<Liberado, string> = {
  'otra-pestana': 'otra pestaña (BroadcastChannel → Web Worker → Atomics.store)',
  automatico: 'el Web Worker, solo, al vencer su temporizador (Atomics.store)',
  tope: 'el tope de seguridad de 30 s',
}

const ms = (n: number) => `${Math.round(n)} ms`

function Cifra({ titulo, valor, nota }: { titulo: string; valor: number | null; nota: string }) {
  const c = valor === null ? null : calificar(valor)
  return (
    <div className="rounded-xl border border-linea bg-papel p-4">
      <p className="text-xs text-tinta-suave">{titulo}</p>
      <p className={`mt-1 font-mono text-3xl font-semibold ${c ? COLOR_CALIFICACION[c] : ''}`}>
        {valor === null ? '—' : ms(valor)}
      </p>
      <p className="mt-1 text-xs text-tinta-suave">{c ? TEXTO_CALIFICACION[c] : nota}</p>
    </div>
  )
}

export function Laboratorio() {
  // ------------------------------------------------------------ pulso del hilo principal
  const [cuadros, setCuadros] = useState(0)
  useEffect(() => {
    let vivo = true
    const latir = () => {
      if (!vivo) return
      setCuadros((n) => n + 1)
      requestAnimationFrame(latir)
    }
    requestAnimationFrame(latir)
    return () => {
      vivo = false
    }
  }, [])

  // ------------------------------------------------------------ worker del experimento
  const hilo = useRef<Worker | null>(null)
  const bandera = useRef<Int32Array<SharedArrayBuffer> | null>(null)
  const [aislado, setAislado] = useState<boolean | null>(null)
  const [enWorker, setEnWorker] = useState<{ cantidad: number; ms: number } | null>(null)
  useEffect(() => {
    const w = new Worker(new URL('../../workers/bloqueo.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<MensajeDelBloqueo>) => {
      if (e.data.tipo === 'primos') setEnWorker({ cantidad: e.data.cantidad, ms: e.data.ms })
    }
    const puede = globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined'
    if (puede) {
      const b = crearBandera()
      bandera.current = b
      w.postMessage({ tipo: 'preparar', memoria: b.buffer })
    }
    hilo.current = w
    queueMicrotask(() => setAislado(puede))
    return () => w.terminate()
  }, [])

  // ------------------------------------------------------------ event loop
  const [pasos, setPasos] = useState<Paso[]>([])
  async function recorrer() {
    setPasos([])
    setPasos(await recorrerEventLoop())
  }

  // ------------------------------------------------------------ bloquear y desbloquear
  const [modo, setModo] = useState<'otra-pestana' | 'automatico'>('otra-pestana')
  const [bloqueo, setBloqueo] = useState<{ ms: number; por: Liberado } | null>(null)
  const [preparando, setPreparando] = useState(false)
  function bloquear() {
    const b = bandera.current
    if (!b) return
    setBloqueo(null)
    setPreparando(true)
    if (modo === 'automatico') hilo.current?.postMessage({ tipo: 'auto', ms: 5_000 })
    // Se deja pintar el aviso y despues se bloquea el hilo de verdad.
    setTimeout(() => {
      const r = bloquearHasta(b, () => performance.now(), undefined, () => {
        // Trabajo de relleno: el hilo esta ocupado de verdad, no esperando.
        Math.sqrt(Math.random())
      })
      setPreparando(false)
      setBloqueo(r)
    }, 60)
  }
  function desbloquearOtra() {
    const canal = new BroadcastChannel(CANAL_DESBLOQUEO)
    canal.postMessage('desbloquear')
    canal.close()
  }

  // ------------------------------------------------------------ mismo trabajo, dos hilos
  const [enPrincipal, setEnPrincipal] = useState<{ cantidad: number; ms: number } | null>(null)
  function calcularAqui() {
    const inicio = performance.now()
    const cantidad = contarPrimos(PRIMOS_HASTA)
    setEnPrincipal({ cantidad, ms: performance.now() - inicio })
  }
  function calcularEnWorker() {
    setEnWorker(null)
    hilo.current?.postMessage({ tipo: 'primos', hasta: PRIMOS_HASTA })
  }

  // ------------------------------------------------------------ INP
  const interacciones = useSyncExternalStore(suscribirMedidor, interaccionesMedidas, interaccionesServidor)
  const soportado = useSyncExternalStore(
    () => () => {},
    eventTimingSoportado,
    () => true,
  )
  const app = useMemo(() => interacciones.filter((i) => i.ruta !== RUTA_LAB), [interacciones])
  const lab = useMemo(() => interacciones.filter((i) => i.ruta === RUTA_LAB), [interacciones])
  const porRuta = useMemo(() => {
    const m = new Map<string, Interaccion[]>()
    for (const i of app) m.set(i.ruta, [...(m.get(i.ruta) ?? []), i])
    return [...m.entries()].map(([ruta, lista]) => ({ ruta, inp: inp(lista), n: lista.length }))
  }, [app])

  return (
    <div className="grid gap-8">
      {/* ---------------------------------------------------- pulso */}
      <section aria-labelledby="titulo-pulso" className={CAJA}>
        <h2 id="titulo-pulso" className="titular flex items-center gap-2 text-2xl">
          <Activity aria-hidden className="size-5 text-institucional" /> Los hilos del navegador, en vivo
        </h2>
        <p className="mt-2 text-sm text-tinta-suave">
          El hilo principal ejecuta JavaScript, calcula estilos y layout y genera los comandos de pintado. El hilo
          compositor mueve capas (scroll y animaciones con <code className="font-mono">transform</code>) aunque el
          principal esté ocupado, y la GPU convierte esas capas en píxeles. Bloquea el hilo más abajo y mira la
          diferencia:
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-linea bg-papel p-4">
            <p className="text-xs text-tinta-suave">Animación CSS (hilo compositor)</p>
            <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-papel-hondo">
              <span className="pulso-compositor absolute inset-y-0 left-0 w-1/4 rounded-full bg-exito" />
            </div>
            <p className="mt-2 text-xs text-tinta-suave">Sigue moviéndose aunque el hilo principal esté bloqueado.</p>
          </div>
          <div className="rounded-xl border border-linea bg-papel p-4">
            <p className="text-xs text-tinta-suave">Contador de JavaScript (hilo principal, un cuadro por frame)</p>
            <p className="mt-1 font-mono text-3xl font-semibold" data-cuadros={cuadros}>
              {cuadros}
            </p>
            <p className="mt-1 text-xs text-tinta-suave">Se congela mientras el hilo principal está bloqueado.</p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- event loop */}
      <section aria-labelledby="titulo-loop" className={CAJA}>
        <h2 id="titulo-loop" className="titular flex items-center gap-2 text-2xl">
          <Workflow aria-hidden className="size-5 text-institucional" /> Event Loop: tasks y microtasks
        </h2>
        <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <div className="text-sm text-tinta-suave">
            <p>Piensa en un restaurante:</p>
            <ol className="mt-2 grid gap-1 pl-5 [list-style:decimal]">
              <li>
                <strong>Call stack</strong>: el cocinero que ejecuta el código.
              </li>
              <li>
                <strong>Task queue</strong>: los pedidos normales (setTimeout, eventos, mensajes).
              </li>
              <li>
                <strong>Microtask queue</strong>: los pedidos prioritarios (promesas, queueMicrotask).
              </li>
              <li>
                <strong>Event Loop</strong>: el encargado que decide qué pedido entra a la cocina.
              </li>
            </ol>
            <p className="mt-3">
              La regla: cuando la pila queda vacía, se atienden <strong>todas</strong> las microtasks y recién después
              la siguiente task. Pasa igual en React, Angular o Next: todos corren sobre este mismo Event Loop.
            </p>
            <button type="button" className={`${PRIMARIO} mt-4`} onClick={() => void recorrer()}>
              Recorrer el Event Loop
            </button>
          </div>
          <ol aria-label="Orden real de ejecución" className="grid content-start gap-1.5">
            {pasos.length === 0 ? (
              <li className="text-sm text-tinta-suave">
                Pulsa el botón: el código programa trabajos de cada tipo y aquí sale el orden en que de verdad corren.
              </li>
            ) : (
              pasos.map((p) => (
                <li key={p.orden} className="flex items-start gap-2 text-sm" data-clase={p.clase}>
                  <span className="w-6 shrink-0 text-right font-mono text-tinta-suave">{p.orden}</span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${COLOR_CLASE[p.clase]}`}>
                    {NOMBRE_CLASE[p.clase]}
                  </span>
                  <span>{p.texto}</span>
                </li>
              ))
            )}
          </ol>
        </div>
      </section>

      {/* ---------------------------------------------------- bloquear y desbloquear */}
      <section aria-labelledby="titulo-bloqueo" className={CAJA} data-experimento>
        <h2 id="titulo-bloqueo" className="titular flex items-center gap-2 text-2xl">
          <Lock aria-hidden className="size-5 text-lacre" /> Bloquear el hilo principal y desbloquearlo desde otro hilo
        </h2>
        <p className="mt-2 text-sm text-tinta-suave">
          El botón deja el hilo principal atrapado en un ciclo: no se pinta nada y ningún clic responde. Lo libera
          un <strong>Web Worker</strong> escribiendo en una <strong>memoria compartida</strong> (SharedArrayBuffer +
          Atomics) que el ciclo consulta. El Worker lo hace cuando le llega una petición: desde{' '}
          <strong>otra pestaña</strong> (BroadcastChannel) o sola, a los 5 s. Sin cerrar la pestaña ni el navegador.
        </p>
        {aislado === false ? (
          <p className="mt-3 text-sm text-error">
            Esta página no está en crossOriginIsolated: el navegador no permite SharedArrayBuffer aquí.
          </p>
        ) : null}
        <fieldset className="mt-4 flex flex-wrap gap-4 text-sm">
          <legend className="sr-only">Quién desbloquea</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="modo" checked={modo === 'otra-pestana'} onChange={() => setModo('otra-pestana')} />
            Otra pestaña
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="modo" checked={modo === 'automatico'} onChange={() => setModo('automatico')} />
            El Worker solo, a los 5 s
          </label>
        </fieldset>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" className={PRIMARIO} disabled={!aislado || preparando} onClick={bloquear}>
            <Lock aria-hidden className="size-4" /> {preparando ? 'Bloqueado…' : 'Bloquear el hilo principal'}
          </button>
          <button type="button" className={SECUNDARIO} onClick={desbloquearOtra}>
            <Unlock aria-hidden className="size-4" /> Desbloquear la otra pestaña
          </button>
          <a className="text-sm font-medium text-institucional underline" href={RUTA_LAB} target="_blank" rel="noopener">
            Abrir esta página en otra pestaña
          </a>
        </div>
        {modo === 'otra-pestana' ? (
          <p className="mt-3 text-xs text-tinta-suave">
            Abre esta página en otra pestaña. Aquí pulsa <strong>Bloquear</strong>; en la otra, <strong>Desbloquear la
            otra pestaña</strong>. Al volver, esta reanuda donde quedó.
          </p>
        ) : null}
        {bloqueo ? (
          <p className="mt-4 rounded-xl bg-papel-hondo p-4 text-sm" role="status" data-liberado={bloqueo.por}>
            El hilo principal estuvo bloqueado <strong>{(bloqueo.ms / 1000).toFixed(1)} s</strong>. Lo liberó{' '}
            {LIBERADO[bloqueo.por]}. Mientras tanto, el contador se congeló y la animación CSS siguió.
          </p>
        ) : null}
      </section>

      {/* ---------------------------------------------------- dos hilos */}
      <section aria-labelledby="titulo-workers" className={CAJA}>
        <h2 id="titulo-workers" className="titular flex items-center gap-2 text-2xl">
          <Cpu aria-hidden className="size-5 text-institucional" /> El mismo trabajo, en dos hilos
        </h2>
        <p className="mt-2 text-sm text-tinta-suave">
          Contar los primos hasta {PRIMOS_HASTA.toLocaleString('es-CO')} (criba de Eratóstenes). En el hilo principal
          la página se congela mientras calcula; en un Web Worker la interfaz sigue respondiendo y el resultado llega
          por <code className="font-mono">postMessage</code>. Un Worker no toca el DOM: solo calcula y responde.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-linea bg-papel p-4">
            <button type="button" className={SECUNDARIO} onClick={calcularAqui}>
              En el hilo principal
            </button>
            <p className="mt-3 text-sm" data-resultado="principal">
              {enPrincipal
                ? `${enPrincipal.cantidad.toLocaleString('es-CO')} primos en ${ms(enPrincipal.ms)}, con la página congelada.`
                : 'Pulsa y mira cómo se congela el contador.'}
            </p>
          </div>
          <div className="rounded-xl border border-linea bg-papel p-4">
            <button type="button" className={PRIMARIO} onClick={calcularEnWorker}>
              En un Web Worker
            </button>
            <p className="mt-3 text-sm" data-resultado="worker">
              {enWorker
                ? `${enWorker.cantidad.toLocaleString('es-CO')} primos en ${ms(enWorker.ms)}, sin congelar nada.`
                : 'Pulsa y mira cómo el contador sigue.'}
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs text-tinta-suave">
          En ActaFlow, así trabajan: el audio y su cifrado (Web Worker + AudioWorklet + SharedArrayBuffer), el
          armado del acta (Web Worker), los eventos en vivo para todas las pestañas (Shared Worker) y el modo sin
          conexión (Service Worker). postMessage <em>copia</em> o transfiere los datos entre hilos; SharedArrayBuffer
          deja que dos hilos lean y escriban la <em>misma</em> memoria, y por eso el navegador exige
          crossOriginIsolated: {aislado === null ? '…' : aislado ? 'sí, esta página lo está' : 'esta página no lo está'}.
        </p>
      </section>

      {/* ---------------------------------------------------- INP */}
      <section aria-labelledby="titulo-inp" className={CAJA}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="titulo-inp" className="titular flex items-center gap-2 text-2xl">
            <Gauge aria-hidden className="size-5 text-institucional" /> INP de ActaFlow, medido en tu navegador
          </h2>
          <button type="button" className={SECUNDARIO} onClick={reiniciarMedidor}>
            <RotateCcw aria-hidden className="size-4" /> Reiniciar medición
          </button>
        </div>
        <p className="mt-2 text-sm text-tinta-suave">
          <strong>INP = input delay + processing + presentation</strong>. Cada clic o tecla en cualquier página de
          ActaFlow (con Event Timing, en Chrome y Edge) se mide y se guarda en esta sesión. Reemplazó a FID, que solo
          medía la espera de la primera interacción: INP mira todas y el ciclo completo hasta el siguiente pintado. La
          meta es <strong>menos de {UMBRAL_BUENO} ms</strong>; más de {UMBRAL_POBRE} ms se siente como pantalla
          congelada.
        </p>
        {!soportado ? (
          <p className="mt-3 text-sm text-alerta">Este navegador no expone Event Timing: abre la página en Chrome o Edge.</p>
        ) : null}
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Cifra titulo="INP de la app (todas las páginas menos este laboratorio)" valor={inp(app)} nota="Navega e interactúa por la app" />
          <Cifra titulo="INP de este laboratorio (con los bloqueos a propósito)" valor={inp(lab)} nota="Aún sin interacciones aquí" />
          <div className="rounded-xl border border-linea bg-papel p-4 text-sm">
            <p className="text-xs text-tinta-suave">Por página</p>
            <ul className="mt-2 grid gap-1">
              {porRuta.length === 0 ? <li className="text-tinta-suave">—</li> : null}
              {porRuta.map((r) => (
                <li key={r.ruta} className="flex justify-between gap-2">
                  <span className="truncate font-mono text-xs">{r.ruta}</span>
                  <span className={`font-mono text-xs ${r.inp === null ? '' : COLOR_CALIFICACION[calificar(r.inp)]}`}>
                    {r.inp === null ? '—' : ms(r.inp)} · {r.n}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mt-5 overflow-x-auto rounded-xl border border-linea">
          <table className="w-full min-w-[40rem] text-left text-xs">
            <caption className="sr-only">Últimas interacciones medidas con sus tres fases</caption>
            <thead className="bg-papel-hondo/60">
              <tr>
                {['Página', 'Elemento', 'Input delay', 'Processing', 'Presentation', 'Total'].map((t) => (
                  <th key={t} scope="col" className="px-3 py-2 font-semibold">
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {interacciones.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-3 text-tinta-suave">
                    Todavía no hay interacciones medidas en esta sesión.
                  </td>
                </tr>
              ) : null}
              {interacciones
                .slice(-15)
                .reverse()
                .map((i) => (
                  <tr key={`${i.ruta}-${i.id}-${i.inicio}`} className="border-t border-linea/70">
                    <td className="px-3 py-2 font-mono">{i.ruta}</td>
                    <td className="max-w-[14rem] truncate px-3 py-2">{i.objetivo}</td>
                    <td className="px-3 py-2 font-mono">{ms(i.retraso)}</td>
                    <td className="px-3 py-2 font-mono">{ms(i.procesamiento)}</td>
                    <td className="px-3 py-2 font-mono">{ms(i.presentacion)}</td>
                    <td className={`px-3 py-2 font-mono font-semibold ${COLOR_CALIFICACION[calificar(i.total)]}`}>
                      {ms(i.total)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
