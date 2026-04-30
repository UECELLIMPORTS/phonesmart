'use server'

/**
 * Server Actions de billing — integra Asaas com nossa tabela `subscriptions`.
 *
 * Funções principais:
 * - subscribeToProduct: cliente clica "Assinar" → chama Asaas → salva ids
 * - cancelSubscription: chama Asaas pra cancelar → atualiza status local
 * - getActivePaymentLink: pega link de pagamento da próxima cobrança
 *   (pra mostrar QR code PIX ou link de cartão)
 *
 * Decisão de UX: pedimos CPF/CNPJ no momento de assinar, não no signup.
 * Cadastro inicial é leve; só pede dados de cobrança quando vai pagar.
 */

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTenantId } from '@/lib/tenant'
import {
  createAsaasCustomer, findAsaasCustomerByCpfCnpj,
  createAsaasSubscription, cancelAsaasSubscription,
  createAsaasOneTimePayment, updateAsaasSubscription,
  getSubscriptionFirstPayment, getPaymentPixQrCode,
  isAsaasCustomerValid,
  asaasToday,
  type AsaasBillingType, type AsaasCreditCard, type AsaasCreditCardHolderInfo,
  type AsaasPixQrCode,
} from '@/lib/asaas'
import { getPrice, getYearlyPrice, centsToReais, YEARLY_INSTALLMENTS, type Product, type Plan, type BillingCycle } from '@/lib/pricing'
import { createNotification } from '@/lib/notifications'

export type SubscribeInput = {
  product:       Product
  plan:          Plan
  paymentMethod: 'PIX' | 'CREDIT_CARD'
  /** MONTHLY (default) ou YEARLY (10% off + 12x sem juros no cartão). */
  billingCycle?: BillingCycle
  // Dados de contato — obrigatórios pra Asaas em PIX e Cartão
  fullName?:     string             // nome completo (titular)
  cpfCnpj?:      string             // só números
  phone?:        string             // celular (DDD + número)
  // Dados de cartão — obrigatórios quando paymentMethod=CREDIT_CARD
  creditCard?: {
    holderName:  string
    number:      string             // só números
    expiryMonth: string             // "01"-"12"
    expiryYear:  string             // "2030"
    ccv:         string
  }
  // Endereço de cobrança (Asaas exige pra cartão — anti-fraude)
  postalCode?:    string             // só números (8 dígitos)
  addressNumber?: string
}

/** Resposta unificada — pode trazer dados pra UI exibir QR PIX inline,
 *  ou só sinalizar sucesso (cartão é cobrado imediatamente). */
export type SubscribeResult =
  | { ok: true;  asaasSubscriptionId: string; mode: 'pix';  pixQrCode: AsaasPixQrCode | null; paymentValue: number }
  | { ok: true;  asaasSubscriptionId: string; mode: 'card'; chargedNow: boolean }
  | { ok: false; error: string }

/** Limpa CPF/CNPJ pra só números. */
function digitsOnly(s: string): string {
  return s.replace(/\D/g, '')
}

/** Valida CPF (11 dígitos) ou CNPJ (14 dígitos). Não valida dígito verificador
 *  porque o Asaas faz isso. Só verifica formato básico. */
function isValidCpfCnpj(s: string): boolean {
  return /^\d{11}$/.test(s) || /^\d{14}$/.test(s)
}

/**
 * Cria/atualiza assinatura paga no Asaas + salva referências locais.
 *
 * Fluxo:
 * 1. Valida input + permissão (só owner)
 * 2. Se tenant não tem asaas_customer_id, cria customer no Asaas
 * 3. Cria subscription no Asaas (PIX ou CREDIT_CARD)
 * 4. Salva ids + status='trialing' até webhook PAYMENT_RECEIVED chegar
 *    (porque PIX pode demorar pra pagar; cartão chega rápido)
 *
 * Idempotência: se já tem asaas_subscription_id ativa pro mesmo
 * (tenant_id, product), retorna a existente em vez de duplicar.
 */
