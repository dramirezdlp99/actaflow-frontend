import { create } from '@bufbuild/protobuf'
import {
  DiagnosticSeverity,
  EntitySource,
  TemplateDiagnosticSchema,
  TemplateVariableSchema,
  VariableType,
  type TemplateDiagnostic,
  type TemplateValue,
  type TemplateVariable,
} from '@/gen/actaflow/templates/v1/template_pb'

/**
 * Lenguaje de plantillas en TypeScript: la misma sintaxis, diagnosticos, deduccion de variables y
 * HTML que `Lenguaje` y `Documento` de legal-case-service. Lo usan el modo simulado
 * (ACTAFLOW_RPC_MODE=mock) y, desde el bloque FE-7, el NAVEGADOR para llenar el acta sin que ningun
 * servidor vea sus datos (ADR 0004). Puro y sin DOM: corre igual en el servidor y en el navegador.
 */

const FORMATOS = [
  'moneda',
  'moneda_en_letras',
  'fecha',
  'fecha_en_letras',
  'numero',
  'numero_en_letras',
  'mayusculas',
  'minusculas',
]
const RUTA = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$/
const CONDICION = /^(no\s+)?(\S+?)\s*(?:(==|!=|>=|<=|>|<)\s*(-?\d{1,18}|"[^"]*"|verdadero|falso))?$/
const PARA = /^cada\s+(\S+)\s+en\s+(\S+)$/
const NOMBRE = /^[a-z_][a-z0-9_]*$/
const MAX_ANIDAMIENTO = 20

type Condicion = { ruta: string; negada: boolean; operador?: string; literal?: bigint | string | boolean }
export type Nodo =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'valor'; ruta: string; formatos: string[]; linea: number; columna: number }
  | { tipo: 'si'; condicion: Condicion | null; entonces: Nodo[]; sino: Nodo[]; linea: number; columna: number }
  | { tipo: 'para'; variable: string | null; lista: string | null; cuerpo: Nodo[]; linea: number; columna: number }

type Marco = {
  esSi: boolean
  linea: number
  columna: number
  condicion: Condicion | null
  variable: string | null
  lista: string | null
  entonces: Nodo[]
  sino: Nodo[]
  enSino: boolean
}

export type Analisis = { nodos: Nodo[]; diagnosticos: TemplateDiagnostic[]; variables: TemplateVariable[] }

