/**
 * Tema claro u oscuro. Codigo puro para poder probarlo; el script inicial se inyecta en <head>
 * para fijar el tema ANTES del primer pintado (sin destello de tema equivocado).
 */
export type Tema = 'light' | 'dark'

export const CLAVE_TEMA = 'actaflow-tema'

/** Preferencia guardada si es valida; si no, la del sistema operativo. */
export function temaInicial(guardado: string | null, sistemaOscuro: boolean): Tema {
  if (guardado === 'light' || guardado === 'dark') {
    return guardado
  }
  return sistemaOscuro ? 'dark' : 'light'
}

export function temaContrario(tema: Tema): Tema {
  return tema === 'dark' ? 'light' : 'dark'
}

/**
 * Script en linea (sin dependencias) que replica `temaInicial`. Si el almacenamiento esta
 * bloqueado (modo privado), cae al tema del sistema sin romper la pagina.
 */
export const SCRIPT_TEMA_INICIAL = `(function(){var g=null;try{g=localStorage.getItem('${CLAVE_TEMA}')}catch(e){}var o=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.theme=g==='light'||g==='dark'?g:(o?'dark':'light')})()`