export async function subscribeToProduct(input: SubscribeInput): Promise<SubscribeResult> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)
  if (user.app_metadata?.tenant_role !== 'owner') {
    return { ok: false, error: 'Apenas o dono pode contratar assinaturas.' }
  }

  const price = getPrice(input.product, input.plan)
  if (!price) return { ok: false, error: 'Plano inválido pra esse produto.' }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  // ── 1. Carrega tenant pra ver se já tem asaas_customer_id ───────────────
  const { data: tenant, error: tenantErr } = await sb
    .from('tenants')
    .select('id, name, cpf_cnpj, asaas_customer_id')
    .eq('id', tenantId)
    .maybeSingle()

  if (tenantErr || !tenant) {
    console.error('[subscribeToProduct] tenant não encontrado:', tenantErr)
    return { ok: false, error: 'Empresa não encontrada.' }
  }

  // ── 2. Garante customer no Asaas ────────────────────────────────────────
  let asaasCustomerId = tenant.asaas_customer_id as string | null
  let cpfCnpj         = tenant.cpf_cnpj as string | null

  // Valida cache: se asaas_customer_id existe mas customer foi removido
  // do Asaas (admin deletou no painel), invalida pra criar um novo
  if (asaasCustomerId) {
    const valid = await isAsaasCustomerValid(asaasCustomerId)
    if (!valid) {
      console.warn('[subscribeToProduct] customer cache inválido, recriando:', asaasCustomerId)
      asaasCustomerId = null
      // Limpa também no banco pra não tentar reusar de novo
      await sb.from('tenants')
        .update({ asaas_customer_id: null })
        .eq('id', tenantId)
    }
  }

  // Validação dos campos de contato — exigidos pra qualquer método de pagamento
  const fullName = (input.fullName ?? '').trim()
  const phone    = input.phone ? digitsOnly(input.phone) : ''
  if (fullName.length < 3) {
    return { ok: false, error: 'Informe seu nome completo.' }
  }
  if (phone.length < 10 || phone.length > 11) {
    return { ok: false, error: 'Informe um celular válido com DDD (10 ou 11 dígitos).' }
  }

  if (!asaasCustomerId) {
    const cleanCpfCnpj = input.cpfCnpj ? digitsOnly(input.cpfCnpj) : (cpfCnpj ?? '')
    if (!cleanCpfCnpj || !isValidCpfCnpj(cleanCpfCnpj)) {
      return { ok: false, error: 'CPF (11 dígitos) ou CNPJ (14 dígitos) é obrigatório.' }
    }

    try {
      // Tenta achar customer existente pelo CPF/CNPJ (Asaas não permite
      // 2 customers com mesmo CPF/CNPJ — se existe, reusa).
      // findAsaasCustomerByCpfCnpj retorna até deletados, então também valida.
      let customer = await findAsaasCustomerByCpfCnpj(cleanCpfCnpj)
      if (customer) {
        const stillValid = await isAsaasCustomerValid(customer.id)
        if (!stillValid) customer = null
      }

      const finalCustomer = customer ?? await createAsaasCustomer({
        name:        fullName,
        email:       user.email ?? '',
        cpfCnpj:     cleanCpfCnpj,
        mobilePhone: phone,
        externalReference: tenant.id,
      })

      asaasCustomerId = finalCustomer.id
      cpfCnpj         = cleanCpfCnpj

      // Salva no tenant pra reusar
      await sb.from('tenants')
        .update({ asaas_customer_id: asaasCustomerId, cpf_cnpj: cleanCpfCnpj })
        .eq('id', tenantId)
    } catch (e) {
      console.error('[subscribeToProduct] criar customer Asaas falhou:', e)
      const msg = e instanceof Error ? e.message : 'Não foi possível registrar dados de cobrança.'
      return { ok: false, error: msg }
    }
  }

  // ── 3. Verifica se já existe sub ativa (idempotência) ───────────────────
  const { data: existingSub } = await sb
    .from('subscriptions')
    .select('id, asaas_subscription_id, status, trial_ends_at')
    .eq('tenant_id', tenantId)
    .eq('product', input.product)
    .maybeSingle()

  if (existingSub?.asaas_subscription_id && existingSub.status === 'active') {
    return { ok: false, error: `Você já tem assinatura ativa de ${input.product}.` }
  }

  // Se já tem sub Asaas pendente (status inactive ou trial), cancela ela
  // antes de criar uma nova — evita órfãs no Asaas e cobranças duplicadas
  if (existingSub?.asaas_subscription_id) {
    try {
      await cancelAsaasSubscription(existingSub.asaas_subscription_id)
    } catch (e) {
      console.warn('[subscribeToProduct] cancelar sub antiga falhou (segue):', e)
    }
  }

  // ── 4. Cria subscription no Asaas ───────────────────────────────────────
  const billingType: AsaasBillingType = input.paymentMethod === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'PIX'
  // 1ª cobrança imediata. Cartão é cobrado na hora; PIX gera QR pra cliente
  // pagar manualmente (status fica inactive até webhook PAYMENT_RECEIVED).
  const dueDate = asaasToday()

  // Pra cartão, valida e prepara dados sensíveis
  let creditCard:           AsaasCreditCard | undefined
  let creditCardHolderInfo: AsaasCreditCardHolderInfo | undefined
  if (input.paymentMethod === 'CREDIT_CARD') {
    if (!input.creditCard) {
      return { ok: false, error: 'Dados do cartão são obrigatórios.' }
    }
    if (!input.postalCode || !input.addressNumber) {
      return { ok: false, error: 'CEP e número do endereço são obrigatórios pra pagamento com cartão.' }
    }

    const cardNum = digitsOnly(input.creditCard.number)
    if (cardNum.length < 13 || cardNum.length > 19) {
      return { ok: false, error: 'Número do cartão inválido.' }
    }

    creditCard = {
      holderName:  input.creditCard.holderName.trim(),
      number:      cardNum,
      expiryMonth: input.creditCard.expiryMonth.padStart(2, '0'),
      expiryYear:  input.creditCard.expiryYear,
      ccv:         input.creditCard.ccv,
    }
    creditCardHolderInfo = {
      name:          fullName,
      email:         user.email ?? '',
      cpfCnpj:       cpfCnpj!,
      postalCode:    digitsOnly(input.postalCode),
      addressNumber: input.addressNumber,
      mobilePhone:   phone,
    }
  }

  // ── 4.b. Decide MONTHLY vs YEARLY ─────────────────────────────────────
  const cycle: BillingCycle = input.billingCycle ?? 'MONTHLY'
  const yearlyPrice = cycle === 'YEARLY' ? getYearlyPrice(input.product, input.plan) : null
  if (cycle === 'YEARLY' && !yearlyPrice) {
    return { ok: false, error: 'Plano anual não disponível pra esse produto.' }
  }

  let asaasSub
  let yearlyOneTimePayment: Awaited<ReturnType<typeof createAsaasOneTimePayment>> | null = null

  try {
    if (cycle === 'YEARLY' && yearlyPrice) {
      // YEARLY: 1) Cobrança avulsa parcelada em 12x (com 10% off) AGORA
      //         2) Subscription anual com value=preço cheio pra renovação em 1 ano
      yearlyOneTimePayment = await createAsaasOneTimePayment({
        customer:    asaasCustomerId,
        billingType,
        value:       centsToReais(yearlyPrice.discountedCents),
        dueDate,
        description: `${price.description} — Anual (10% off)`,
        externalReference: `${tenantId}::${input.product}::yearly_initial`,
        creditCard,
        creditCardHolderInfo,
        // 12x sem juros no cartão; PIX cobra à vista (sem installments)
        installmentCount: billingType === 'CREDIT_CARD' ? YEARLY_INSTALLMENTS : undefined,
      })

      // Subscription pra renovação automática no ano seguinte (preço cheio,
      // sem desconto — desconto vale só no 1º ciclo conforme regra acordada)
      const nextYearDate = new Date()
      nextYearDate.setFullYear(nextYearDate.getFullYear() + 1)
      asaasSub = await createAsaasSubscription({
        customer:    asaasCustomerId,
        billingType,
        value:       centsToReais(yearlyPrice.fullCents),
        nextDueDate: nextYearDate.toISOString().slice(0, 10),
        cycle:       'YEARLY',
        description: `${price.description} — Renovação anual`,
        externalReference: `${tenantId}::${input.product}`,
        creditCard,           // Asaas reusa token salvo da cobrança avulsa
        creditCardHolderInfo,
      })
    } else {
      // MONTHLY (default)
      asaasSub = await createAsaasSubscription({
        customer:    asaasCustomerId,
        billingType,
        value:       centsToReais(price.priceCents),
        nextDueDate: dueDate,
        cycle:       'MONTHLY',
        description: price.description,
        externalReference: `${tenantId}::${input.product}`,
        creditCard,
        creditCardHolderInfo,
      })
    }
  } catch (e) {
    console.error('[subscribeToProduct] criar subscription Asaas falhou:', e)
    const msg = e instanceof Error ? e.message : 'Erro ao criar assinatura no gateway.'
    // Erros comuns: cartão recusado, CVV errado, limite, etc.
    return { ok: false, error: msg.includes('Asaas') ? msg : 'Erro ao processar pagamento. Verifique os dados.' }
  }

  // ── 5. Upsert local em subscriptions ────────────────────────────────────
  // Decisão de status:
  // - Se estava em 'trial' válido (não expirado) → mantém trial até pagar.
  //   Assim user continua usando o app enquanto Asaas processa pagamento.
  // - Senão → 'inactive' (sem acesso até confirmar pagamento)
  //
  // Webhook PAYMENT_RECEIVED finaliza: status='active', trial_ends_at=null.
  const trialActive = existingSub?.status === 'trial'
                       && existingSub.trial_ends_at
                       && new Date(existingSub.trial_ends_at) > new Date()
  // price_cents salvo localmente reflete o que cliente paga POR CICLO:
  // - MONTHLY: preço mensal
  // - YEARLY: preço anual cheio (porque renovação cobra cheio)
  const localPriceCents = cycle === 'YEARLY' && yearlyPrice ? yearlyPrice.fullCents : price.priceCents
  // next_due_date: pra YEARLY a sub renova só em 1 ano (cobrança avulsa
  // de hoje é separada). Pra MONTHLY usa o dueDate de hoje.
  const localNextDueDate = cycle === 'YEARLY'
    ? new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().slice(0, 10)
    : dueDate

  const subRow = {
    tenant_id:             tenantId,
    product:               input.product,
    plan_name:             input.plan,
    price_cents:           localPriceCents,
    status:                trialActive ? 'trial' : 'inactive',
    asaas_subscription_id: asaasSub.id,
    payment_method:        billingType,
    next_due_date:         localNextDueDate,
    billing_cycle:         cycle,
    trial_ends_at:         trialActive ? existingSub!.trial_ends_at : null,
  }

  const { error: upsertErr } = await sb
    .from('subscriptions')
    .upsert(subRow, { onConflict: 'tenant_id,product' })

  if (upsertErr) {
    // Asaas já criou — não dá rollback fácil. Loga e segue (admin reconcilia).
    console.error('[subscribeToProduct] upsert local falhou:', upsertErr)
    return { ok: false, error: 'Assinatura criada no gateway mas erro ao registrar. Contate suporte.' }
  }

  // ── 6. Para cartão: confirma cobrança imediata + atualiza otimista ────
  // Asaas cobra cartão na hora. Em vez de esperar webhook (10-60s),
  // marcamos active local imediatamente quando confirmado.
  if (billingType === 'CREDIT_CARD') {
    // Pra YEARLY: a cobrança é o yearlyOneTimePayment (parcelado em 12x).
    // Pra MONTHLY: a cobrança é a 1ª da subscription.
    const checkPayment = yearlyOneTimePayment ?? await getSubscriptionFirstPayment(asaasSub.id)
    const paid = checkPayment && (checkPayment.status === 'CONFIRMED' || checkPayment.status === 'RECEIVED')

    if (paid) {
      // YEARLY: next_due_date já está setado pra +1 ano no upsert
      // MONTHLY: setamos pra +1 mês aqui
      const update: Record<string, unknown> = { status: 'active', trial_ends_at: null }
      if (cycle === 'MONTHLY') {
        const next = new Date()
        next.setMonth(next.getMonth() + 1)
        update.next_due_date = next.toISOString().slice(0, 10)
      }
      await sb.from('subscriptions')
        .update(update)
        .eq('tenant_id', tenantId)
        .eq('product', input.product)
    }

    void createNotification({
      userId:   user.id,
      tenantId: tenantId,
      type:     'subscription_active',
      title:    paid ? 'Pagamento confirmado!' : 'Pagamento em processamento',
      body:     paid
                  ? cycle === 'YEARLY'
                      ? `Plano anual ativo! Você economizou 10% no ${price.description}.`
                      : `Sua assinatura ${price.description} está ativa.`
                  : 'Assinatura criada. Confirmação chega em alguns instantes.',
      link:     '/configuracoes/assinatura',
    })

    revalidatePath('/configuracoes/assinatura')
    revalidatePath('/', 'layout')
    return {
      ok:                  true,
      asaasSubscriptionId: asaasSub.id,
      mode:                'card',
      chargedNow:          !!paid,
    }
  }

  // PIX: busca QR code da cobrança pra exibir inline no modal
  // YEARLY: QR do yearlyOneTimePayment (cobrança avulsa anual com desconto)
  // MONTHLY: QR da 1ª cobrança da subscription
  const paymentForQr = yearlyOneTimePayment ?? await getSubscriptionFirstPayment(asaasSub.id)
  const pixQrCode = paymentForQr ? await getPaymentPixQrCode(paymentForQr.id) : null
  const pixValueCents = cycle === 'YEARLY' && yearlyPrice ? yearlyPrice.discountedCents : price.priceCents

  void createNotification({
    userId:   user.id,
    tenantId: tenantId,
    type:     'subscription_active',
    title:    `Assinatura ${price.description} criada`,
    body:     cycle === 'YEARLY'
                ? `Pague o PIX anual com 10% off pra ativar — QR aberto na tela.`
                : 'Pague o PIX pra ativar — o QR code está aberto na tela.',
    link:     '/configuracoes/assinatura',
  })

  revalidatePath('/configuracoes/assinatura')

  return {
    ok:                  true,
    asaasSubscriptionId: asaasSub.id,
    mode:                'pix',
    pixQrCode,
    paymentValue:        centsToReais(pixValueCents),
  }
}