export function analizar(original: string): Analisis {
  const f = original.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  const inicios = [0]
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '\n') inicios.push(i + 1)
  }
  const linea = (pos: number) => {
    let n = 0
    while (n + 1 < inicios.length && (inicios[n + 1] ?? Infinity) <= pos) n++
    return n + 1
  }
  const columna = (pos: number) => pos - (inicios[linea(pos) - 1] ?? 0) + 1
  const diagnosticos: TemplateDiagnostic[] = []
  const decir = (severity: DiagnosticSeverity, pos: number, message: string) =>
    diagnosticos.push(create(TemplateDiagnosticSchema, { severity, line: linea(pos), column: columna(pos), message }))
  const error = (pos: number, m: string) => decir(DiagnosticSeverity.ERROR, pos, m)
  const raiz: Nodo[] = []
  const pila: Marco[] = []
  let texto = ''
  const destino = (): Nodo[] => {
    const arriba = pila.at(-1)
    return arriba ? (arriba.enSino ? arriba.sino : arriba.entonces) : raiz
  }
  const soltar = () => {
    if (texto) destino().push({ tipo: 'texto', texto })
    texto = ''
  }
  const cerrar = (m: Marco): Nodo =>
    m.esSi
      ? { tipo: 'si', condicion: m.condicion, entonces: m.entonces, sino: m.sino, linea: m.linea, columna: m.columna }
      : { tipo: 'para', variable: m.variable, lista: m.lista, cuerpo: m.entonces, linea: m.linea, columna: m.columna }
  const abrir = (pos: number, m: Omit<Marco, 'entonces' | 'sino' | 'enSino' | 'linea' | 'columna'>) => {
    if (pila.length >= MAX_ANIDAMIENTO) error(pos, `Demasiados bloques anidados (máximo ${MAX_ANIDAMIENTO})`)
    pila.push({ ...m, linea: linea(pos), columna: columna(pos), entonces: [], sino: [], enSino: false })
  }
  const vacio = (nodos: Nodo[]) => nodos.every((n) => n.tipo === 'texto' && !n.texto.trim())

  let i = 0
  while (i < f.length) {
    let j = f.indexOf('{', i)
    while (j >= 0 && !'{%#'.includes(f[j + 1] ?? 'x')) j = f.indexOf('{', j + 1)
    if (j < 0 || j + 1 >= f.length) {
      texto += f.slice(i)
      break
    }
    texto += f.slice(i, j)
    const tipo = f[j + 1]
    const cierre = tipo === '{' ? '}}' : tipo === '%' ? '%}' : '#}'
    const k = f.indexOf(cierre, j + 2)
    if (k < 0) {
      const que = tipo === '{' ? 'la variable' : tipo === '%' ? 'la etiqueta' : 'el comentario'
      error(j, `Falta ${cierre} para cerrar ${que} abierta en la línea ${linea(j)}`)
      texto += f.slice(j)
      break
    }
    let fin = k + 2
    if (tipo !== '{') {
      const inicioLinea = f.lastIndexOf('\n', j - 1) + 1
      if (!f.slice(inicioLinea, j).trim()) {
        let e = fin
        while (e < f.length && f[e] !== '\n' && /\s/.test(f[e] ?? '')) e++
        if (e >= f.length || f[e] === '\n') {
          texto = texto.slice(0, texto.length - (j - inicioLinea))
          fin = e < f.length ? e + 1 : e
        }
      }
    }
    soltar()
    const dentro = f.slice(j + 2, k).trim()
    if (tipo === '{') {
      if (!dentro) {
        error(j, 'Variable vacía: escribe un nombre entre {{ y }}')
      } else {
        const [rutaCruda = '', ...resto] = dentro.split('|')
        const ruta = rutaCruda.trim()
        let valida = true
        if (!RUTA.test(ruta)) {
          error(
            j,
            `Nombre de variable no válido: «${ruta}». Usa minúsculas, números y guiones bajos, separados por puntos (por ejemplo acuerdo.monto)`,
          )
          valida = false
        }
        const formatos: string[] = []
        for (const cruda of resto) {
          const formato = cruda.trim()
          if (!formato) {
            error(j, 'Falta el nombre del formato después de |')
            valida = false
          } else if (!FORMATOS.includes(formato)) {
            error(j, `Formato desconocido: «${formato}». Disponibles: ${FORMATOS.join(', ')}`)
            valida = false
          } else {
            formatos.push(formato)
          }
        }
        if (valida) destino().push({ tipo: 'valor', ruta, formatos, linea: linea(j), columna: columna(j) })
      }
    } else if (tipo === '%') {
      const palabra = dentro.split(/\s+/)[0] ?? ''
      const resto = dentro.slice(palabra.length).trim()
      if (!dentro) {
        error(j, 'Etiqueta vacía: usa si, sino, fin o para cada')
      } else if (palabra === 'si') {
        const m = CONDICION.exec(resto)
        let condicion: Condicion | null = null
        if (!resto || !m) {
          error(j, `Condición no válida: «${resto}». Ejemplos: {% si acuerdo.cuotas > 0 %}, {% si no acuerdo.total %}`)
        } else if (!RUTA.test(m[2] ?? '')) {
          error(j, `Nombre de variable no válido en la condición: «${m[2]}»`)
        } else {
          let literal: Condicion['literal']
          const lit = m[4]
          if (lit !== undefined) {
            literal =
              lit === 'verdadero' ? true : lit === 'falso' ? false : lit.startsWith('"') ? lit.slice(1, -1) : BigInt(lit)
            if (typeof literal === 'string' && m[3] !== '==' && m[3] !== '!=') {
              error(j, 'Un texto solo se compara con == o !=')
            }
            if (m[1]) error(j, 'Usa «no» solo sin comparación: {% si no acuerdo.total %}')
          }
          condicion = { ruta: m[2] ?? '', negada: Boolean(m[1]), operador: m[3], literal }
        }
        abrir(j, { esSi: true, condicion, variable: null, lista: null })
      } else if (palabra === 'sino') {
        if (resto) error(j, '{% sino %} no lleva condición; usa otro {% si %} dentro')
        const arriba = pila.at(-1)
        if (!arriba || !arriba.esSi) error(j, '{% sino %} sin un {% si %} abierto')
        else if (arriba.enSino) error(j, 'Este {% si %} ya tiene un {% sino %}')
        else arriba.enSino = true
      } else if (palabra === 'fin') {
        if (resto) error(j, '{% fin %} no lleva nada más')
        const cerrado = pila.pop()
        if (!cerrado) {
          error(j, '{% fin %} sin un bloque abierto')
        } else {
          if (vacio(cerrado.entonces) && vacio(cerrado.sino)) {
            decir(DiagnosticSeverity.WARNING, j, `El bloque abierto en la línea ${cerrado.linea} está vacío`)
          }
          destino().push(cerrar(cerrado))
        }
      } else if (palabra === 'para') {
        const m = PARA.exec(resto)
        let variable: string | null = null
        let lista: string | null = null
        if (!m) error(j, 'Bloque para no válido. Escribe {% para cada cuota en acuerdo.plan %}')
        else if (!NOMBRE.test(m[1] ?? '')) error(j, `Nombre no válido para el elemento: «${m[1]}»`)
        else if (!RUTA.test(m[2] ?? '')) error(j, `Nombre de lista no válido: «${m[2]}»`)
        else {
          variable = m[1] ?? null
          lista = m[2] ?? null
          if (pila.some((p) => p.variable === variable)) {
            decir(DiagnosticSeverity.WARNING, j, `«${variable}» ya nombra el elemento de un para cada exterior`)
          }
        }
        abrir(j, { esSi: false, condicion: null, variable, lista })
      } else {
        error(j, `Etiqueta desconocida: {% ${palabra} %}. Usa si, sino, fin o para cada`)
      }
    }
    i = fin
  }
  soltar()
  for (let abierto = pila.pop(); abierto; abierto = pila.pop()) {
    error(
      (inicios[abierto.linea - 1] ?? 0) + abierto.columna - 1,
      `Falta {% fin %} para el bloque abierto en la línea ${abierto.linea}`,
    )
    destino().push(cerrar(abierto))
  }
  const variables = deducir(raiz, diagnosticos)
  diagnosticos.sort((a, b) => a.line - b.line || a.column - b.column)
  return { nodos: raiz, diagnosticos, variables }
}

