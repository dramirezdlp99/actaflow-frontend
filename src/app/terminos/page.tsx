import type { Metadata } from 'next'
import { DocumentoLegal, type Clausula } from '@/components/legal/DocumentoLegal'

export const metadata: Metadata = { title: 'Términos de uso' }

// SSG: texto identico para todos, generado en el build.
export const dynamic = 'force-static'

const CLAUSULAS: Clausula[] = [
  {
    titulo: 'Naturaleza del proyecto',
    parrafos: [
      'ActaFlow es un proyecto académico de Ingeniería de Software. No es un servicio comercial ni ofrece asesoría jurídica.',
    ],
  },
  {
    titulo: 'Uso permitido',
    parrafos: [
      'Puedes explorar la plataforma con fines de evaluación y aprendizaje. No cargues audios, documentos ni datos de personas o procesos reales.',
    ],
  },
  {
    titulo: 'Lo que produce la inteligencia artificial',
    parrafos: [
      'Las transcripciones y los datos extraídos por la IA son propuestas que una persona debe revisar. Se marcan en violeta precisamente para que nada se firme sin confirmación humana.',
    ],
  },
  {
    titulo: 'Disponibilidad',
    parrafos: [
      'Los servicios corren en planes gratuitos que se suspenden tras un tiempo sin uso; la primera consulta puede tardar cerca de un minuto mientras despiertan. No hay garantía de disponibilidad.',
    ],
  },
  {
    titulo: 'Cambios',
    parrafos: ['Estos términos pueden cambiar mientras el proyecto avanza. La versión vigente es siempre la publicada aquí.'],
  },
]

export default function Terminos() {
  return (
    <DocumentoLegal
      rotulo="Términos de uso"
      titulo="Condiciones para usar ActaFlow"
      vigencia="Versión académica del proyecto."
      clausulas={CLAUSULAS}
    />
  )
}
