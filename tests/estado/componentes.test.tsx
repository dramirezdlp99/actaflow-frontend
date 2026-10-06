import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TarjetaCapa, etiquetaEstado } from '@/components/estado/TarjetaCapa'
import { VistaEstadoSistema, formatearVerificadoEn } from '@/components/estado/VistaEstadoSistema'
import { vistaDesdeBackend, vistaSinBackend, type Capa } from '@/lib/estado/modelo'
import { respuestaEstadoOk } from '../soporte/datos'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const capaBase: Capa = {
  id: 'motorIa',
  nombre: 'Motor de IA',
  plataforma: 'FastAPI en Render',
  estado: 'OK',
  detalle: 'Modelo de voz tiny listo',
  latenciaMs: 1234,
  version: '0.1.0',
}

describe('TarjetaCapa', () => {
  it('muestra nombre, plataforma, detalle, latencia y version', () => {
    render(
      <ul>
        <TarjetaCapa capa={capaBase} />
      </ul>,
    )
    const tarjeta = screen.getByRole('listitem')
    expect(within(tarjeta).getByRole('heading', { name: 'Motor de IA' })).toBeInTheDocument()
    expect(tarjeta).toHaveTextContent('FastAPI en Render')
    expect(tarjeta).toHaveTextContent('Modelo de voz tiny listo')
    expect(tarjeta).toHaveTextContent('1.234 ms')
    expect(tarjeta).toHaveTextContent('0.1.0')
    expect(tarjeta).toHaveTextContent('Operativo')
  })

  it('comunica el estado con texto y no solo con color', () => {
    for (const estado of ['OK', 'DEGRADADO', 'CAIDO', 'DESCONOCIDO'] as const) {
      const { unmount } = render(
        <ul>
          <TarjetaCapa capa={{ ...capaBase, estado }} />
        </ul>,
      )
      expect(screen.getByRole('listitem')).toHaveTextContent(etiquetaEstado(estado))
      unmount()
    }
  })

  it('omite latencia y version cuando no las hay', () => {
    render(
      <ul>
        <TarjetaCapa capa={{ ...capaBase, latenciaMs: null, version: null }} />
      </ul>,
    )
    expect(screen.queryByText(/Latencia/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Versión/)).not.toBeInTheDocument()
  })
})

describe('VistaEstadoSistema', () => {
  beforeEach(() => {
    refresh.mockClear()
  })

  it('con todo operativo no programa reintentos automaticos', () => {
    vi.useFakeTimers()
    try {
      render(<VistaEstadoSistema vista={vistaDesdeBackend(respuestaEstadoOk(), 100, null)} />)
      expect(screen.getByRole('heading', { name: 'Todas las capas están operativas' })).toBeInTheDocument()
      expect(screen.getAllByRole('listitem')).toHaveLength(4)
      act(() => {
        vi.advanceTimersByTime(60_000)
      })
      expect(refresh).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('si algo falla avisa y vuelve a consultar solo a los 20 segundos', () => {
    vi.useFakeTimers()
    try {
      render(<VistaEstadoSistema vista={vistaSinBackend('No respondio', null, new Date())} />)
      expect(screen.getByRole('heading', { name: 'Hay capas que no están operativas' })).toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('20 segundos')
      act(() => {
        vi.advanceTimersByTime(20_000)
      })
      expect(refresh).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('el boton vuelve a consultar al instante', () => {
    render(<VistaEstadoSistema vista={vistaDesdeBackend(respuestaEstadoOk(), 100, null)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Volver a consultar' }))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('muestra la hora de verificacion en la zona horaria de Colombia', () => {
    expect(formatearVerificadoEn('2026-10-06T15:00:00Z')).toContain('10:00:00')
    expect(formatearVerificadoEn('no-es-fecha')).toBe('no-es-fecha')
  })
})