// ------------------------------------------------------------------------------------ variables

const fuerte = (t: VariableType) => t !== VariableType.TEXT && t !== VariableType.BOOLEAN
const NOMBRE_TIPO: Partial<Record<VariableType, string>> = {
  [VariableType.MONEY]: 'dinero',
  [VariableType.DATE]: 'fecha',
  [VariableType.INTEGER]: 'número',
  [VariableType.LIST]: 'lista',
  [VariableType.PARTY]: 'parte',
  [VariableType.BOOLEAN]: 'sí o no',
}

function deducir(nodos: Nodo[], diagnosticos: TemplateDiagnostic[]): TemplateVariable[] {
  const tipos = new Map<string, VariableType>()
  const requeridas = new Map<string, boolean>()
  const registrar = (
    ruta: string,
    tipo: VariableType,
    requerida: boolean,
    locales: Set<string>,
    line: number,
    column: number,
  ) => {
    if (locales.has(ruta.split('.')[0] ?? '')) return
    requeridas.set(ruta, (requeridas.get(ruta) ?? false) || requerida)
    const antes = tipos.get(ruta)
    if (antes === undefined || (!fuerte(antes) && (fuerte(tipo) || tipo === VariableType.TEXT))) {
      tipos.set(ruta, tipo)
    } else if (fuerte(antes) && fuerte(tipo) && antes !== tipo) {
      diagnosticos.push(
        create(TemplateDiagnosticSchema, {
          severity: DiagnosticSeverity.WARNING,
          line,
          column,
          message: `«${ruta}» se usa como ${NOMBRE_TIPO[antes] ?? 'texto'} y como ${NOMBRE_TIPO[tipo] ?? 'texto'}`,
        }),
      )
    }
  }
  const visitar = (lista: Nodo[], locales: Set<string>, condicional: boolean) => {
    for (const n of lista) {
      if (n.tipo === 'valor') {
        let tipo = VariableType.TEXT
        for (const f of n.formatos) {
          if (f.startsWith('moneda')) tipo = VariableType.MONEY
          else if (f.startsWith('fecha')) tipo = VariableType.DATE
          else if (f.startsWith('numero')) tipo = VariableType.INTEGER
        }
        registrar(n.ruta, tipo, !condicional, locales, n.linea, n.columna)
      } else if (n.tipo === 'si') {
        if (n.condicion) {
          const l = n.condicion.literal
          const tipo =
            typeof l === 'bigint' ? VariableType.INTEGER : typeof l === 'string' ? VariableType.TEXT : VariableType.BOOLEAN
          registrar(n.condicion.ruta, tipo, false, locales, n.linea, n.columna)
        }
        visitar(n.entonces, locales, true)
        visitar(n.sino, locales, true)
      } else if (n.tipo === 'para') {
        let dentro = locales
        if (n.lista && n.variable) {
          registrar(n.lista, VariableType.LIST, !condicional, locales, n.linea, n.columna)
          dentro = new Set([...locales, n.variable])
        }
        visitar(n.cuerpo, dentro, true)
      }
    }
  }
  visitar(nodos, new Set(), false)
  return [...tipos].map(([path, tipoBase]) => {
    const s = path.split('.')
    const type = tipoBase === VariableType.TEXT && s.length === 2 && s[0] === 'partes' ? VariableType.PARTY : tipoBase
    const ultimo = (s.at(-1) ?? '').replaceAll('_', ' ')
    const mayus = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
    const label = (s.length >= 2 ? `${mayus((s.at(-2) ?? '').replaceAll('_', ' '))}: ${ultimo}` : mayus(ultimo)).slice(
      0,
      120,
    )
    return create(TemplateVariableSchema, {
      path,
      type,
      label,
      required: requeridas.get(path) ?? false,
      source: origen(s, type),
    })
  })
}

