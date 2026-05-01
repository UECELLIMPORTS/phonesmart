/**
 * Wrapper da Evolution API (https://doc.evolution-api.com).
 *
 * Centralizado: 1 Evolution API hospedada na VPS do dono. Cada tenant tem
 * 1 instância nominada (whatsapp_instance_name) onde o número dele tá conectado.
 *
 * ENV vars necessárias:
 *   EVOLUTION_API_URL  — URL base (ex: https://evo.minhavps.com)
 *   EVOLUTION_API_KEY  — global key (configurada no docker-compose da Evolution)
 *
 * Sem essas envs, todas as funções retornam erro estruturado em vez de jogar.
 * Permite o app rodar sem WhatsApp configurado (UI mostra "WhatsApp não configurado").
 */

const API_URL = process.env.EVOLUTION_API_URL?.replace(/\/$/, '')
const API_KEY = process.env.EVOLUTION_API_KEY

export type EvolutionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

export type ConnectionState = 'open' | 'connecting' | 'close' | 'unknown'

function isConfigured(): boolean {
  return Boolean(API_URL && API_KEY)
}

async function evolutionFetch(
  path: string,
  init: RequestInit = {},
): Promise<EvolutionResult<unknown>> {
  if (!isConfigured()) {
    return { ok: false, error: 'Evolution API não configurada (faltam EVOLUTION_API_URL/EVOLUTION_API_KEY).' }
  }

  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'apikey':       API_KEY!,
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
    })

    const text = await res.text()
    let body: unknown = null
    try { body = text ? JSON.parse(text) : null } catch { body = text }

    if (!res.ok) {
      const msg = (body && typeof body === 'object' && 'message' in body)
        ? String((body as { message: unknown }).message)
        : `HTTP ${res.status}`
      return { ok: false, error: msg }
    }

    return { ok: true, data: body }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'erro desconhecido' }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Instance management
// ──────────────────────────────────────────────────────────────────────────

/**
 * Cria uma nova instância na Evolution. instanceName precisa ser único globalmente
 * na Evolution (não só no tenant). Usar tenant_id como prefixo é suficiente.
 *
 * Retorna { instanceName } pronto pra salvar em tenants.whatsapp_instance_name.
 */
export async function createInstance(instanceName: string): Promise<EvolutionResult<{ instanceName: string }>> {
  const res = await evolutionFetch('/instance/create', {
    method: 'POST',
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    }),
  })
  if (!res.ok) return res
  return { ok: true, data: { instanceName } }
}

/**
 * Pega QR code da instância (base64). Usado pelo modal de conexão.
 */
export async function getInstanceQr(instanceName: string): Promise<EvolutionResult<{ qrBase64: string | null; pairingCode: string | null }>> {
  const res = await evolutionFetch(`/instance/connect/${encodeURIComponent(instanceName)}`)
  if (!res.ok) return res
  type QrBody = { base64?: string; code?: string; pairingCode?: string }
  const body = (res.data ?? {}) as QrBody
  return {
    ok: true,
    data: {
      qrBase64:    body.base64 ?? null,
      pairingCode: body.pairingCode ?? null,
    },
  }
}

/**
 * Verifica estado da conexão.
 *   open       — conectado e funcional
 *   connecting — aguardando QR/pairing
 *   close      — desconectado
 */
export async function getInstanceState(instanceName: string): Promise<EvolutionResult<{ state: ConnectionState; phone: string | null }>> {
  const res = await evolutionFetch(`/instance/connectionState/${encodeURIComponent(instanceName)}`)
  if (!res.ok) return res

  type StateBody = {
    instance?: { state?: string; user?: { id?: string } }
    state?: string
  }
  const body = (res.data ?? {}) as StateBody
  const rawState = body.instance?.state ?? body.state ?? 'unknown'
  const state: ConnectionState =
    rawState === 'open'        ? 'open'
  : rawState === 'connecting'  ? 'connecting'
  : rawState === 'close'       ? 'close'
  :                              'unknown'

  // user.id vem como "5579999999999@s.whatsapp.net"
  let phone: string | null = null
  if (body.instance?.user?.id) {
    const match = body.instance.user.id.match(/^(\d+)/)
    if (match) phone = match[1]
  }

  return { ok: true, data: { state, phone } }
}

/**
 * Desconecta o WhatsApp da instância (logout). Não apaga a instância.
 */
export async function logoutInstance(instanceName: string): Promise<EvolutionResult> {
  const res = await evolutionFetch(`/instance/logout/${encodeURIComponent(instanceName)}`, {
    method: 'DELETE',
  })
  return res.ok ? { ok: true } : res
}

/**
 * Apaga a instância completamente (usar quando lojista quer remover de vez).
 */
export async function deleteInstance(instanceName: string): Promise<EvolutionResult> {
  const res = await evolutionFetch(`/instance/delete/${encodeURIComponent(instanceName)}`, {
    method: 'DELETE',
  })
  return res.ok ? { ok: true } : res
}

// ──────────────────────────────────────────────────────────────────────────
// Send message
// ──────────────────────────────────────────────────────────────────────────

/**
 * Normaliza um telefone pro formato esperado pela Evolution.
 * Aceita: "(79) 99999-9999", "79999999999", "5579999999999"
 * Retorna: "5579999999999" (só dígitos com 55 prefixo)
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 10) return null  // muito curto pra ser número BR
  return digits.startsWith('55') ? digits : `55${digits}`
}

/**
 * Envia mensagem de texto via Evolution.
 */
export async function sendTextMessage(args: {
  instanceName: string
  phone:        string   // já normalizado (5579...)
  text:         string
}): Promise<EvolutionResult<{ messageId: string | null }>> {
  const res = await evolutionFetch(`/message/sendText/${encodeURIComponent(args.instanceName)}`, {
    method: 'POST',
    body: JSON.stringify({
      number: args.phone,
      text:   args.text,
    }),
  })
  if (!res.ok) return res

  type SendBody = { key?: { id?: string } }
  const body = (res.data ?? {}) as SendBody
  return { ok: true, data: { messageId: body.key?.id ?? null } }
}

export function isEvolutionConfigured(): boolean {
  return isConfigured()
}