/**
 * Sincroniza status de subscriptions locais com o Asaas. Útil se o webhook
 * atrasou ou falhou. Pra cada sub do tenant que não está active/cancelled,
 * busca o pagamento mais recente no Asaas e atualiza o status local se
 * tiver sido pago.
 *
 * Idempotente — pode ser chamada várias vezes sem efeito colateral.
 */
export async function syncSubscriptionsWithAsaas(): Promise<{ updated: number }> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const { data: subs } = await sb
    .from('subscriptions')
    .select('id, asaas_subscription_id, status')
    .eq('tenant_id', tenantId)
    .not('asaas_subscription_id', 'is', null)
    .in('status', ['inactive', 'trial', 'late'])

  if (!subs || subs.length === 0) return { updated: 0 }

  let updated = 0
  for (const sub of subs as { id: string; asaas_subscription_id: string }[]) {
    try {
      const payment = await getSubscriptionFirstPayment(sub.asaas_subscription_id)
      if (payment && (payment.status === 'CONFIRMED' || payment.status === 'RECEIVED')) {
        const next = new Date()
        next.setMonth(next.getMonth() + 1)
        await sb.from('subscriptions')
          .update({
            status:        'active',
            trial_ends_at: null,
            next_due_date: next.toISOString().slice(0, 10),
          })
          .eq('id', sub.id)
        updated++
      }
    } catch (e) {
      console.error('[syncSubscriptionsWithAsaas] sync falhou pra', sub.id, e)
    }
  }

  if (updated > 0) {
    revalidatePath('/configuracoes/assinatura')
    revalidatePath('/', 'layout')
  }
  return { updated }
}