function origen(s: string[], tipo: VariableType): EntitySource {
  const todo = s.join('.')
  if (s[0] === 'partes') return EntitySource.PARTY
  if (['caso', 'expediente', 'audiencia'].includes(s[0] ?? '')) return EntitySource.CASE
  if (todo.includes('plazo') || todo.includes('vencimiento')) return EntitySource.DEADLINE
  if (todo.includes('penal') || todo.includes('multa')) return EntitySource.PENALTY
  if (todo.includes('entrega') || todo.includes('compromiso')) return EntitySource.COMMITMENT
  return tipo === VariableType.MONEY ? EntitySource.AMOUNT : EntitySource.UNSPECIFIED
}

// ------------------------------------------------------------------------------------ HTML

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]
const HASTA_29 = [
  '',
  'uno',
  'dos',
  'tres',
  'cuatro',
  'cinco',
  'seis',
  'siete',
  'ocho',
  'nueve',
  'diez',
  'once',
  'doce',
  'trece',
  'catorce',
  'quince',
  'dieciséis',
  'diecisiete',
  'dieciocho',
  'diecinueve',
  'veinte',
  'veintiuno',
  'veintidós',
  'veintitrés',
  'veinticuatro',
  'veinticinco',
  'veintiséis',
  'veintisiete',
  'veintiocho',
  'veintinueve',
]
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const CENTENAS = [
  '',
  'ciento',
  'doscientos',
  'trescientos',
  'cuatrocientos',
  'quinientos',
  'seiscientos',
  'setecientos',
  'ochocientos',
  'novecientos',
]

