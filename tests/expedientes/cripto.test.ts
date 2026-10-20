// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { abrirConContrasena, crearKit, derivarClaves } from '@/lib/cripto/claves'
import { cifrarDetalles, descifrarDetalles, desenvolverClave, envolverClave, nuevaClaveCaso } from '@/lib/cripto/casos'
import {
  blobATexto,
  envolturaATexto,
  esquemaBlob,
  esquemaEnvoltura,
  textoABlob,
  textoAEnvoltura,
} from '@/lib/expedientes/formato'

const SAL = new Uint8Array(16).fill(3)

/** Una cuenta como la del navegador: par P-256, privada no exportable tras abrir el kit. */
async function cuenta(contrasena: string) {
  const { kek } = await derivarClaves(contrasena, SAL, 1_000)
  const kit = await crearKit(kek)
  const privada = await abrirConContrasena(kek, kit.porContrasena)
  return { idClave: kit.idClavePublica, publica: kit.clavePublica, privada }
}

describe('cifrado de un expediente', () => {
  it('los detalles se cifran con la clave del caso y solo esa clave los abre', async () => {
    const { clave, idClave } = await nuevaClaveCaso()
    const blob = await cifrarDetalles(clave, idClave, { titulo: 'Arrendamiento calle 18', resumen: 'Mora de 3 meses' })
    expect(blob.tipo).toBe('actaflow.cases.v1.CaseDetails')
    expect(blob.nonce).toHaveLength(12)
    expect(new TextDecoder().decode(blob.cifrado)).not.toContain('Arrendamiento')
    expect(await descifrarDetalles(clave, blob)).toEqual({
      titulo: 'Arrendamiento calle 18',
      resumen: 'Mora de 3 meses',
    })

    const otra = await nuevaClaveCaso()
    await expect(descifrarDetalles(otra.clave, blob)).rejects.toThrow()
    await expect(descifrarDetalles(clave, { ...blob, idClave: 'otro' })).rejects.toThrow()
  })

  it('la envoltura cumple el contrato WrappedKey y solo la abre su destinatario', async () => {
    const ana = await cuenta('una frase de ana bastante larga')
    const beto = await cuenta('una frase de beto bastante larga')
    const { clave, idClave } = await nuevaClaveCaso()
    const blob = await cifrarDetalles(clave, idClave, { titulo: 'Caso de prueba', resumen: '' })

    const paraAna = await envolverClave(clave, { idClave: ana.idClave, publica: ana.publica })
    expect(paraAna.efimera).toHaveLength(65)
    expect(paraAna.efimera[0]).toBe(0x04)
    expect(paraAna.nonce).toHaveLength(12)
    expect(paraAna.envuelta).toHaveLength(48)
    expect(paraAna.idDestinatario).toBe(ana.idClave)

    const deAna = await desenvolverClave(ana.privada, paraAna)
    expect((await descifrarDetalles(deAna, blob)).titulo).toBe('Caso de prueba')
    await expect(desenvolverClave(beto.privada, paraAna)).rejects.toThrow()
    // El destinatario va autenticado: no se puede reetiquetar una envoltura para otra persona.
    await expect(desenvolverClave(ana.privada, { ...paraAna, idDestinatario: beto.idClave })).rejects.toThrow()

    // Ana, con la clave abierta, se la entrega a Beto (GrantCaseKey) sin que el servidor la vea.
    const paraBeto = await envolverClave(deAna, { idClave: beto.idClave, publica: beto.publica })
    const deBeto = await desenvolverClave(beto.privada, paraBeto)
    expect((await descifrarDetalles(deBeto, blob)).titulo).toBe('Caso de prueba')
  })

  it('rechaza una clave publica que no es un punto P-256', async () => {
    const { clave } = await nuevaClaveCaso()
    await expect(envolverClave(clave, { idClave: 'x', publica: new Uint8Array(33) })).rejects.toThrow()
  })

  it('el formato de transporte va y vuelve y el servidor lo valida', async () => {
    const ana = await cuenta('otra frase de ana bastante larga')
    const { clave, idClave } = await nuevaClaveCaso()
    const blob = await cifrarDetalles(clave, idClave, { titulo: 'Ida y vuelta', resumen: 'x' })
    const envoltura = await envolverClave(clave, { idClave: ana.idClave, publica: ana.publica })
    expect(textoABlob(blobATexto(blob))).toEqual(blob)
    expect(textoAEnvoltura(envolturaATexto(envoltura))).toEqual(envoltura)
    expect(esquemaBlob.safeParse(blobATexto(blob)).success).toBe(true)
    expect(esquemaEnvoltura.safeParse(envolturaATexto(envoltura)).success).toBe(true)
    expect(esquemaEnvoltura.safeParse({ ...envolturaATexto(envoltura), envuelta: 'AAAA' }).success).toBe(false)
  })
})
