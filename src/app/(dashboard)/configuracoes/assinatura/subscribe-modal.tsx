'use client'

/**
 * Modal de assinatura — checkout in-app (Opção B).
 *
 * Fluxo:
 * 1. Etapa "form": user escolhe plano + método + (cartão ou PIX)
 *    - Se PIX: precisa só de CPF/CNPJ + celular
 *    - Se Cartão: precisa cartão completo + endereço (CEP + número)
 * 2. Submit chama subscribeToProduct (server action)
 *    - PIX: retorna QR code → mostra inline no modal
 *    - Cartão: retorna chargedNow=true → mostra sucesso
 * 3. Etapa "pix-qr": mostra QR code + código copia-e-cola + valor
 *    - Botão "Já paguei" fecha o modal
 *    - Webhook vai atualizar status pra 'active' quando Asaas confirmar
 * 4. Etapa "card-success": mostra confirmação + status="processando"
 */

import { useState, useEffect, useMemo } from 'react'
import {
  X, Loader2, QrCode, CreditCard, CheckCircle2, Copy, Check,
  Shield, Lock, Sparkles, Star, Zap, Crown, ShieldCheck, RefreshCcw,
} from 'lucide-react'
import { subscribeToProduct } from '@/actions/billing'
import {
  fmtBRL, plansForProduct, featuresFor, getYearlyPrice, YEARLY_INSTALLMENTS,
  type Product, type Plan, type BillingCycle,
} from '@/lib/pricing'
import { toast } from 'sonner'
import type { AsaasPixQrCode } from '@/lib/asaas'

type Props = {
  open:     boolean
  onClose:  () => void
  product:  Product
  productLabel: string
  hasCpfCnpj: boolean
}

/** Formata CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00). */
function formatCpfCnpj(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 14)
  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

/** Formata número de cartão em grupos de 4. */
function formatCardNumber(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 ')
}

/** Formata CEP 00000-000. */
function formatCep(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8)
  return d.replace(/(\d{5})(\d)/, '$1-$2')
}

/** Formata validade MM/AA enquanto digita. */
function formatExpiry(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 4)
  if (d.length < 3) return d
  return `${d.slice(0, 2)}/${d.slice(2)}`
}

type Step = 'form' | 'pix-qr' | 'card-success'

