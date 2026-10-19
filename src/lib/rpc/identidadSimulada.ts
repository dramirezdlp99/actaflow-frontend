import 'server-only'
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { create } from '@bufbuild/protobuf'
import { timestampFromMs } from '@bufbuild/protobuf/wkt'
import { Code, ConnectError, type ConnectRouter, type HandlerContext } from '@connectrpc/connect'
import { AccountSchema, AccountService, PlatformRole, type Account } from '@/gen/actaflow/identity/v1/account_pb'
import {
  AuthService,
  SessionSchema,
  type KdfParameters,
  type PrivateKeyKit,
  type Session,
} from '@/gen/actaflow/identity/v1/auth_pb'
import { MemberSchema, OrganizationSchema, OrganizationService } from '@/gen/actaflow/identity/v1/organization_pb'

/**
 * identity-service SIMULADO en memoria, con las mismas reglas que el real: invitacion obligatoria,
 * TOTP RFC 6238 de un solo uso, codigos de recuperacion, bloqueo tras 5 fallos, refresco que rota y
 * detecta robo, y respuestas que no revelan si un correo existe. Solo para ACTAFLOW_RPC_MODE=mock.
 *
 * La invitacion de arranque es publica a proposito: no protege nada real.
 */
export const INVITACION_SIMULADA = 'invitacion-simulada-publica-solo-para-desarrollo-0001'
export const CORREO_ADMIN_SIMULADO = 'admin@actaflow.test'

const MINUTO = 60_000
const VIDA_ACCESO = 15 * MINUTO
const VIDA_REFRESCO = 30 * 24 * 60 * MINUTO
const VIDA_DESAFIO = 5 * MINUTO
const INTENTOS_MAXIMOS = 5
const BLOQUEO = 15 * MINUTO
const ALFABETO_CODIGOS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

type Cuenta = {
  id: string
  correo: string
  nombre: string
  rol: PlatformRole
  kdf: KdfParameters
  verificador: string
  kit: PrivateKeyKit
  secretoTotp: Buffer
  inscripcion: string
  confirmada: boolean
  ultimoPaso: number
  codigos: Set<string>
  activa: boolean
  fallos: number
  bloqueadaHasta: number
  ultimoIngreso: number
  creada: number
}

type Estado = {
  organizacion: { id: string; nombre: string }
  invitaciones: Map<string, { correo: string; rol: PlatformRole; vence: number; usada: boolean; clave?: string }>
  cuentas: Map<string, Cuenta>
  registros: Map<string, string>
  desafios: Map<string, { cuentaId: string; vence: number; usado: boolean }>
  refrescos: Map<string, { cuentaId: string; familia: string; vence: number; usado: boolean }>
  familiasRevocadas: Set<string>
  accesos: Map<string, { cuentaId: string; vence: number }>
}

function estadoInicial(): Estado {
  const invitaciones: Estado['invitaciones'] = new Map()
  invitaciones.set(sha(INVITACION_SIMULADA), {
    correo: CORREO_ADMIN_SIMULADO,
    rol: PlatformRole.ADMIN,
    vence: Number.MAX_SAFE_INTEGER,
    usada: false,
  })
  return {
    organizacion: { id: randomUUID(), nombre: 'Centro de Conciliacion Simulado' },
    invitaciones,
    cuentas: new Map(),
    registros: new Map(),
    desafios: new Map(),
    refrescos: new Map(),
    familiasRevocadas: new Set(),
    accesos: new Map(),
  }
}

// Un solo estado por proceso: el servidor de desarrollo reevalua modulos, globalThis no.
declare global {
  var __actaflowIdentidadSimulada: Estado | undefined
}

function estado(): Estado {
  globalThis.__actaflowIdentidadSimulada ??= estadoInicial()
  return globalThis.__actaflowIdentidadSimulada
}

/** Solo para pruebas: vuelve al estado de fabrica. */
export function reiniciarIdentidadSimulada(): void {
  globalThis.__actaflowIdentidadSimulada = estadoInicial()
}

function sha(texto: string | Uint8Array): string {
  return createHash('sha256').update(texto).digest('hex')
}

const PASO_TOTP_MS = 30_000

/** TOTP RFC 6238 (SHA-1, 6 digitos, pasos de 30 s), igual que identity-service. */
export function codigoTotp(secreto: Uint8Array, ahoraMs: number): string {
  const paso = Math.floor(ahoraMs / PASO_TOTP_MS)
  return codigoDePaso(secreto, paso)
}