/**
 * Cancela uma assinatura ativa. Asaas para de gerar cobranças, status local
 * vira 'cancelled'. Cliente perde acesso quando o ciclo atual expirar
 * (`next_due_date`).
 */
export async function cancelSubscriptionAsaas(product: Product): Promise<{ ok: boolean; error?: string }> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)
  if (user.app_metadata?.tenant_role !== 'owner') {
    return { ok: false, error: 'Apenas o dono pode cancelar assinaturas.' }
  }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const { data: sub } = await sb
    .from('subscriptions')
    .select('id, asaas_subscription_id')
    .eq('tenant_id', tenantId)
    .eq('product', product)
    .maybeSingle()

  if (!sub) return { ok: false, error: 'Assinatura não encontrada.' }

  if (sub.asaas_subscription_id) {
    try {
      await cancelAsaasSubscription(sub.asaas_subscription_id)
    } catch (e) {
      console.error('[cancelSubscriptionAsaas] erro Asaas:', e)
      // segue assim mesmo: marca local como cancelada
    }
  }

  const { error: updErr } = await sb
    .from('subscriptions')
    .update({ status: 'cancelled' })
    .eq('id', sub.id)

  if (updErr) {
    console.error('[cancelSubscriptionAsaas] update local falhou:', updErr)
    return { ok: false, error: 'Erro ao registrar cancelamento.' }
  }

  revalidatePath('/configuracoes/assinatura')
  return { ok: true }
}

