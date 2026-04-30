/**
 * Cliente HTTP do Asaas — gateway de pagamento brasileiro.
 *
 * Sandbox: https://api-sandbox.asaas.com
 * Produção: https://api.asaas.com
 *
 * Auth: header `access_token` com a API key (não é Bearer).
 *
 * Modelo: Customer (1 por tenant, identificado por CPF/CNPJ) → Subscription
 * (1 por produto contratado, ex: gestao_smart, checksmart) → Payments
 * (geradas automaticamente a cada ciclo).
 *
 * Fluxo padrão pro nosso SaaS:
 * 1. Tenant decide assinar produto X → backend chama createCustomer (se 1ª vez)
 * 2. Backend chama createSubscription com billingType='PIX' (default) ou
 *    'CREDIT_CARD'
 * 3. Asaas devolve subscription_id e gera 1ª cobrança
 * 4. Cliente paga → Asaas dispara webhook PAYMENT_RECEIVED → backend
 *    atualiza `subscriptions.status` pra 'active'
 * 5. Próximos ciclos: Asaas gera cobrança automaticamente, webhook atualiza
 */

const API_URL = process.env.ASAAS_API_URL ?? 'https://api-sandbox.asaas.com'
const API_KEY = process.env.ASAAS_API_KEY

export type AsaasBillingType = 'PIX' | 'CREDIT_CARD' | 'BOLETO' | 'UNDEFINED'
export type AsaasCycle = 'MONTHLY' | 'YEARLY'

export type AsaasCustomer = {
  id:          string
  name:        string
  email:       string
  cpfCnpj:     string
  phone?:      string
  mobilePhone?: string
  // outros campos que Asaas devolve mas a gente não usa direto
}

export type AsaasSubscription = {
  id:                string
  customer:          string         // customer id
  value:             number         // valor em reais (ex: 97.00)
  nextDueDate:       string         // YYYY-MM-DD
  cycle:             AsaasCycle
  billingType:       AsaasBillingType
  status:            'ACTIVE' | 'EXPIRED' | 'INACTIVE'
  description?:      string
  externalReference?: string        // a gente passa o subscription.id local aqui
  endDate?:          string | null
}

export type CreateCustomerInput = {
  name:        string
  email:       string
  cpfCnpj:     string             // só números (Asaas valida)
  phone?:      string
  mobilePhone?: string
  externalReference?: string       // a gente passa o tenant_id aqui
}

/** Dados do cartão pra cobrança via API. Asaas exige isso quando
 *  billingType=CREDIT_CARD (sem isso a sub fica em pending sem como cobrar). */
export type AsaasCreditCard = {
  holderName:      string         // nome impresso no cartão
  number:          string         // só números (16 dígitos)
  expiryMonth:     string         // 2 dígitos "01"-"12"
  expiryYear:      string         // 4 dígitos "2030"
  ccv:             string         // 3-4 dígitos
}

/** Info do titular do cartão pra anti-fraude. Asaas exige obrigatoriamente. */
export type AsaasCreditCardHolderInfo = {
  name:           string          // mesmo nome do cartão
  email:          string
  cpfCnpj:        string          // só números
  postalCode:     string          // só números (8 dígitos)
  addressNumber:  string
  addressComplement?: string
  phone?:         string
  mobilePhone?:   string
}

export type CreateSubscriptionInput = {
  customer:           string       // asaas customer id
  billingType:        AsaasBillingType
  value:              number       // em reais
  nextDueDate:        string       // YYYY-MM-DD
  cycle:              AsaasCycle
  description?:       string
  externalReference?: string       // tenant_id::product
  // Pra CREDIT_CARD: passar dados completos do cartão. Asaas tokeniza
  // internamente e cobra a 1ª fatura imediatamente. Próximos ciclos usam
  // o token salvo (cliente não precisa preencher de novo).
  creditCard?:           AsaasCreditCard
  creditCardHolderInfo?: AsaasCreditCardHolderInfo
  // remoteIp: IP do cliente (anti-fraude — Asaas exige)
  remoteIp?:           string
}