export function SubscribeModal({ open, onClose, product, productLabel, hasCpfCnpj }: Props) {
  const plans = useMemo(() => plansForProduct(product), [product])
  const [step, setStep] = useState<Step>('form')

  // Form state
  const [plan, setPlan] = useState<Plan>(plans[0]?.plan ?? 'basico')
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('MONTHLY')
  const [paymentMethod, setPaymentMethod] = useState<'PIX' | 'CREDIT_CARD'>('PIX')
  const [fullName, setFullName] = useState('')
  const [cpfCnpj, setCpfCnpj] = useState('')
  const [phone, setPhone] = useState('')
  // Card fields
  const [cardNumber, setCardNumber] = useState('')
  const [cardHolder, setCardHolder] = useState('')
  const [cardExpiry, setCardExpiry] = useState('')
  const [cardCcv, setCardCcv] = useState('')
  const [cep, setCep] = useState('')
  const [addressNumber, setAddressNumber] = useState('')
  const [loading, setLoading] = useState(false)

  // PIX QR state
  const [pixQr, setPixQr] = useState<AsaasPixQrCode | null>(null)
  const [pixValue, setPixValue] = useState(0)
  const [copiedPix, setCopiedPix] = useState(false)

  useEffect(() => {
    if (open) {
      setStep('form')
      setPlan(plans[0]?.plan ?? 'basico')
      setBillingCycle('MONTHLY')
      setPaymentMethod('PIX')
      setFullName('')
      setCpfCnpj('')
      setPhone('')
      setCardNumber(''); setCardHolder(''); setCardExpiry(''); setCardCcv('')
      setCep(''); setAddressNumber('')
      setPixQr(null); setPixValue(0); setCopiedPix(false)
    }
  }, [open, product, plans])

  if (!open) return null

  const selected = plans.find(p => p.plan === plan)

  async function handleSubmit() {
    // Validações pré-server
    if (fullName.trim().length < 3) {
      toast.error('Informe seu nome completo.')
      return
    }
    if (phone.replace(/\D/g, '').length < 10) {
      toast.error('Informe um celular válido com DDD.')
      return
    }
    if (!hasCpfCnpj) {
      const digits = cpfCnpj.replace(/\D/g, '')
      if (digits.length !== 11 && digits.length !== 14) {
        toast.error('Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.')
        return
      }
    }
    if (paymentMethod === 'CREDIT_CARD') {
      if (cardNumber.replace(/\D/g, '').length < 13) {
        toast.error('Número do cartão inválido.')
        return
      }
      if (!cardHolder.trim()) { toast.error('Informe o nome impresso no cartão.'); return }
      const exp = cardExpiry.replace(/\D/g, '')
      if (exp.length !== 4) { toast.error('Validade do cartão inválida (MM/AA).'); return }
      if (cardCcv.length < 3) { toast.error('CCV inválido.'); return }
      if (cep.replace(/\D/g, '').length !== 8) { toast.error('CEP inválido.'); return }
      if (!addressNumber.trim()) { toast.error('Informe o número do endereço.'); return }
    }

    setLoading(true)
    const exp = cardExpiry.replace(/\D/g, '')
    const expMonth = exp.slice(0, 2)
    const expYear  = exp.slice(2, 4) ? `20${exp.slice(2, 4)}` : ''

    const res = await subscribeToProduct({
      product, plan, paymentMethod,
      billingCycle,
      fullName,
      cpfCnpj: hasCpfCnpj ? undefined : cpfCnpj,
      phone,
      creditCard: paymentMethod === 'CREDIT_CARD' ? {
        holderName:  cardHolder,
        number:      cardNumber.replace(/\D/g, ''),
        expiryMonth: expMonth,
        expiryYear:  expYear,
        ccv:         cardCcv,
      } : undefined,
      postalCode:    paymentMethod === 'CREDIT_CARD' ? cep : undefined,
      addressNumber: paymentMethod === 'CREDIT_CARD' ? addressNumber : undefined,
    })
    setLoading(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }

    if (res.mode === 'pix') {
      setPixQr(res.pixQrCode)
      setPixValue(res.paymentValue)
      setStep('pix-qr')
    } else {
      // Cartão cobrado imediatamente
      toast.success('Pagamento processado!')
      setStep('card-success')
    }
  }

  function handleCopyPix() {
    if (!pixQr) return
    navigator.clipboard.writeText(pixQr.payload)
    setCopiedPix(true)
    toast.success('Código PIX copiado!')
    setTimeout(() => setCopiedPix(false), 2500)
  }

  // ── Render: PIX QR step ───────────────────────────────────────────────
  if (step === 'pix-qr' && pixQr) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
        <div className="rounded-2xl border w-full max-w-md max-h-[95vh] overflow-y-auto"
          style={{ background: '#1B2638', borderColor: '#3A4868' }}
          onClick={e => e.stopPropagation()}>

          {/* Header com gradient */}
          <div className="relative px-6 pt-5 pb-4 border-b"
            style={{
              background: 'linear-gradient(180deg, rgba(16,185,129,.1) 0%, transparent 100%)',
              borderColor: '#2A3650',
            }}>
            <button onClick={onClose} className="absolute top-4 right-4 p-1 rounded hover:bg-white/5"
              style={{ color: '#94A3B8' }}><X className="h-5 w-5" /></button>
            <div className="flex items-center gap-2 mb-1">
              <QrCode className="h-5 w-5" style={{ color: '#10B981' }} />
              <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#10B981' }}>
                Falta só o pagamento
              </p>
            </div>
            <h3 className="text-xl font-bold" style={{ color: '#F8FAFC' }}>Pagar com PIX</h3>
            <p className="text-xs mt-1" style={{ color: '#CBD5E1' }}>
              Pague em segundos pelo app do seu banco
            </p>
          </div>

          <div className="p-6 space-y-4">
            {/* Valor em destaque */}
            <div className="text-center rounded-xl border p-4"
              style={{ background: 'rgba(16,185,129,.06)', borderColor: 'rgba(16,185,129,.3)' }}>
              <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#94A3B8' }}>
                Total a pagar
              </p>
              <p className="text-4xl font-bold font-mono mt-1" style={{ color: '#10B981' }}>
                {fmtBRL(pixValue * 100)}
              </p>
              <p className="text-[10px] mt-1" style={{ color: '#CBD5E1' }}>
                Cobrança recorrente mensal · próxima em 30 dias
              </p>
            </div>

            {/* QR code com borda destacada */}
            <div className="rounded-xl bg-white p-5 flex items-center justify-center"
              style={{ boxShadow: '0 4px 20px rgba(16, 185, 129, 0.15)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:image/png;base64,${pixQr.encodedImage}`}
                alt="QR Code PIX" className="w-56 h-56" />
            </div>

            <p className="text-xs text-center font-semibold" style={{ color: '#F8FAFC' }}>
              📱 Escaneie o QR Code com o app do seu banco
            </p>

            {/* Código copia-e-cola */}
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest mb-2 block"
                style={{ color: '#94A3B8' }}>
                Ou copie o código PIX (Pix Copia e Cola)
              </label>
              <button onClick={handleCopyPix}
                className="w-full rounded-lg border p-3 flex items-center gap-2 transition-colors hover:bg-white/[0.02]"
                style={{
                  background: copiedPix ? 'rgba(16,185,129,.06)' : '#131C2A',
                  borderColor: copiedPix ? '#10B981' : '#2A3650',
                }}>
                <code className="text-[10px] flex-1 truncate font-mono text-left"
                  style={{ color: '#F8FAFC' }}>{pixQr.payload}</code>
                <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold"
                  style={{ color: copiedPix ? '#10B981' : '#22C55E' }}>
                  {copiedPix ? <><Check className="h-4 w-4" /> Copiado</> : <><Copy className="h-4 w-4" /> Copiar</>}
                </span>
              </button>
            </div>

            {/* Aviso de ativação automática */}
            <div className="rounded-lg border p-3 flex items-start gap-2.5"
              style={{ background: 'rgba(34,197,94,.06)', borderColor: 'rgba(34,197,94,.3)' }}>
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: '#22C55E' }} />
              <div>
                <p className="text-xs font-bold" style={{ color: '#22C55E' }}>
                  Ativação em segundos
                </p>
                <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: '#F8FAFC' }}>
                  Após pagar, sua assinatura é liberada automaticamente. Você pode fechar
                  essa tela — uma notificação chega no sino assim que confirmar.
                </p>
              </div>
            </div>

            {/* Garantia também aqui */}
            <div className="flex items-center justify-center gap-2 text-[10px]"
              style={{ color: '#94A3B8' }}>
              <Shield className="h-3.5 w-3.5" style={{ color: '#10B981' }} />
              Garantia de 7 dias · 100% reembolso se não gostar
            </div>

            <button onClick={onClose}
              className="w-full rounded-lg py-3 text-sm font-bold border transition-colors hover:bg-white/5"
              style={{ borderColor: '#2A3650', color: '#F8FAFC' }}>
              Fechar — pagar depois
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Render: Card success step ─────────────────────────────────────────
  if (step === 'card-success') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
        <div className="rounded-2xl border w-full max-w-md overflow-hidden"
          style={{ background: '#1B2638', borderColor: '#3A4868' }}
          onClick={e => e.stopPropagation()}>
          {/* Hero celebratório com gradient */}
          <div className="px-8 py-10 text-center"
            style={{
              background: 'linear-gradient(135deg, rgba(16,185,129,.15) 0%, rgba(34,197,94,.08) 100%)',
            }}>
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full mb-4"
              style={{
                background: 'linear-gradient(135deg, #10B981, #22C55E)',
                boxShadow: '0 8px 32px rgba(16, 185, 129, 0.4)',
              }}>
              <CheckCircle2 className="h-10 w-10" style={{ color: '#131C2A' }} strokeWidth={2.5} />
            </div>
            <p className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: '#10B981' }}>
              Pagamento aprovado
            </p>
            <h3 className="text-2xl font-bold" style={{ color: '#F8FAFC' }}>
              Bem-vindo ao {productLabel}! 🎉
            </h3>
            <p className="text-sm mt-2" style={{ color: '#CBD5E1' }}>
              Sua assinatura está ativa e todas as features liberadas.
            </p>
          </div>

          <div className="p-6 space-y-4">
            {/* Próximos passos */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest mb-3"
                style={{ color: '#94A3B8' }}>Comece agora:</p>
              <ul className="space-y-2.5">
                <NextStep num={1} title="Cadastre seus produtos" desc="Importe ou cadastre o estoque inicial" />
                <NextStep num={2} title="Cadastre seus clientes" desc="Ou deixe o app criar automaticamente nas vendas" />
                <NextStep num={3} title="Configure seus canais de venda" desc="Online, Loja física, Marketplace, etc." />
              </ul>
            </div>

            {/* Garantia recap */}
            <div className="rounded-lg border p-3 flex items-center gap-2.5"
              style={{ background: 'rgba(16,185,129,.04)', borderColor: 'rgba(16,185,129,.2)' }}>
              <Shield className="h-4 w-4 shrink-0" style={{ color: '#10B981' }} />
              <p className="text-[11px]" style={{ color: '#F8FAFC' }}>
                Lembre: você tem <strong>7 dias de garantia</strong>. Não gostou? Devolvemos 100%.
              </p>
            </div>

            <button onClick={() => { onClose(); window.location.href = '/obrigado' }}
              className="w-full rounded-xl py-3.5 text-sm font-bold transition-opacity hover:opacity-90"
              style={{
                background: 'linear-gradient(135deg, #22C55E, #10B981)',
                color: '#131C2A',
                boxShadow: '0 4px 16px rgba(16, 185, 129, 0.2)',
              }}>
              Começar a usar →
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Render: Form step (default) ───────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div className="rounded-2xl border w-full max-w-lg max-h-[95vh] overflow-y-auto"
        style={{ background: '#1B2638', borderColor: '#3A4868' }}
        onClick={e => e.stopPropagation()}>

        {/* Header com gradient + título */}
        <div className="relative px-6 pt-6 pb-4 border-b"
          style={{
            background: 'linear-gradient(180deg, rgba(16,185,129,.08) 0%, rgba(34,197,94,.04) 50%, transparent 100%)',
            borderColor: '#2A3650',
          }}>
          <button onClick={onClose} className="absolute top-4 right-4 p-1 rounded hover:bg-white/5"
            style={{ color: '#94A3B8' }}><X className="h-5 w-5" /></button>
          <p className="text-[11px] font-bold uppercase tracking-widest mb-1"
            style={{ color: '#10B981' }}>Assinar agora</p>
          <h3 className="text-2xl font-bold" style={{ color: '#F8FAFC' }}>{productLabel}</h3>
          <p className="text-xs mt-1" style={{ color: '#CBD5E1' }}>
            Comece em menos de 2 minutos. Cancele quando quiser.
          </p>
        </div>

        {/* Trust strip — garantia + segurança */}
        <div className="grid grid-cols-3 gap-2 px-6 py-3 border-b"
          style={{ background: '#131C2A', borderColor: '#2A3650' }}>
          <TrustBadge icon={ShieldCheck} label="Garantia 7 dias" sub="100% reembolso" color="#10B981" />
          <TrustBadge icon={RefreshCcw} label="Sem fidelidade" sub="Cancele quando" color="#22C55E" />
          <TrustBadge icon={Lock} label="Pagamento seguro" sub="Asaas + SSL" color="#F59E0B" />
        </div>

        <div className="p-6 space-y-5">
          {/* Toggle Mensal/Anual */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest mb-2 block"
              style={{ color: '#94A3B8' }}>Período da assinatura</label>
            <div className="grid grid-cols-2 gap-2 rounded-xl border p-1"
              style={{ background: '#131C2A', borderColor: '#2A3650' }}>
              <button type="button" onClick={() => setBillingCycle('MONTHLY')}
                className="rounded-lg py-2 text-sm font-bold transition-all"
                style={billingCycle === 'MONTHLY'
                  ? { background: 'linear-gradient(135deg, #22C55E, #10B981)', color: '#131C2A' }
                  : { background: 'transparent', color: '#CBD5E1' }}>
                Mensal
              </button>
              <button type="button" onClick={() => setBillingCycle('YEARLY')}
                className="rounded-lg py-2 text-sm font-bold transition-all relative"
                style={billingCycle === 'YEARLY'
                  ? { background: 'linear-gradient(135deg, #10B981, #22C55E)', color: '#131C2A' }
                  : { background: 'transparent', color: '#CBD5E1' }}>
                Anual
                <span className="absolute -top-2 -right-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: '#F59E0B', color: '#131C2A' }}>
                  -10%
                </span>
              </button>
            </div>
            {billingCycle === 'YEARLY' && (
              <p className="text-[11px] mt-2 text-center" style={{ color: '#10B981' }}>
                💰 Economize 10% pagando anual {paymentMethod === 'CREDIT_CARD' && `· em até ${YEARLY_INSTALLMENTS}x sem juros`}
              </p>
            )}
          </div>

          {/* Plano com features inline */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest mb-3 block"
              style={{ color: '#94A3B8' }}>1. Escolha seu plano</label>
            <div className="space-y-2.5">
              {plans.map((p, idx) => {
                const planFeatures = featuresFor(product, p.plan)
                const isPopular = plans.length === 3 && idx === 1
                const isPremium = p.plan === 'premium' && plans.length === 3
                const PlanIcon = p.plan === 'basico' ? Sparkles : p.plan === 'pro' ? Zap : Crown
                const accentColor = p.plan === 'premium' ? '#10B981' : p.plan === 'pro' ? '#22C55E' : '#CBD5E1'
                const isSelected = plan === p.plan
                // Cálculo do preço a exibir baseado no cycle
                const yearlyPrice = billingCycle === 'YEARLY' ? getYearlyPrice(product, p.plan) : null
                return (
                  <button key={p.plan} type="button" onClick={() => setPlan(p.plan)}
                    className="w-full rounded-xl border-2 p-4 text-left transition-all relative"
                    style={isSelected
                      ? { background: `${accentColor}10`, borderColor: accentColor, transform: 'scale(1.01)' }
                      : { background: '#131C2A', borderColor: '#2A3650' }}>
                    {(isPopular || isPremium) && !isSelected && (
                      <span className="absolute -top-2 right-3 text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded"
                        style={{ background: accentColor, color: '#131C2A' }}>
                        {isPremium ? '⭐ Melhor escolha' : 'Mais popular'}
                      </span>
                    )}
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2">
                        <PlanIcon className="h-4 w-4 shrink-0" style={{ color: accentColor }} />
                        <p className="text-base font-bold capitalize" style={{ color: '#F8FAFC' }}>
                          {p.plan === 'basico' ? 'Básico' : p.plan === 'pro' ? 'Pro' : 'Premium'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {yearlyPrice ? (
                          <>
                            {/* Preço cheio riscado */}
                            <p className="text-xs line-through font-mono leading-tight"
                              style={{ color: '#94A3B8' }}>
                              {fmtBRL(yearlyPrice.fullCents)}
                            </p>
                            {/* Preço com desconto */}
                            <p className="text-xl font-bold font-mono leading-tight"
                              style={{ color: isSelected ? accentColor : '#F8FAFC' }}>
                              {fmtBRL(yearlyPrice.discountedCents)}
                            </p>
                            <p className="text-[10px] mt-0.5" style={{ color: '#94A3B8' }}>/ano</p>
                            {paymentMethod === 'CREDIT_CARD' && (
                              <p className="text-[10px] font-mono" style={{ color: '#10B981' }}>
                                ou {YEARLY_INSTALLMENTS}x {fmtBRL(yearlyPrice.installmentCents)}
                              </p>
                            )}
                          </>
                        ) : (
                          <>
                            <p className="text-xl font-bold font-mono leading-none"
                              style={{ color: isSelected ? accentColor : '#F8FAFC' }}>
                              {fmtBRL(p.priceCents)}
                            </p>
                            <p className="text-[10px] mt-0.5" style={{ color: '#94A3B8' }}>/mês</p>
                          </>
                        )}
                      </div>
                    </div>
                    {planFeatures.length > 0 && (
                      <ul className="space-y-1 mt-2">
                        {planFeatures.slice(0, 3).map(f => (
                          <li key={f} className="text-[11px] flex items-start gap-1.5"
                            style={{ color: '#F8FAFC' }}>
                            <Check className="h-3 w-3 mt-0.5 shrink-0" style={{ color: accentColor }} />
                            {f}
                          </li>
                        ))}
                        {planFeatures.length > 3 && (
                          <li className="text-[10px] italic" style={{ color: '#94A3B8' }}>
                            + {planFeatures.length - 3} outros recursos
                          </li>
                        )}
                      </ul>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Pagamento */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest mb-2 block"
              style={{ color: '#94A3B8' }}>Forma de pagamento</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setPaymentMethod('PIX')}
                className="flex flex-col items-center gap-1 rounded-lg border py-3 px-2 transition-colors"
                style={paymentMethod === 'PIX'
                  ? { background: 'rgba(16,185,129,.08)', borderColor: '#10B981' }
                  : { background: '#131C2A', borderColor: '#2A3650' }}>
                <QrCode className="h-5 w-5" style={{ color: paymentMethod === 'PIX' ? '#10B981' : '#CBD5E1' }} />
                <span className="text-xs font-bold" style={{ color: '#F8FAFC' }}>PIX</span>
                <span className="text-[10px]" style={{ color: '#94A3B8' }}>Recomendado</span>
              </button>
              <button type="button" onClick={() => setPaymentMethod('CREDIT_CARD')}
                className="flex flex-col items-center gap-1 rounded-lg border py-3 px-2 transition-colors"
                style={paymentMethod === 'CREDIT_CARD'
                  ? { background: 'rgba(34,197,94,.08)', borderColor: '#22C55E' }
                  : { background: '#131C2A', borderColor: '#2A3650' }}>
                <CreditCard className="h-5 w-5" style={{ color: paymentMethod === 'CREDIT_CARD' ? '#22C55E' : '#CBD5E1' }} />
                <span className="text-xs font-bold" style={{ color: '#F8FAFC' }}>Cartão</span>
                <span className="text-[10px]" style={{ color: '#94A3B8' }}>Recorrente</span>
              </button>
            </div>
          </div>

          {/* Dados de contato — sempre obrigatórios */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest mb-2 block"
              style={{ color: '#94A3B8' }}>
              Nome completo <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <input type="text" value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Seu nome ou razão social"
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }} />
          </div>

          {/* CPF/CNPJ — só se tenant não tem ainda */}
          {!hasCpfCnpj && (
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest mb-2 block"
                style={{ color: '#94A3B8' }}>
                CPF ou CNPJ <span style={{ color: '#EF4444' }}>*</span>
              </label>
              <input type="text" value={cpfCnpj}
                onChange={e => setCpfCnpj(formatCpfCnpj(e.target.value))}
                placeholder="000.000.000-00"
                className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
                style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }} />
            </div>
          )}

          <div>
            <label className="text-[11px] font-bold uppercase tracking-widest mb-2 block"
              style={{ color: '#94A3B8' }}>
              Celular com DDD <span style={{ color: '#EF4444' }}>*</span>
            </label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
              placeholder="(79) 99999-9999"
              className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
              style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }} />
          </div>

          {/* Campos do cartão (só se CREDIT_CARD) */}
          {paymentMethod === 'CREDIT_CARD' && (
            <>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest mb-2 block"
                  style={{ color: '#94A3B8' }}>
                  Número do cartão <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <input type="text" inputMode="numeric" value={cardNumber}
                  onChange={e => setCardNumber(formatCardNumber(e.target.value))}
                  placeholder="0000 0000 0000 0000"
                  className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
                  style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }} />
              </div>

              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest mb-2 block"
                  style={{ color: '#94A3B8' }}>
                  Nome impresso <span style={{ color: '#EF4444' }}>*</span>
                </label>
                <input type="text" value={cardHolder}
                  onChange={e => setCardHolder(e.target.value.toUpperCase())}
                  placeholder="NOME COMO ESTÁ NO CARTÃO"
                  className="w-full rounded-lg border px-3 py-2 text-sm uppercase"
                  style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-widest mb-2 block"
                    style={{ color: '#94A3B8' }}>
                    Validade <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input type="text" inputMode="numeric" value={cardExpiry}
                    onChange={e => setCardExpiry(formatExpiry(e.target.value))}
                    placeholder="MM/AA"
                    className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
                    style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }} />
                </div>
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-widest mb-2 block"
                    style={{ color: '#94A3B8' }}>
                    CCV <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input type="text" inputMode="numeric" value={cardCcv}
                    onChange={e => setCardCcv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="000"
                    className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
                    style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-widest mb-2 block"
                    style={{ color: '#94A3B8' }}>
                    CEP <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input type="text" inputMode="numeric" value={cep}
                    onChange={e => setCep(formatCep(e.target.value))}
                    placeholder="00000-000"
                    className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
                    style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }} />
                </div>
                <div>
                  <label className="text-[11px] font-bold uppercase tracking-widest mb-2 block"
                    style={{ color: '#94A3B8' }}>
                    Número <span style={{ color: '#EF4444' }}>*</span>
                  </label>
                  <input type="text" value={addressNumber}
                    onChange={e => setAddressNumber(e.target.value.slice(0, 10))}
                    placeholder="123"
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }} />
                </div>
              </div>
            </>
          )}

          {/* Garantia 7 dias — banner persuasivo */}
          <div className="rounded-xl border-2 p-4 flex items-start gap-3"
            style={{ background: 'rgba(16,185,129,.06)', borderColor: 'rgba(16,185,129,.4)' }}>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{ background: 'rgba(16,185,129,.15)', border: '2px solid #10B981' }}>
              <Shield className="h-5 w-5" style={{ color: '#10B981' }} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold" style={{ color: '#10B981' }}>
                Garantia incondicional de 7 dias
              </p>
              <p className="text-[11px] mt-1 leading-relaxed" style={{ color: '#F8FAFC' }}>
                Se em até <strong>7 dias</strong> você não estiver satisfeito por qualquer motivo,
                <strong> devolvemos 100% do seu dinheiro</strong>. Sem perguntas, sem letra miúda.
              </p>
            </div>
          </div>

          {/* Resumo do pedido — destaque */}
          {selected && (() => {
            const yearly = billingCycle === 'YEARLY' ? getYearlyPrice(product, selected.plan) : null
            const totalCents = yearly ? yearly.discountedCents : selected.priceCents
            const isInstallment = yearly && paymentMethod === 'CREDIT_CARD'
            return (
              <div className="rounded-xl border-2 p-4 space-y-2"
                style={{ background: '#131C2A', borderColor: '#3A4868' }}>
                <div className="flex justify-between items-baseline">
                  <span className="text-xs" style={{ color: '#CBD5E1' }}>Plano</span>
                  <span className="text-sm font-bold capitalize" style={{ color: '#F8FAFC' }}>
                    {productLabel} {selected.plan === 'basico' ? 'Básico' : selected.plan === 'pro' ? 'Pro' : 'Premium'}
                  </span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-xs" style={{ color: '#CBD5E1' }}>Período</span>
                  <span className="text-xs font-bold" style={{ color: billingCycle === 'YEARLY' ? '#10B981' : '#F8FAFC' }}>
                    {billingCycle === 'YEARLY' ? 'Anual (10% off)' : 'Mensal'}
                  </span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-xs" style={{ color: '#CBD5E1' }}>Pagamento</span>
                  <span className="text-xs" style={{ color: '#F8FAFC' }}>
                    {paymentMethod === 'PIX'
                      ? (yearly ? 'PIX (1x à vista anual)' : 'PIX (recorrente mensal)')
                      : (yearly ? `Cartão ${YEARLY_INSTALLMENTS}x sem juros` : 'Cartão (recorrente mensal)')}
                  </span>
                </div>
                {yearly && (
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs" style={{ color: '#CBD5E1' }}>Você economiza</span>
                    <span className="text-xs font-bold font-mono" style={{ color: '#10B981' }}>
                      -{fmtBRL(yearly.savingsCents)}
                    </span>
                  </div>
                )}
                <div className="border-t pt-2 flex justify-between items-baseline"
                  style={{ borderColor: '#2A3650' }}>
                  <span className="text-sm font-bold" style={{ color: '#F8FAFC' }}>
                    Total {yearly ? 'do ano' : 'hoje'}
                  </span>
                  <div className="text-right">
                    <span className="text-2xl font-bold font-mono" style={{ color: '#10B981' }}>
                      {fmtBRL(totalCents)}
                    </span>
                    {isInstallment && (
                      <span className="text-[11px] block" style={{ color: '#22C55E' }}>
                        {YEARLY_INSTALLMENTS}x {fmtBRL(yearly!.installmentCents)} no cartão
                      </span>
                    )}
                    <span className="text-[10px] block" style={{ color: '#94A3B8' }}>
                      {yearly
                        ? '· renovação automática em 1 ano (preço cheio)'
                        : '/mês · próxima cobrança em 30 dias'}
                    </span>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* CTA gigante e claro */}
          <button onClick={handleSubmit} disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl py-4 text-base font-bold transition-all hover:opacity-90 disabled:opacity-50 shadow-lg"
            style={{
              background: 'linear-gradient(135deg, #22C55E, #10B981)',
              color: '#131C2A',
              boxShadow: '0 8px 24px rgba(16, 185, 129, 0.25)',
            }}>
            {loading ? (
              <><Loader2 className="h-5 w-5 animate-spin" /> Processando…</>
            ) : (
              paymentMethod === 'PIX'
                ? <><QrCode className="h-5 w-5" /> Gerar QR Code PIX</>
                : <><CreditCard className="h-5 w-5" /> Pagar com cartão</>
            )}
          </button>

          {/* Linha de selos de segurança embaixo do CTA */}
          <div className="flex items-center justify-center gap-4 pt-1">
            <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: '#94A3B8' }}>
              <Lock className="h-3 w-3" /> SSL 256-bit
            </span>
            <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: '#94A3B8' }}>
              <ShieldCheck className="h-3 w-3" /> PCI-DSS
            </span>
            <span className="inline-flex items-center gap-1 text-[10px]" style={{ color: '#94A3B8' }}>
              <Star className="h-3 w-3" /> Asaas
            </span>
          </div>

          <p className="text-[10px] text-center leading-relaxed" style={{ color: '#94A3B8' }}>
            Ao confirmar, você concorda com os <a href="https://smartgestao-site.vercel.app/termos" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: '#CBD5E1' }}>Termos de Uso</a> e{' '}
            <a href="https://smartgestao-site.vercel.app/privacidade" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: '#CBD5E1' }}>Política de Privacidade</a>.
            Pagamento processado com criptografia de ponta a ponta pelo Asaas.
          </p>
        </div>
      </div>
    </div>
  )
}

/** Badge pequeno de confiança (linha em cima do form). */
function TrustBadge({ icon: Icon, label, sub, color }: {
  icon: React.ElementType; label: string; sub: string; color: string
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <Icon className="h-4 w-4 mb-1" style={{ color }} />
      <p className="text-[10px] font-bold leading-tight" style={{ color: '#F8FAFC' }}>{label}</p>
      <p className="text-[9px] leading-tight" style={{ color: '#94A3B8' }}>{sub}</p>
    </div>
  )
}

/** Item de "próximos passos" exibido na tela de sucesso após cartão. */
function NextStep({ num, title, desc }: { num: number; title: string; desc: string }) {
  return (
    <li className="flex items-start gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
        style={{
          background: 'rgba(34,197,94,.12)',
          color: '#22C55E',
          border: '1px solid rgba(34,197,94,.3)',
        }}>
        {num}
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>{title}</p>
        <p className="text-[11px] mt-0.5" style={{ color: '#CBD5E1' }}>{desc}</p>
      </div>
    </li>
  )
}