// ── Upgrade com cobrança proporcional ─────────────────────────────────────
// Modelo (igual Stripe/Claude Code):
// 1. Cliente está em PlanoAtual (ex: Básico R$97), pagou no início do ciclo
// 2. No dia X de 30, decide upgrade pra PlanoNovo (ex: Premium R$197)
// 3. Crédito pelos dias não usados: oldPrice * (daysRemaining/30)
// 4. Cobrança imediata: newPrice - credit
// 5. Ciclo reinicia hoje → próxima cobrança em 30 dias com newPrice cheio
//
// Observações:
// - Se cliente está em trial → muda plano sem cobrança (paga full ao converter)
// - Se cliente tem sub pendente (inactive sem pagar) → cancela pendente,
//   começa novo fluxo de subscribe (não é upgrade)
// - Downgrade: tratado separadamente abaixo (vale só no próximo ciclo)

export type UpgradePreview = {
  ok:                   true
  currentPlan:          Plan
  currentPriceCents:    number
  newPlan:              Plan
  newPriceCents:        number
  daysUsed:             number             // dias já consumidos do ciclo atual
  daysRemaining:        number             // dias não usados
  creditCents:          number             // crédito proporcional do plano antigo
  proratedChargeCents:  number             // valor a cobrar agora (newPrice - credit)
  nextDueDate:          string             // YYYY-MM-DD (hoje + 30 dias)
  paymentMethod:        'PIX' | 'CREDIT_CARD'
} | { ok: false; error: string }

const PLAN_RANK: Record<Plan, number> = { basico: 0, pro: 1, premium: 2 }

/** Calcula a prévia do upgrade SEM efetivar nenhuma cobrança. UI usa
 *  esse resultado pra mostrar "vai cobrar R$X agora" antes de confirmar. */