/** Info de PIX retornada quando 1ª cobrança é gerada. */
export type AsaasPixQrCode = {
  encodedImage:    string         // base64 PNG do QR code (prefixar "data:image/png;base64,")
  payload:         string         // código copia-e-cola (BR Code)
  expirationDate:  string         // ISO datetime
}

/** Detalhe de pagamento (1ª cobrança da subscription). */
export type AsaasPayment = {
  id:           string
  customer:     string
  subscription?: string
  value:        number
  netValue:     number
  status:       string             // PENDING, RECEIVED, CONFIRMED, OVERDUE, REFUNDED
  billingType:  AsaasBillingType
  dueDate:      string
  invoiceUrl:   string             // página hospedada do Asaas
  bankSlipUrl?: string             // só pra BOLETO
}

class AsaasError extends Error {
  constructor(public status: number, public body: unknown, message: string) {
    super(message)
    this.name = 'AsaasError'
  }
}

async function asaasFetch<T>(
  path:   string,
  init?:  RequestInit,
): Promise<T> {
  if (!API_KEY) throw new Error('ASAAS_API_KEY não configurada.')

  const url = `${API_URL}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'access_token': API_KEY,
      ...init?.headers,
    },
  })

  const text = await res.text()
  let body: unknown = text
  try { body = JSON.parse(text) } catch { /* deixa como text */ }

  if (!res.ok) {
    const msg = typeof body === 'object' && body && 'errors' in body
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? JSON.stringify((body as any).errors)
      : `HTTP ${res.status}`
    throw new AsaasError(res.status, body, `Asaas API erro: ${msg}`)
  }

  return body as T
}

// ── Customers ──────────────────────────────────────────────────────────────

/** Cria customer no Asaas. CPF/CNPJ é obrigatório e validado pelo Asaas. */
export async function createAsaasCustomer(input: CreateCustomerInput): Promise<AsaasCustomer> {
  return asaasFetch<AsaasCustomer>('/v3/customers', {
    method: 'POST',
    body:   JSON.stringify(input),
  })
}

/** Busca customer pelo CPF/CNPJ. Útil pra evitar duplicar. */
export async function findAsaasCustomerByCpfCnpj(cpfCnpj: string): Promise<AsaasCustomer | null> {
  const res = await asaasFetch<{ data: AsaasCustomer[] }>(
    `/v3/customers?cpfCnpj=${encodeURIComponent(cpfCnpj)}`,
  )
  return res.data[0] ?? null
}

export async function getAsaasCustomer(customerId: string): Promise<AsaasCustomer> {
  return asaasFetch<AsaasCustomer>(`/v3/customers/${customerId}`)
}

/** Valida se o customer existe e está utilizável (não foi deletado no Asaas).
 *  Útil pra detectar a situação onde o admin deletou o customer mas o ID
 *  ainda está cacheado no nosso banco. */
export async function isAsaasCustomerValid(customerId: string): Promise<boolean> {
  try {
    const c = await asaasFetch<AsaasCustomer & { deleted?: boolean }>(
      `/v3/customers/${customerId}`,
    )
    // Asaas marca como deleted=true em vez de retornar 404 pra customers
    // removidos. Algumas situações também aparecem com fields ausentes.
    return !c.deleted && !!c.id
  } catch {
    return false
  }
}

// ── Subscriptions ──────────────────────────────────────────────────────────

export async function createAsaasSubscription(
  input: CreateSubscriptionInput,
): Promise<AsaasSubscription> {
  return asaasFetch<AsaasSubscription>('/v3/subscriptions', {
    method: 'POST',
    body:   JSON.stringify(input),
  })
}

export async function getAsaasSubscription(id: string): Promise<AsaasSubscription> {
  return asaasFetch<AsaasSubscription>(`/v3/subscriptions/${id}`)
}

/** Retorna o invoiceUrl da 1ª cobrança da subscription (pra mandar o cliente
 *  pagar PIX/cartão). Asaas gera a 1ª cobrança ao criar a subscription. */
export async function getSubscriptionFirstPaymentUrl(subId: string): Promise<string | null> {
  type Payment = { id: string; invoiceUrl: string; status: string; dueDate: string }
  const res = await asaasFetch<{ data: Payment[] }>(
    `/v3/subscriptions/${subId}/payments?limit=1&order=asc`,
  )
  return res.data[0]?.invoiceUrl ?? null
}

/** Retorna a 1ª cobrança da subscription (objeto completo). */
export async function getSubscriptionFirstPayment(subId: string): Promise<AsaasPayment | null> {
  const res = await asaasFetch<{ data: AsaasPayment[] }>(
    `/v3/subscriptions/${subId}/payments?limit=1&order=asc`,
  )
  return res.data[0] ?? null
}

/** Retorna QR code PIX de uma cobrança (pra exibir inline no nosso modal). */
export async function getPaymentPixQrCode(paymentId: string): Promise<AsaasPixQrCode | null> {
  try {
    return await asaasFetch<AsaasPixQrCode>(`/v3/payments/${paymentId}/pixQrCode`)
  } catch (e) {
    console.error('[getPaymentPixQrCode] falhou:', e)
    return null
  }
}

/** Cancela subscription. Asaas mantém histórico mas não gera mais cobranças. */
export async function cancelAsaasSubscription(id: string): Promise<{ deleted: boolean }> {
  return asaasFetch<{ deleted: boolean }>(`/v3/subscriptions/${id}`, {
    method: 'DELETE',
  })
}

/** Atualiza valor/descrição/etc de uma subscription. Usado pra downgrade:
 *  Asaas cobra novo valor a partir da próxima fatura, mantendo o ciclo. */
export async function updateAsaasSubscription(
  id:    string,
  patch: Partial<Pick<AsaasSubscription, 'value' | 'description' | 'cycle' | 'nextDueDate' | 'billingType'>>,
): Promise<AsaasSubscription> {
  return asaasFetch<AsaasSubscription>(`/v3/subscriptions/${id}`, {
    method: 'PUT',
    body:   JSON.stringify(patch),
  })
}

// ── One-time payments (pra upgrades com cobrança proporcional) ────────────

/** Input pra criar uma cobrança one-time (não recorrente). Usado em upgrades:
 *  cobramos a diferença proporcional fora do ciclo regular da subscription. */
export type CreateOneTimePaymentInput = {
  customer:           string
  billingType:        AsaasBillingType
  value:              number             // em reais (TOTAL — Asaas divide pelas parcelas)
  dueDate:            string             // YYYY-MM-DD
  description?:       string
  externalReference?: string
  // Pra cartão: Asaas cobra na hora usando token salvo (sem precisar
  // pedir cartão de novo). Pra PIX: gera QR code que cliente paga.
  creditCard?:           AsaasCreditCard
  creditCardHolderInfo?: AsaasCreditCardHolderInfo
  remoteIp?:           string
  // Parcelamento sem juros (só faz sentido em CREDIT_CARD).
  // Asaas divide value/installmentCount em N cobranças mensais
  // (1ª agora, demais geradas automaticamente).
  installmentCount?:  number
  installmentValue?:  number             // alternativa ao installmentCount
}

/** Cria cobrança avulsa (não recorrente). */
export async function createAsaasOneTimePayment(
  input: CreateOneTimePaymentInput,
): Promise<AsaasPayment> {
  return asaasFetch<AsaasPayment>('/v3/payments', {
    method: 'POST',
    body:   JSON.stringify(input),
  })
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Formata data pra YYYY-MM-DD (formato esperado pelo Asaas). */
export function asaasDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Hoje no formato Asaas. */
export function asaasToday(): string {
  return asaasDate(new Date())
}