function codigoDePaso(secreto: Uint8Array, paso: number): string {
  const contador = Buffer.alloc(8)
  contador.writeBigUInt64BE(BigInt(paso))
  const hmac = createHmac('sha1', secreto).update(contador).digest()
  const desplazamiento = (hmac[hmac.length - 1] ?? 0) & 0x0f
  const numero = hmac.readUInt32BE(desplazamiento) & 0x7fffffff
  return (numero % 1_000_000).toString().padStart(6, '0')
}

function base32(bytes: Uint8Array): string {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0
  let valor = 0
  let salida = ''
  for (const byte of bytes) {
    valor = (valor << 8) | byte
    bits += 8
    while (bits >= 5) {
      salida += alfabeto[(valor >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  return bits > 0 ? salida + alfabeto[(valor << (5 - bits)) & 31] : salida
}

function credenciales(): ConnectError {
  return new ConnectError('Credenciales invalidas', Code.Unauthenticated)
}

function correoNormal(correo: string): string {
  return correo.trim().toLowerCase()
}

function marca(ms: number) {
  return timestampFromMs(ms)
}

function contrato(cuenta: Cuenta): Account {
  return create(AccountSchema, {
    id: cuenta.id,
    email: cuenta.correo,
    displayName: cuenta.nombre,
    role: cuenta.rol,
    organizationId: estado().organizacion.id,
    publicKeyId: cuenta.kit.publicKey?.keyId ?? '',
    createdAt: marca(cuenta.creada),
  })
}

function porCorreo(correo: string): Cuenta | undefined {
  return [...estado().cuentas.values()].find((cuenta) => cuenta.correo === correo)
}

function emitirSesion(cuenta: Cuenta, familia: string = randomUUID()): Session {
  const ahora = Date.now()
  const acceso = `simulado.${randomBytes(24).toString('base64url')}`
  const refresco = randomBytes(32).toString('base64url')
  estado().accesos.set(acceso, { cuentaId: cuenta.id, vence: ahora + VIDA_ACCESO })
  estado().refrescos.set(sha(refresco), { cuentaId: cuenta.id, familia, vence: ahora + VIDA_REFRESCO, usado: false })
  return create(SessionSchema, {
    accessToken: acceso,
    accessTokenExpiresAt: marca(ahora + VIDA_ACCESO),
    refreshToken: refresco,
    refreshTokenExpiresAt: marca(ahora + VIDA_REFRESCO),
    account: contrato(cuenta),
    keyKit: cuenta.kit,
  })
}

/** El token de acceso llega en la cabecera authorization, como en el servicio real. */
function principal(contexto: HandlerContext): Cuenta {
  const cabecera = contexto.requestHeader.get('authorization') ?? ''
  const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : ''
  const acceso = estado().accesos.get(token)
  const cuenta = acceso ? estado().cuentas.get(acceso.cuentaId) : undefined
  if (!acceso || acceso.vence < Date.now() || !cuenta?.activa) {
    throw new ConnectError('Sesion vencida o no valida', Code.Unauthenticated)
  }
  return cuenta
}

function totpValido(cuenta: Cuenta, codigo: string): boolean {
  const paso = Math.floor(Date.now() / PASO_TOTP_MS)
  for (const candidato of [paso - 1, paso, paso + 1]) {
    if (candidato > cuenta.ultimoPaso && codigoDePaso(cuenta.secretoTotp, candidato) === codigo) {
      cuenta.ultimoPaso = candidato
      return true
    }
  }
  return false
}

function codigosRecuperacion(cuenta: Cuenta): string[] {
  const codigos = Array.from({ length: 10 }, () => {
    const letras = Array.from(randomBytes(10), (byte) => ALFABETO_CODIGOS[byte % ALFABETO_CODIGOS.length])
    return `${letras.slice(0, 5).join('')}-${letras.slice(5).join('')}`
  })
  cuenta.codigos = new Set(codigos.map((codigo) => sha(codigo)))
  return codigos
}

export function registrarIdentidadSimulada(router: ConnectRouter): void {
  router.service(AuthService, {
    getLoginParameters(peticion) {
      const cuenta = porCorreo(correoNormal(peticion.email))
      if (cuenta?.confirmada) {
        return { kdf: cuenta.kdf }
      }
      // Parametros falsos pero estables: la respuesta no revela si la cuenta existe.
      const sal = createHash('sha256')
        .update(`sal-falsa\n${correoNormal(peticion.email)}`)
        .digest()
        .subarray(0, 16)
      return { kdf: { salt: new Uint8Array(sal), iterations: 600_000 } }
    },
    register(peticion) {
      const previa = estado().registros.get(peticion.idempotencyKey)
      const ya = previa ? estado().cuentas.get(previa) : undefined
      if (ya) {
        return { account: contrato(ya), totpEnrollment: inscripcion(ya) }
      }
      const correo = correoNormal(peticion.email)
      const invitacion = estado().invitaciones.get(sha(peticion.invitationToken))
      if (!invitacion || invitacion.usada || invitacion.vence < Date.now() || invitacion.correo !== correo) {
        throw new ConnectError('La invitacion no es valida, ya se uso o vencio', Code.FailedPrecondition)
      }
      if (porCorreo(correo)) {
        throw new ConnectError('Ya existe una cuenta con ese correo', Code.AlreadyExists)
      }
      if (!peticion.kdf || !peticion.keyKit || peticion.authVerifier.length !== 32) {
        throw new ConnectError('Peticion incompleta', Code.InvalidArgument)
      }
      invitacion.usada = true
      const cuenta: Cuenta = {
        id: randomUUID(),
        correo,
        nombre: peticion.displayName.trim(),
        rol: invitacion.rol,
        kdf: peticion.kdf,
        verificador: sha(peticion.authVerifier),
        kit: peticion.keyKit,
        secretoTotp: randomBytes(20),
        inscripcion: randomUUID(),
        confirmada: false,
        ultimoPaso: 0,
        codigos: new Set(),
        activa: true,
        fallos: 0,
        bloqueadaHasta: 0,
        ultimoIngreso: 0,
        creada: Date.now(),
      }
      estado().cuentas.set(cuenta.id, cuenta)
      estado().registros.set(peticion.idempotencyKey, cuenta.id)
      return { account: contrato(cuenta), totpEnrollment: inscripcion(cuenta) }
    },
    confirmTotpEnrollment(peticion) {
      const cuenta = [...estado().cuentas.values()].find((c) => c.inscripcion === peticion.enrollmentId)
      if (!cuenta) {
        throw new ConnectError('Inscripcion no encontrada', Code.NotFound)
      }
      if (cuenta.confirmada) {
        throw new ConnectError('El segundo factor ya estaba confirmado', Code.FailedPrecondition)
      }
      if (!totpValido(cuenta, peticion.totpCode)) {
        throw new ConnectError('Codigo incorrecto: revisa la hora de tu telefono', Code.Unauthenticated)
      }
      cuenta.confirmada = true
      cuenta.ultimoIngreso = Date.now()
      return { recoveryCodes: codigosRecuperacion(cuenta), session: emitirSesion(cuenta) }
    },
    login(peticion) {
      const cuenta = porCorreo(correoNormal(peticion.email))
      const ahora = Date.now()
      if (!cuenta?.confirmada || !cuenta.activa || cuenta.bloqueadaHasta > ahora) {
        throw credenciales()
      }
      if (sha(peticion.authVerifier) !== cuenta.verificador) {
        cuenta.fallos += 1
        if (cuenta.fallos >= INTENTOS_MAXIMOS) {
          cuenta.fallos = 0
          cuenta.bloqueadaHasta = ahora + BLOQUEO
        }
        throw credenciales()
      }
      cuenta.fallos = 0
      const id = randomUUID()
      estado().desafios.set(id, { cuentaId: cuenta.id, vence: ahora + VIDA_DESAFIO, usado: false })
      return { challengeId: id, challengeExpiresAt: marca(ahora + VIDA_DESAFIO) }
    },
    completeSecondFactor(peticion) {
      const desafio = estado().desafios.get(peticion.challengeId)
      const cuenta = desafio ? estado().cuentas.get(desafio.cuentaId) : undefined
      if (!desafio || !cuenta || desafio.usado || desafio.vence < Date.now()) {
        throw credenciales()
      }
      let valido = false
      if (peticion.factor.case === 'totpCode') {
        valido = totpValido(cuenta, peticion.factor.value)
      } else if (peticion.factor.case === 'recoveryCode') {
        valido = cuenta.codigos.delete(sha(peticion.factor.value))
      }
      if (!valido) {
        throw credenciales()
      }
      desafio.usado = true
      cuenta.ultimoIngreso = Date.now()
      return { session: emitirSesion(cuenta), remainingRecoveryCodes: cuenta.codigos.size }
    },
    refreshSession(peticion) {
      const registro = estado().refrescos.get(sha(peticion.refreshToken))
      if (!registro || registro.vence < Date.now() || estado().familiasRevocadas.has(registro.familia)) {
        throw new ConnectError('Sesion vencida o no valida', Code.Unauthenticated)
      }
      if (registro.usado) {
        // Reuso de un token ya rotado: alguien lo copio. Se cierra toda la familia.
        estado().familiasRevocadas.add(registro.familia)
        throw new ConnectError('Sesion vencida o no valida', Code.Unauthenticated)
      }
      const cuenta = estado().cuentas.get(registro.cuentaId)
      if (!cuenta?.activa) {
        throw new ConnectError('Sesion vencida o no valida', Code.Unauthenticated)
      }
      registro.usado = true
      return { session: emitirSesion(cuenta, registro.familia) }
    },
    logout(peticion) {
      const registro = estado().refrescos.get(sha(peticion.refreshToken))
      if (registro) {
        estado().familiasRevocadas.add(registro.familia)
      }
      return {}
    },
  })

  router.service(AccountService, {
    getCurrentAccount(_peticion, contexto) {
      return { account: contrato(principal(contexto)) }
    },
  })

  router.service(OrganizationService, {
    getOrganization(_peticion, contexto) {
      principal(contexto)
      const { id, nombre } = estado().organizacion
      return { organization: create(OrganizationSchema, { id, name: nombre, city: 'Bogota' }) }
    },
    listMembers(peticion, contexto) {
      const quien = principal(contexto)
      if (quien.rol === PlatformRole.EXTERNAL) {
        throw new ConnectError('Las cuentas externas no ven la lista de miembros', Code.PermissionDenied)
      }
      const filtro = peticion.role
      const miembros = [...estado().cuentas.values()]
        .filter((c) => filtro === PlatformRole.UNSPECIFIED || c.rol === filtro)
        .map((c) =>
          create(MemberSchema, {
            account: contrato(c),
            active: c.activa,
            lastSignInAt: c.ultimoIngreso ? marca(c.ultimoIngreso) : undefined,
          }),
        )
      return { members: miembros.slice(0, peticion.page?.pageSize ?? 50), pageInfo: { nextPageToken: '' } }
    },
    inviteMember(peticion, contexto) {
      const quien = principal(contexto)
      if (quien.rol !== PlatformRole.ADMIN) {
        throw new ConnectError('Solo un administrador puede hacer esto', Code.PermissionDenied)
      }
      const correo = correoNormal(peticion.email)
      if (porCorreo(correo)) {
        throw new ConnectError('Ya existe una cuenta con ese correo', Code.AlreadyExists)
      }
      const token = randomBytes(32).toString('base64url')
      const vence = Date.now() + 7 * 24 * 60 * MINUTO
      for (const [hash, invitacion] of estado().invitaciones) {
        if (invitacion.clave === peticion.idempotencyKey && !invitacion.usada) {
          estado().invitaciones.delete(hash)
        }
      }
      estado().invitaciones.set(sha(token), {
        correo,
        rol: peticion.role,
        vence,
        usada: false,
        clave: peticion.idempotencyKey,
      })
      return { invitationId: randomUUID(), expiresAt: marca(vence), invitationToken: token }
    },
  })
}

function inscripcion(cuenta: Cuenta) {
  const secreto = base32(cuenta.secretoTotp)
  const etiqueta = encodeURIComponent(`ActaFlow:${cuenta.correo}`)
  return {
    enrollmentId: cuenta.inscripcion,
    secretBase32: secreto,
    otpauthUri: `otpauth://totp/${etiqueta}?secret=${secreto}&issuer=ActaFlow&algorithm=SHA1&digits=6&period=30`,
  }
}

/** Para las pruebas: secreto TOTP en claro de una cuenta simulada. */
export function secretoTotpSimulado(correo: string): Uint8Array | undefined {
  return porCorreo(correoNormal(correo))?.secretoTotp
}