export async function previewUpgrade(
  product: Product,
  newPlan: Plan,
): Promise<UpgradePreview> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)
  if (user.app_metadata?.tenant_role !== 'owner') {
    return { ok: false, error: 'Apenas o dono pode mudar plano.' }
  }

  const newPrice = getPrice(product, newPlan)
  if (!newPrice) return { ok: false, error: 'Plano inválido.' }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const { data: sub } = await sb
    .from('subscriptions')
    .select('plan_name, price_cents, status, payment_method, next_due_date')
    .eq('tenant_id', tenantId)
    .eq('product', product)
    .maybeSingle()

  if (!sub) return { ok: false, error: 'Assinatura não encontrada.' }
  if (sub.status !== 'active') {
    return { ok: false, error: 'Upgrade só está disponível pra assinaturas ativas.' }
  }
  if (sub.plan_name === newPlan) {
    return { ok: false, error: 'Você já está nesse plano.' }
  }

  // Bloqueia downgrade aqui — fluxo separado
  const currentRank = PLAN_RANK[sub.plan_name as Plan] ?? 0
  if (PLAN_RANK[newPlan] < currentRank) {
    return { ok: false, error: 'Downgrade só vale no próximo ciclo. Use o botão dedicado.' }
  }

  const oldPriceCents = sub.price_cents as number
  const newPriceCents = newPrice.priceCents

  // Calcula dias do ciclo atual: assume 30 dias (consistente com Asaas MONTHLY)
  // dueDate = data da próxima cobrança original; cycleStart = dueDate - 30
  const dueDate = sub.next_due_date ? new Date(sub.next_due_date as string) : null
  if (!dueDate) {
    // Fallback: se não tem next_due_date salvo, assume cycle inteiro restante
    const next = new Date()
    next.setMonth(next.getMonth() + 1)
    return {
      ok:                  true,
      currentPlan:         sub.plan_name as Plan,
      currentPriceCents:   oldPriceCents,
      newPlan,
      newPriceCents,
      daysUsed:            0,
      daysRemaining:       30,
      creditCents:         oldPriceCents,    // crédito = valor inteiro (não usou nada)
      proratedChargeCents: Math.max(0, newPriceCents - oldPriceCents),
      nextDueDate:         next.toISOString().slice(0, 10),
      paymentMethod:       (sub.payment_method as 'PIX' | 'CREDIT_CARD') ?? 'PIX',
    }
  }

  const cycleStart = new Date(dueDate)
  cycleStart.setDate(cycleStart.getDate() - 30)
  const now = new Date()
  const msPerDay = 1000 * 60 * 60 * 24
  let daysUsed = Math.max(0, Math.floor((now.getTime() - cycleStart.getTime()) / msPerDay))
  if (daysUsed > 30) daysUsed = 30
  const daysRemaining = 30 - daysUsed

  // Crédito = valor proporcional dos dias NÃO USADOS no plano antigo
  const creditCents = Math.round((oldPriceCents * daysRemaining) / 30)
  // Cobrança = novo plano cheio menos crédito (mínimo 0)
  const proratedChargeCents = Math.max(0, newPriceCents - creditCents)

  const nextDue = new Date()
  nextDue.setDate(nextDue.getDate() + 30)

  return {
    ok:                  true,
    currentPlan:         sub.plan_name as Plan,
    currentPriceCents:   oldPriceCents,
    newPlan,
    newPriceCents,
    daysUsed,
    daysRemaining,
    creditCents,
    proratedChargeCents,
    nextDueDate:         nextDue.toISOString().slice(0, 10),
    paymentMethod:       (sub.payment_method as 'PIX' | 'CREDIT_CARD') ?? 'PIX',
  }
}

export type ExecuteUpgradeResult =
  | { ok: true;  mode: 'pix';  pixQrCode: AsaasPixQrCode | null; chargeValueCents: number }
  | { ok: true;  mode: 'card'; chargeValueCents: number; chargedNow: boolean }
  | { ok: true;  mode: 'free'; message: string }    // upgrade sem cobrança (caso credit >= newPrice)
  | { ok: false; error: string }

/** Executa upgrade: cancela sub antiga no Asaas, cria nova no novo plano,
 *  e cobra a diferença proporcional via cobrança avulsa. */