function cientos(n: number, apocope: boolean): string {
  const c = Math.floor(n / 100)
  const r = n % 100
  if (c === 1 && r === 0) return 'cien'
  let d: string
  if (r < 30) d = apocope && r === 1 ? 'un' : apocope && r === 21 ? 'veintiún' : (HASTA_29[r] ?? '')
  else {
    const u = r % 10
    d = u === 0 ? (DECENAS[r / 10] ?? '') : `${DECENAS[Math.floor(r / 10)]} y ${apocope && u === 1 ? 'un' : HASTA_29[u]}`
  }
  if (c === 0) return d
  return d ? `${CENTENAS[c]} ${d}` : (CENTENAS[c] ?? '')
}

function menorQueMillon(n: number, apocope: boolean): string {
  const miles = Math.floor(n / 1000)
  const resto = n % 1000
  const partes: string[] = []
  if (miles > 0) partes.push(miles === 1 ? 'mil' : `${cientos(miles, true)} mil`)
  if (resto > 0) partes.push(cientos(resto, apocope))
  return partes.join(' ')
}

/** Numero en letras; `apocope` para delante de un sustantivo (veintiun pesos). */
export function enLetras(numero: bigint, apocope = false): string {
  if (numero === 0n) return 'cero'
  if (numero < 0n) return `menos ${enLetras(-numero, apocope)}`
  const billones = numero / 1_000_000_000_000n
  const resto = numero % 1_000_000_000_000n
  const millones = Number(resto / 1_000_000n)
  const unidades = Number(resto % 1_000_000n)
  const partes: string[] = []
  if (billones > 0n) partes.push(billones === 1n ? 'un billón' : `${enLetras(billones, true)} billones`)
  if (millones > 0) partes.push(millones === 1 ? 'un millón' : `${menorQueMillon(millones, true)} millones`)
  if (unidades > 0) partes.push(menorQueMillon(unidades, apocope))
  return partes.join(' ')
}

