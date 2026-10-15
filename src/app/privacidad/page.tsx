import type { Metadata } from 'next'
import { DocumentoLegal, type Clausula } from '@/components/legal/DocumentoLegal'

export const metadata: Metadata = { title: 'Privacidad' }

// SSG: texto identico para todos, generado en el build.
export const dynamic = 'force-static'

const CLAUSULAS: Clausula[] = [
  {
    titulo: 'Qué datos se tratan hoy',
    parrafos: [
      'En esta etapa ActaFlow no tiene cuentas de usuario ni recoge datos personales. La página de estado solo consulta si los servicios responden.',
      'Tu preferencia de modo claro u oscuro se guarda únicamente en tu navegador.',
    ],
  },
  {
    titulo: 'Cómo se protegerá la información de las audiencias',
    parrafos: [
      'Los borradores, anexos y audios se cifrarán en tu propio equipo antes de viajar a la nube, con llaves que el servidor no conoce, para resguardar el secreto profesional.',
      'Entre los servicios, cada llamada va firmada con un secreto distinto por pareja de servicios y todas las conexiones públicas usan HTTPS.',
    ],
  },
  {
    titulo: 'Inteligencia artificial sin terceros',
    parrafos: [
      'La transcripción y la extracción de datos corren en modelos propios y gratuitos dentro de la plataforma. Ningún audio ni texto se envía a servicios de IA de terceros.',
    ],
  },
  {
    titulo: 'Tus derechos',
    parrafos: [
      'Cuando existan cuentas, podrás consultar, corregir y eliminar tu información conforme a la Ley 1581 de 2012 de protección de datos personales de Colombia.',
    ],
  },
]

export default function Privacidad() {
  return (
    <DocumentoLegal
      rotulo="Privacidad"
      titulo="Cómo cuidamos la información"
      vigencia="Versión académica, vigente mientras el proyecto esté en construcción."
      clausulas={CLAUSULAS}
    />
  )
}