export async function executeUpgrade(
  product: Product,
  newPlan: Plan,
): Promise<ExecuteUpgradeResult> {
  const preview = await previewUpgrade(product, newPlan)
  if (!preview.ok) return { ok: false, error: preview.error }

  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  // Carrega tenant e sub atual
  const [{ data: tenant }, { data: sub }] = await Promise.all([
    sb.from('tenants').select('asaas_customer_id').eq('id', tenantId).maybeSingle(),
    sb.from('subscriptions').select('id, asaas_subscription_id, payment_method')
      .eq('tenant_id', tenantId).eq('product', product).maybeSingle(),
  ])

  if (!tenant?.asaas_customer_id || !sub?.asaas_subscription_id) {
    return { ok: false, error: 'Dados de cobrança não encontrados.' }
  }

  // 1. Cancela sub antiga no Asaas
  try {
    await cancelAsaasSubscription(sub.asaas_subscription_id)
  } catch (e) {
    console.warn('[executeUpgrade] cancelar sub antiga falhou (segue):', e)
  }

  // 2. Cria sub nova com o novo plano (próxima cobrança em 30 dias)
  const newSubInput = {
    customer:    tenant.asaas_customer_id,
    billingType: preview.paymentMethod as AsaasBillingType,
    value:       centsToReais(preview.newPriceCents),
    nextDueDate: preview.nextDueDate,
    cycle:       'MONTHLY' as const,
    description: getPrice(product, newPlan)!.description,
    externalReference: `${tenantId}::${product}`,
  }

  let newAsaasSub
  try {
    newAsaasSub = await createAsaasSubscription(newSubInput)
  } catch (e) {
    console.error('[executeUpgrade] criar nova sub falhou:', e)
    return { ok: false, error: 'Erro ao criar nova assinatura no gateway.' }
  }

  // 3. Atualiza local: novo plano, novo asaas_subscription_id, novo due
  await sb.from('subscriptions')
    .update({
      plan_name:             newPlan,
      price_cents:           preview.newPriceCents,
      asaas_subscription_id: newAsaasSub.id,
      next_due_date:         preview.nextDueDate,
      // status continua 'active' — user já tinha acesso, agora upgrade
    })
    .eq('id', sub.id)

  // 4. Cobra a diferença proporcional como one-time payment
  if (preview.proratedChargeCents <= 0) {
    // Nada a cobrar (caso raro: crédito >= preço novo)
    revalidatePath('/configuracoes/assinatura')
    revalidatePath('/', 'layout')
    void createNotification({
      userId: user.id, tenantId, type: 'subscription_active',
      title: 'Plano atualizado!',
      body: `Você agora está no plano ${newPlan}. Sem cobrança extra agora — crédito do plano anterior cobriu.`,
      link: '/configuracoes/assinatura',
    })
    return { ok: true, mode: 'free', message: 'Upgrade aplicado sem cobrança extra.' }
  }

  let oneTimePayment
  try {
    oneTimePayment = await createAsaasOneTimePayment({
      customer:    tenant.asaas_customer_id,
      billingType: preview.paymentMethod as AsaasBillingType,
      value:       centsToReais(preview.proratedChargeCents),
      dueDate:     asaasToday(),
      description: `Upgrade ${preview.currentPlan} → ${newPlan} (proporcional)`,
      externalReference: `${tenantId}::${product}::upgrade`,
    })
  } catch (e) {
    console.error('[executeUpgrade] criar one-time payment falhou:', e)
    return { ok: false, error: 'Upgrade aplicado mas erro ao gerar cobrança da diferença. Contate suporte.' }
  }

  if (preview.paymentMethod === 'CREDIT_CARD') {
    const paid = oneTimePayment.status === 'CONFIRMED' || oneTimePayment.status === 'RECEIVED'
    void createNotification({
      userId: user.id, tenantId, type: 'subscription_active',
      title: paid ? 'Upgrade confirmado!' : 'Upgrade processando',
      body: paid
        ? `Plano ${newPlan} ativo! Foi cobrado R$${preview.proratedChargeCents/100} (proporcional).`
        : `Upgrade pra ${newPlan} criado. Confirmação chega em alguns instantes.`,
      link: '/configuracoes/assinatura',
    })
    revalidatePath('/configuracoes/assinatura')
    revalidatePath('/', 'layout')
    return { ok: true, mode: 'card', chargeValueCents: preview.proratedChargeCents, chargedNow: paid }
  }

  // PIX: busca QR code da cobrança avulsa
  const pixQrCode = await getPaymentPixQrCode(oneTimePayment.id)
  void createNotification({
    userId: user.id, tenantId, type: 'subscription_active',
    title: 'Upgrade quase pronto!',
    body: `Pague o PIX de R$${preview.proratedChargeCents/100} (proporcional) pra ativar o plano ${newPlan}.`,
    link: '/configuracoes/assinatura',
  })
  revalidatePath('/configuracoes/assinatura')
  return {
    ok:               true,
    mode:             'pix',
    pixQrCode,
    chargeValueCents: preview.proratedChargeCents,
  }
}

// ── Downgrade: agendado pro próximo ciclo (sem reembolso) ────────────────
// Cliente continua usando plano atual + features até a data de vencimento.
// Webhook PAYMENT_RECEIVED ao receber próxima cobrança aplica o pending_plan.

export type DowngradePreview = {
  ok:               true
  currentPlan:      Plan
  currentPriceCents: number
  newPlan:          Plan
  newPriceCents:    number
  effectiveDate:    string             // YYYY-MM-DD — quando vai virar
} | { ok: false; error: string }

