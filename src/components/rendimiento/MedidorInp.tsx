'use client'

import { useEffect } from 'react'
import { iniciarMedidor } from '@/lib/rendimiento/medidor'

/** Mide el INP en todas las paginas de la app (lo ve /rendimiento). No pinta nada. */
export function MedidorInp() {
  useEffect(() => iniciarMedidor(), [])
  return null
}
