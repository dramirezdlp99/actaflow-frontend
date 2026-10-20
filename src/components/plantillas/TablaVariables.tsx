import { ORIGEN, TIPO_VARIABLE } from '@/lib/plantillas/etiquetas'
import type { VistaVariable } from '@/lib/plantillas/servidor'

/** Variables que espera la plantilla: ruta, tipo, de donde suele salir y si es obligatoria. */
export function TablaVariables({ variables }: { variables: VistaVariable[] }) {
  if (variables.length === 0) {
    return <p className="text-sm text-tinta-suave">Esta plantilla no usa variables.</p>
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-linea">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <caption className="sr-only">Variables de la plantilla</caption>
        <thead className="bg-papel-hondo text-xs uppercase tracking-wider text-tinta-suave">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-semibold">
              Variable
            </th>
            <th scope="col" className="px-4 py-2.5 font-semibold">
              Tipo
            </th>
            <th scope="col" className="px-4 py-2.5 font-semibold">
              Origen habitual
            </th>
            <th scope="col" className="px-4 py-2.5 font-semibold">
              Obligatoria
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-linea bg-superficie">
          {variables.map((v) => (
            <tr key={v.ruta}>
              <td className="px-4 py-2.5">
                <code className="font-mono text-[0.8rem] text-institucional">{v.ruta}</code>
                <span className="block text-xs text-tinta-suave">{v.etiqueta}</span>
              </td>
              <td className="px-4 py-2.5">{TIPO_VARIABLE[v.tipo]}</td>
              <td className="px-4 py-2.5 text-tinta-suave">{ORIGEN[v.origen]}</td>
              <td className="px-4 py-2.5">{v.requerida ? 'Sí' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