const agrupar = (n: bigint) => {
  const d = (n < 0n ? -n : n).toString()
  return (n < 0n ? '-' : '') + d.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

type Dinero = { currencyCode: string; units: bigint; nanos: number }

function moneda(m: Dinero): string {
  const negativo = m.units < 0n || m.nanos < 0
  const entero = m.units < 0n ? -m.units : m.units
  const centavos = Math.round(Math.abs(m.nanos) / 10_000_000)
  const pesos = m.currencyCode === 'COP' || m.currencyCode === ''
  const cifra = agrupar(entero) + (centavos !== 0 || !pesos ? `,${String(centavos).padStart(2, '0')}` : '')
  return (negativo ? '-' : '') + (pesos ? `$${cifra}` : `${m.currencyCode} ${cifra}`)
}

function monedaEnLetras(m: Dinero): string {
  const entero = m.units < 0n ? -m.units : m.units
  const centavos = Math.round(Math.abs(m.nanos) / 10_000_000)
  const nombres: Record<string, [string, string]> = {
    '': ['peso', 'pesos'],
    COP: ['peso', 'pesos'],
    USD: ['dólar', 'dólares'],
    EUR: ['euro', 'euros'],
  }
  const [uno, varios] = nombres[m.currencyCode] ?? [m.currencyCode, m.currencyCode]
  const de = entero !== 0n && entero % 1_000_000n === 0n ? ' de ' : ' '
  let texto = `${m.units < 0n ? 'menos ' : ''}${enLetras(entero, true)}${de}${entero === 1n ? uno : varios}`
  if (centavos !== 0) texto += ` con ${enLetras(BigInt(centavos), true)} ${centavos === 1 ? 'centavo' : 'centavos'}`
  return `${texto} (${moneda(m)})`
}

type Fecha = { year: number; month: number; day: number }
const fecha = (d: Fecha) =>
  d.month >= 1 && d.month <= 12
    ? `${d.day} de ${MESES[d.month - 1]} de ${d.year}`
    : `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
const fechaEnLetras = (d: Fecha) =>
  d.month >= 1 && d.month <= 12
    ? `${enLetras(BigInt(d.day))} (${d.day}) de ${MESES[d.month - 1]} de ${enLetras(BigInt(d.year))} (${d.year})`
    : fecha(d)

function dinero(v: TemplateValue): Dinero | null {
  if (v.kind.case === 'money') return v.kind.value
  if (v.kind.case === 'integer') return { currencyCode: 'COP', units: v.kind.value, nanos: 0 }
  return null
}

function mostrar(v: TemplateValue): string {
  switch (v.kind.case) {
    case 'text':
      return v.kind.value
    case 'money':
      return moneda(v.kind.value)
    case 'date':
      return fecha(v.kind.value)
    case 'integer':
      return agrupar(v.kind.value)
    case 'boolean':
      return v.kind.value ? 'sí' : 'no'
    case 'object': {
      const nombre = v.kind.value.fields.nombre
      return nombre?.kind.case === 'text' ? nombre.kind.value : Object.values(v.kind.value.fields).map(mostrar).join(', ')
    }
    case 'list':
      return v.kind.value.items.map(mostrar).join(', ')
    default:
      return ''
  }
}

function formatear(v: TemplateValue, formatos: string[]): string {
  let texto: string | null = null
  for (const f of formatos) {
    const d = dinero(v)
    if (f === 'moneda' && d) texto = moneda(d)
    else if (f === 'moneda_en_letras' && d) texto = monedaEnLetras(d)
    else if (f === 'fecha' && v.kind.case === 'date') texto = fecha(v.kind.value)
    else if (f === 'fecha_en_letras' && v.kind.case === 'date') texto = fechaEnLetras(v.kind.value)
    else if (f === 'numero' && v.kind.case === 'integer') texto = agrupar(v.kind.value)
    else if (f === 'numero_en_letras' && v.kind.case === 'integer')
      texto = `${enLetras(v.kind.value)} (${agrupar(v.kind.value)})`
    else if (f === 'mayusculas') texto = (texto ?? mostrar(v)).toLocaleUpperCase('es-CO')
    else if (f === 'minusculas') texto = (texto ?? mostrar(v)).toLocaleLowerCase('es-CO')
  }
  return texto ?? mostrar(v)
}

function tieneValor(v: TemplateValue): boolean {
  switch (v.kind.case) {
    case 'text':
      return v.kind.value.trim() !== ''
    case 'money':
      return v.kind.value.units !== 0n || v.kind.value.nanos !== 0
    case 'integer':
      return v.kind.value !== 0n
    case 'boolean':
      return v.kind.value
    case 'list':
      return v.kind.value.items.length > 0
    case 'object':
      return Object.keys(v.kind.value.fields).length > 0
    case 'date':
      return true
    default:
      return false
  }
}

const MAX_CARACTERES = 1_000_000
const MARCAS = /[-]/g
const CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g

export function html(nodos: Nodo[], valores: Record<string, TemplateValue>): string {
  let plano = ''
  const agregar = (t: string) => {
    plano += t
    if (plano.length > MAX_CARACTERES) throw new Error('La vista previa es demasiado grande: usa listas más cortas')
  }
  const limpiar = (t: string) => t.replace(MARCAS, '').replace(CONTROL, '')
  const bajar = (v: TemplateValue | undefined, s: string[], desde: number): TemplateValue | undefined => {
    let actual = v
    for (let i = desde; i < s.length && actual; i++) {
      actual = actual.kind.case === 'object' ? actual.kind.value.fields[s[i] ?? ''] : undefined
    }
    return actual
  }
  const buscar = (ruta: string, locales: Map<string, TemplateValue>) => {
    const s = ruta.split('.')
    if (locales.has(s[0] ?? '')) return bajar(locales.get(s[0] ?? ''), s, 1)
    for (let k = s.length; k >= 1; k--) {
      const v = valores[s.slice(0, k).join('.')]
      if (v) return bajar(v, s, k)
    }
    return undefined
  }
  const cumple = (c: Condicion | null, locales: Map<string, TemplateValue>): boolean => {
    if (!c) return false
    const v = buscar(c.ruta, locales)
    if (!c.operador) return c.negada !== (v ? tieneValor(v) : false)
    if (!v) return false
    if (typeof c.literal === 'bigint') {
      const n = v.kind.case === 'integer' ? v.kind.value : v.kind.case === 'money' ? v.kind.value.units : null
      if (n === null) return false
      const r = n === c.literal ? 0 : n > c.literal ? 1 : -1
      return { '==': r === 0, '!=': r !== 0, '>': r > 0, '<': r < 0, '>=': r >= 0 }[c.operador] ?? r <= 0
    }
    if (typeof c.literal === 'string') return v.kind.case === 'text' && (c.operador === '==') === (v.kind.value === c.literal)
    return v.kind.case === 'boolean' && (c.operador === '==') === (v.kind.value === c.literal)
  }
  const escribir = (lista: Nodo[], locales: Map<string, TemplateValue>) => {
    for (const n of lista) {
      if (n.tipo === 'texto') agregar(limpiar(n.texto))
      else if (n.tipo === 'valor') {
        const v = buscar(n.ruta, locales)
        agregar(
          v
            ? `${limpiar(formatear(v, n.formatos)).replaceAll('\n', ' ').replaceAll('*', '')}`
            : `[${n.ruta}]`,
        )
      } else if (n.tipo === 'si') escribir(cumple(n.condicion, locales) ? n.entonces : n.sino, locales)
      else if (n.lista && n.variable) {
        const l = buscar(n.lista, locales)
        if (l?.kind.case === 'list') {
          for (const item of l.kind.value.items) escribir(n.cuerpo, new Map([...locales, [n.variable, item]]))
        }
      }
    }
  }
  escribir(nodos, new Map())
  const escapar = (t: string) =>
    t
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
  const etiqueta = (e: string, t: string) =>
    `<${e}>${escapar(t)
      .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
      .replaceAll('\n', '<br>')
      .replaceAll('', '<span class="valor">')
      .replaceAll('', '</span>')
      .replaceAll('', '<mark class="falta">')
      .replaceAll('', '</mark>')
      .replaceAll('', '*')}</${e}>\n`
  let salida = ''
  for (const bloque of plano.trim().split(/\n[ \t]*\n\s*/)) {
    let b = bloque.trim()
    if (!b) continue
    if (b.startsWith('# ') || b.startsWith('## ')) {
      const salto = b.indexOf('\n')
      const titulo = salto < 0 ? b : b.slice(0, salto)
      const e = titulo.startsWith('## ') ? 'h3' : 'h2'
      salida += etiqueta(e, titulo.slice(e === 'h3' ? 3 : 2).trim())
      b = salto < 0 ? '' : b.slice(salto + 1).trim()
      if (!b) continue
    }
    salida += etiqueta('p', b)
  }
  return salida
}