export async function previewDowngrade(
  product: Product,
  newPlan: Plan,
): Promise<DowngradePreview> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)
  if (user.app_metadata?.tenant_role !== 'owner') {
    return { ok: false, error: 'Apenas o dono pode mudar plano.' }
  }

  const newPrice = getPrice(product, newPlan)
  if (!newPrice) return { ok: false, error: 'Plano inválido.' }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const { data: sub } = await sb
    .from('subscriptions')
    .select('plan_name, price_cents, status, next_due_date')
    .eq('tenant_id', tenantId)
    .eq('product', product)
    .maybeSingle()

  if (!sub) return { ok: false, error: 'Assinatura não encontrada.' }
  if (sub.status !== 'active') {
    return { ok: false, error: 'Downgrade só está disponível pra assinaturas ativas.' }
  }
  if (sub.plan_name === newPlan) {
    return { ok: false, error: 'Você já está nesse plano.' }
  }

  const currentRank = PLAN_RANK[sub.plan_name as Plan] ?? 0
  if (PLAN_RANK[newPlan] >= currentRank) {
    return { ok: false, error: 'Pra plano superior use o fluxo de upgrade.' }
  }

  return {
    ok:               true,
    currentPlan:      sub.plan_name as Plan,
    currentPriceCents: sub.price_cents,
    newPlan,
    newPriceCents:    newPrice.priceCents,
    effectiveDate:    sub.next_due_date ?? '',
  }
}

/** Agenda downgrade pro próximo ciclo. Não cobra nada agora. */
export async function executeDowngrade(
  product: Product,
  newPlan: Plan,
): Promise<{ ok: true; effectiveDate: string } | { ok: false; error: string }> {
  const preview = await previewDowngrade(product, newPlan)
  if (!preview.ok) return { ok: false, error: preview.error }

  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const { data: sub } = await sb
    .from('subscriptions')
    .select('id, asaas_subscription_id')
    .eq('tenant_id', tenantId)
    .eq('product', product)
    .maybeSingle()

  if (!sub?.asaas_subscription_id) {
    return { ok: false, error: 'Subscription do Asaas não encontrada.' }
  }

  const newPrice = getPrice(product, newPlan)!

  // Atualiza valor no Asaas (próxima cobrança usa o novo valor)
  try {
    await updateAsaasSubscription(sub.asaas_subscription_id, {
      value:       centsToReais(newPrice.priceCents),
      description: newPrice.description,
    })
  } catch (e) {
    console.error('[executeDowngrade] update Asaas falhou:', e)
    return { ok: false, error: 'Erro ao atualizar valor no gateway.' }
  }

  // Salva pending no banco (plan_name continua o atual até webhook)
  await sb.from('subscriptions')
    .update({
      pending_plan:        newPlan,
      pending_price_cents: newPrice.priceCents,
    })
    .eq('id', sub.id)

  void createNotification({
    userId: user.id, tenantId, type: 'subscription_active',
    title: 'Downgrade agendado',
    body: `Seu plano vira ${newPlan} a partir de ${preview.effectiveDate}. Até lá, você continua com tudo do plano atual.`,
    link: '/configuracoes/assinatura',
  })

  revalidatePath('/configuracoes/assinatura')
  return { ok: true, effectiveDate: preview.effectiveDate }
}

/** Cancela um downgrade pendente — volta ao plano atual no Asaas. */
export async function cancelPendingDowngrade(
  product: Product,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)
  if (user.app_metadata?.tenant_role !== 'owner') {
    return { ok: false, error: 'Apenas o dono pode mudar plano.' }
  }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  const { data: sub } = await sb
    .from('subscriptions')
    .select('id, asaas_subscription_id, plan_name, price_cents, pending_plan')
    .eq('tenant_id', tenantId)
    .eq('product', product)
    .maybeSingle()

  if (!sub?.pending_plan) {
    return { ok: false, error: 'Não há downgrade pendente.' }
  }

  // Volta valor da sub Asaas pro plano atual (pre-downgrade)
  if (sub.asaas_subscription_id) {
    try {
      const currentPrice = getPrice(product, sub.plan_name as Plan)
      await updateAsaasSubscription(sub.asaas_subscription_id, {
        value:       centsToReais(sub.price_cents),
        description: currentPrice?.description ?? `${product} ${sub.plan_name}`,
      })
    } catch (e) {
      console.error('[cancelPendingDowngrade] update Asaas falhou:', e)
    }
  }

  // Limpa pending no banco
  await sb.from('subscriptions')
    .update({ pending_plan: null, pending_price_cents: null })
    .eq('id', sub.id)

  void createNotification({
    userId: user.id, tenantId, type: 'subscription_active',
    title: 'Downgrade cancelado',
    body: 'Você continua no plano atual sem mudanças.',
    link: '/configuracoes/assinatura',
  })

  revalidatePath('/configuracoes/assinatura')
  return { ok: true }
}
