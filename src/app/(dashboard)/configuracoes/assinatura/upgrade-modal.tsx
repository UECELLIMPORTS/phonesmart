'use client'

/**
 * Modal de mudança de plano — cobre upgrade e downgrade.
 *
 * Fluxo:
 * 1. step='choose': lista todos os planos (atual destacado, outros como upgrade ↑ ou downgrade ↓)
 *    - Cada card mostra preço + features inclusas + cobrança calculada
 * 2. step='confirm': resumo da mudança escolhida
 * 3. step='pix-qr': QR code da cobrança avulsa (só upgrade pago via PIX)
 * 4. step='success': confirmação
 *
 * Upgrade: cobra diferença proporcional agora, ciclo reinicia.
 * Downgrade: agendado pro próximo ciclo (sem cobrança imediata).
 */

import { useState, useEffect } from 'react'
import {
  X, Loader2, CheckCircle2, ArrowUp, ArrowDown, Copy, Check, QrCode, Calendar,
} from 'lucide-react'
import { previewUpgrade, executeUpgrade, previewDowngrade, executeDowngrade } from '@/actions/billing'
import { fmtBRL, plansForProduct, featuresFor, type Product, type Plan } from '@/lib/pricing'
import { toast } from 'sonner'
import type { AsaasPixQrCode } from '@/lib/asaas'

type Props = {
  open:    boolean
  onClose: () => void
  product: Product
  productLabel: string
  currentPlan: Plan
}

const RANK: Record<Plan, number> = { basico: 0, pro: 1, premium: 2 }

type Step = 'choose' | 'confirm' | 'pix-qr' | 'success'
type Direction = 'upgrade' | 'downgrade'

type UpgradePreviewOK = {
  ok: true; currentPlan: Plan; currentPriceCents: number; newPlan: Plan; newPriceCents: number
  daysUsed: number; daysRemaining: number; creditCents: number; proratedChargeCents: number
  nextDueDate: string; paymentMethod: 'PIX' | 'CREDIT_CARD'
}
type DowngradePreviewOK = {
  ok: true; currentPlan: Plan; currentPriceCents: number; newPlan: Plan; newPriceCents: number
  effectiveDate: string
}

export function UpgradeModal({ open, onClose, product, productLabel, currentPlan }: Props) {
  const [step, setStep] = useState<Step>('choose')
  const [previews, setPreviews] = useState<Record<Plan, { dir: Direction; data: UpgradePreviewOK | DowngradePreviewOK | { error: string } }>>({} as never)
  // IMPORTANTE: começa como `true` pra cobrir o primeiro render antes do
  // useEffect rodar — se começasse como false, os cards tentariam acessar
  // previews vazios e quebrariam a tela.
  const [loadingPreviews, setLoadingPreviews] = useState(true)
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [executing, setExecuting] = useState(false)
  const [pixQr, setPixQr] = useState<AsaasPixQrCode | null>(null)
  const [chargeValue, setChargeValue] = useState(0)
  const [successTitle, setSuccessTitle] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [copied, setCopied] = useState(false)

  // Carrega previews de todos os planos diferentes do atual
  useEffect(() => {
    if (!open) return
    setStep('choose'); setSelectedPlan(null); setPixQr(null); setCopied(false)

    const otherPlans = plansForProduct(product).filter(p => p.plan !== currentPlan)
    setLoadingPreviews(true)
    Promise.all(otherPlans.map(async p => {
      const isUpgrade = RANK[p.plan] > RANK[currentPlan]
      try {
        if (isUpgrade) {
          const data = await previewUpgrade(product, p.plan)
          return [p.plan, { dir: 'upgrade' as const, data: data.ok ? data : { error: data.error } }] as const
        } else {
          const data = await previewDowngrade(product, p.plan)
          return [p.plan, { dir: 'downgrade' as const, data: data.ok ? data : { error: data.error } }] as const
        }
      } catch (e) {
        // Server action throw — não quebra a tela, mostra como erro no card
        return [p.plan, {
          dir: (isUpgrade ? 'upgrade' : 'downgrade') as Direction,
          data: { error: e instanceof Error ? e.message : 'Erro ao calcular' },
        }] as const
      }
    }))
      .then(results => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const map: any = {}
        for (const [plan, prev] of results) map[plan] = prev
        setPreviews(map)
      })
      .catch(err => {
        console.error('[UpgradeModal] previews falharam:', err)
        toast.error('Erro ao carregar opções de plano. Tente de novo.')
      })
      .finally(() => setLoadingPreviews(false))
  }, [open, product, currentPlan])

  if (!open) return null

  async function handleExecute() {
    if (!selectedPlan) return
    const prev = previews[selectedPlan]
    if (!prev || 'error' in prev.data) return

    setExecuting(true)
    if (prev.dir === 'upgrade') {
      const res = await executeUpgrade(product, selectedPlan)
      setExecuting(false)
      if (!res.ok) { toast.error(res.error); return }

      if (res.mode === 'free') {
        setSuccessTitle('Plano atualizado!')
        setSuccessMsg(res.message)
        setStep('success')
      } else if (res.mode === 'card') {
        setSuccessTitle('Upgrade concluído!')
        setChargeValue(res.chargeValueCents)
        setSuccessMsg(res.chargedNow
          ? `R$${(res.chargeValueCents/100).toFixed(2)} cobrado no cartão.`
          : 'Cobrança em processamento.')
        setStep('success')
      } else {
        setPixQr(res.pixQrCode)
        setChargeValue(res.chargeValueCents)
        setStep('pix-qr')
      }
    } else {
      const res = await executeDowngrade(product, selectedPlan)
      setExecuting(false)
      if (!res.ok) { toast.error(res.error); return }
      setSuccessTitle('Downgrade agendado')
      setSuccessMsg(`Você continua com o plano atual até ${formatDate(res.effectiveDate)}. A partir dessa data, vira ${selectedPlan}.`)
      setStep('success')
    }
  }

  function handleCopyPix() {
    if (!pixQr) return
    navigator.clipboard.writeText(pixQr.payload)
    setCopied(true)
    toast.success('Código PIX copiado!')
    setTimeout(() => setCopied(false), 2500)
  }

  // ── PIX QR step ─────────────────────────────────────────────────────────
  if (step === 'pix-qr' && pixQr) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
        <div className="rounded-2xl border w-full max-w-md max-h-[95vh] overflow-y-auto"
          style={{ background: '#1B2638', borderColor: '#3A4868' }}
          onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b"
            style={{ borderColor: '#2A3650' }}>
            <h3 className="text-lg font-bold flex items-center gap-2" style={{ color: '#F8FAFC' }}>
              <QrCode className="h-5 w-5" style={{ color: '#10B981' }} />
              Pagar diferença do upgrade
            </h3>
            <button onClick={onClose} className="p-1 rounded hover:bg-white/5"
              style={{ color: '#94A3B8' }}><X className="h-5 w-5" /></button>
          </div>
          <div className="p-6 space-y-4">
            <div className="text-center">
              <p className="text-xs" style={{ color: '#CBD5E1' }}>Total proporcional a pagar</p>
              <p className="text-3xl font-bold font-mono mt-1" style={{ color: '#10B981' }}>
                {fmtBRL(chargeValue)}
              </p>
            </div>
            <div className="rounded-xl bg-white p-4 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:image/png;base64,${pixQr.encodedImage}`}
                alt="QR Code PIX" className="w-56 h-56" />
            </div>
            <p className="text-xs text-center" style={{ color: '#CBD5E1' }}>
              Escaneie o QR Code com o app do seu banco
            </p>
            <div>
              <label className="text-[11px] font-bold uppercase tracking-widest mb-2 block"
                style={{ color: '#94A3B8' }}>Ou copie o código</label>
              <div className="rounded-lg border p-3 flex items-center gap-2"
                style={{ background: '#131C2A', borderColor: '#2A3650' }}>
                <code className="text-[10px] flex-1 truncate font-mono"
                  style={{ color: '#F8FAFC' }}>{pixQr.payload}</code>
                <button onClick={handleCopyPix}
                  className="shrink-0 p-2 rounded hover:bg-white/5 transition-colors"
                  style={{ color: copied ? '#10B981' : '#22C55E' }}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <button onClick={onClose}
              className="w-full rounded-lg py-3 text-sm font-bold border transition-colors hover:bg-white/5"
              style={{ borderColor: '#2A3650', color: '#F8FAFC' }}>Fechar</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Success step ────────────────────────────────────────────────────────
  if (step === 'success') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
        <div className="rounded-2xl border w-full max-w-md"
          style={{ background: '#1B2638', borderColor: '#3A4868' }}
          onClick={e => e.stopPropagation()}>
          <div className="p-8 text-center space-y-5">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
              style={{ background: 'rgba(16,185,129,.15)', border: '2px solid #10B981' }}>
              <CheckCircle2 className="h-8 w-8" style={{ color: '#10B981' }} />
            </div>
            <div>
              <h3 className="text-xl font-bold" style={{ color: '#F8FAFC' }}>{successTitle}</h3>
              <p className="text-sm mt-2" style={{ color: '#CBD5E1' }}>{successMsg}</p>
            </div>
            <button onClick={() => { onClose(); window.location.reload() }}
              className="w-full rounded-lg py-3 text-sm font-bold transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #22C55E, #10B981)', color: '#131C2A' }}>
              Continuar
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Confirm step ────────────────────────────────────────────────────────
  if (step === 'confirm' && selectedPlan && previews[selectedPlan] && !('error' in previews[selectedPlan].data)) {
    const prev = previews[selectedPlan]
    const isUpgrade = prev.dir === 'upgrade'
    const features = featuresFor(product, selectedPlan)
    const lostFeatures = isUpgrade ? [] : featuresFor(product, currentPlan).filter(f => !features.includes(f))

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
        <div className="rounded-2xl border w-full max-w-md max-h-[95vh] overflow-y-auto"
          style={{ background: '#1B2638', borderColor: '#3A4868' }}
          onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 z-10"
            style={{ background: '#1B2638', borderColor: '#2A3650' }}>
            <h3 className="text-lg font-bold flex items-center gap-2" style={{ color: '#F8FAFC' }}>
              {isUpgrade
                ? <ArrowUp className="h-5 w-5" style={{ color: '#10B981' }} />
                : <ArrowDown className="h-5 w-5" style={{ color: '#F59E0B' }} />}
              Confirmar {isUpgrade ? 'upgrade' : 'downgrade'}
            </h3>
            <button onClick={onClose} className="p-1 rounded hover:bg-white/5"
              style={{ color: '#94A3B8' }}><X className="h-5 w-5" /></button>
          </div>

          <div className="p-6 space-y-4">
            {/* Resumo */}
            <div className="rounded-lg border p-4 space-y-2"
              style={{ background: '#131C2A', borderColor: '#2A3650' }}>
              {isUpgrade ? (
                <>
                  {(() => {
                    const u = prev.data as UpgradePreviewOK
                    return (
                      <>
                        <Row label="Plano atual">
                          <span className="capitalize" style={{ color: '#F8FAFC' }}>{u.currentPlan}</span>
                          <span className="text-xs ml-2" style={{ color: '#CBD5E1' }}>({fmtBRL(u.currentPriceCents)}/mês)</span>
                        </Row>
                        <Row label="Novo plano">
                          <span className="capitalize font-bold" style={{ color: '#10B981' }}>{u.newPlan}</span>
                          <span className="text-xs ml-2" style={{ color: '#CBD5E1' }}>({fmtBRL(u.newPriceCents)}/mês)</span>
                        </Row>
                        <div className="border-t pt-2" style={{ borderColor: '#2A3650' }} />
                        <Row label="Dias usados"><span style={{ color: '#F8FAFC' }}>{u.daysUsed} de 30</span></Row>
                        <Row label="Crédito proporcional">
                          <span className="font-mono" style={{ color: '#10B981' }}>-{fmtBRL(u.creditCents)}</span>
                        </Row>
                        <Row label="Próxima cobrança">
                          <span className="font-mono text-xs" style={{ color: '#CBD5E1' }}>{formatDate(u.nextDueDate)}</span>
                        </Row>
                      </>
                    )
                  })()}
                </>
              ) : (
                <>
                  {(() => {
                    const d = prev.data as DowngradePreviewOK
                    return (
                      <>
                        <Row label="Plano atual">
                          <span className="capitalize" style={{ color: '#F8FAFC' }}>{d.currentPlan}</span>
                          <span className="text-xs ml-2" style={{ color: '#CBD5E1' }}>({fmtBRL(d.currentPriceCents)}/mês)</span>
                        </Row>
                        <Row label="Novo plano">
                          <span className="capitalize font-bold" style={{ color: '#F59E0B' }}>{d.newPlan}</span>
                          <span className="text-xs ml-2" style={{ color: '#CBD5E1' }}>({fmtBRL(d.newPriceCents)}/mês)</span>
                        </Row>
                        <div className="border-t pt-2" style={{ borderColor: '#2A3650' }} />
                        <Row label="Vale a partir de">
                          <span className="font-mono text-xs flex items-center gap-1" style={{ color: '#F59E0B' }}>
                            <Calendar className="h-3 w-3" /> {formatDate(d.effectiveDate)}
                          </span>
                        </Row>
                      </>
                    )
                  })()}
                </>
              )}
            </div>

            {/* Cobrança */}
            {isUpgrade ? (
              <div className="rounded-lg border p-4 flex justify-between items-center"
                style={{ background: 'rgba(16,185,129,.06)', borderColor: 'rgba(16,185,129,.3)' }}>
                <span className="text-sm font-bold" style={{ color: '#F8FAFC' }}>Total a pagar agora</span>
                <span className="text-2xl font-bold font-mono" style={{ color: '#10B981' }}>
                  {fmtBRL((prev.data as UpgradePreviewOK).proratedChargeCents)}
                </span>
              </div>
            ) : (
              <div className="rounded-lg border p-4"
                style={{ background: 'rgba(255,184,0,.06)', borderColor: 'rgba(255,184,0,.3)' }}>
                <p className="text-sm" style={{ color: '#F59E0B' }}>
                  ✓ Sem cobrança agora. Você continua usando todas as features do plano atual até o
                  fim do ciclo.
                </p>
              </div>
            )}

            {/* Features que perde (se downgrade) */}
            {lostFeatures.length > 0 && (
              <div className="rounded-lg border p-4"
                style={{ background: 'rgba(255,77,109,.04)', borderColor: 'rgba(255,77,109,.3)' }}>
                <p className="text-xs font-bold mb-2" style={{ color: '#EF4444' }}>
                  ⚠ Você vai perder o acesso a:
                </p>
                <ul className="space-y-1">
                  {lostFeatures.map(f => (
                    <li key={f} className="text-[11px] flex items-start gap-1.5" style={{ color: '#F8FAFC' }}>
                      <span style={{ color: '#EF4444' }}>×</span> {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => setStep('choose')}
                className="flex-1 rounded-lg py-3 text-sm font-bold border transition-colors hover:bg-white/5"
                style={{ borderColor: '#2A3650', color: '#CBD5E1' }}>Voltar</button>
              <button onClick={handleExecute} disabled={executing}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg py-3 text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: isUpgrade
                  ? 'linear-gradient(135deg, #22C55E, #10B981)'
                  : 'linear-gradient(135deg, #F59E0B, #FF8800)',
                  color: '#131C2A' }}>
                {executing
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Processando…</>
                  : isUpgrade ? 'Confirmar upgrade' : 'Confirmar downgrade'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Choose step (default) ───────────────────────────────────────────────
  const otherPlans = plansForProduct(product).filter(p => p.plan !== currentPlan)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div className="rounded-2xl border w-full max-w-2xl max-h-[95vh] overflow-y-auto"
        style={{ background: '#1B2638', borderColor: '#3A4868' }}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 z-10"
          style={{ background: '#1B2638', borderColor: '#2A3650' }}>
          <h3 className="text-lg font-bold" style={{ color: '#F8FAFC' }}>
            Mudar plano — {productLabel}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/5"
            style={{ color: '#94A3B8' }}><X className="h-5 w-5" /></button>
        </div>

        <div className="p-6">
          <p className="text-xs mb-4" style={{ color: '#CBD5E1' }}>
            Você está atualmente no plano <strong className="capitalize" style={{ color: '#22C55E' }}>{currentPlan}</strong>.
            Escolha o novo plano abaixo:
          </p>

          {loadingPreviews ? (
            <div className="flex items-center justify-center py-12" style={{ color: '#94A3B8' }}>
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              {otherPlans.map(plan => {
                const prev = previews[plan.plan]
                if (!prev) {
                  // Preview ainda não carregou (não deveria acontecer porque
                  // loadingPreviews bloqueia, mas defensivo)
                  return null
                }
                const isUpgrade = prev.dir === 'upgrade'
                const hasError = 'error' in prev.data
                const features = featuresFor(product, plan.plan)

                return (
                  <button key={plan.plan} type="button"
                    disabled={hasError}
                    onClick={() => { setSelectedPlan(plan.plan); setStep('confirm') }}
                    className="w-full rounded-lg border p-4 text-left transition-colors hover:bg-white/[0.02] disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: '#131C2A', borderColor: '#2A3650' }}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <p className="text-base font-bold capitalize" style={{ color: '#F8FAFC' }}>
                            {plan.plan}
                          </p>
                          {!hasError && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
                              style={isUpgrade
                                ? { background: 'rgba(16,185,129,.12)', color: '#10B981' }
                                : { background: 'rgba(255,184,0,.12)', color: '#F59E0B' }}>
                              {isUpgrade ? <><ArrowUp className="h-3 w-3" /> Upgrade</>
                                          : <><ArrowDown className="h-3 w-3" /> Downgrade</>}
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-mono" style={{ color: '#CBD5E1' }}>
                          {fmtBRL(plan.priceCents)}/mês
                        </p>
                      </div>
                      {!hasError && (
                        <div className="text-right shrink-0 ml-3">
                          {isUpgrade ? (
                            <>
                              <p className="text-[10px]" style={{ color: '#94A3B8' }}>Você paga agora</p>
                              <p className="text-lg font-bold font-mono" style={{ color: '#10B981' }}>
                                {fmtBRL((prev.data as UpgradePreviewOK).proratedChargeCents)}
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="text-[10px]" style={{ color: '#94A3B8' }}>Vale em</p>
                              <p className="text-xs font-mono" style={{ color: '#F59E0B' }}>
                                {formatDate((prev.data as DowngradePreviewOK).effectiveDate)}
                              </p>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Features */}
                    {features.length > 0 && (
                      <div className="border-t pt-3" style={{ borderColor: '#2A3650' }}>
                        <p className="text-[10px] font-bold uppercase tracking-widest mb-2"
                          style={{ color: '#94A3B8' }}>Recursos inclusos</p>
                        <ul className="space-y-1">
                          {features.slice(0, 4).map(f => (
                            <li key={f} className="text-[11px] flex items-start gap-1.5" style={{ color: '#F8FAFC' }}>
                              <Check className="h-3 w-3 mt-0.5 shrink-0" style={{ color: '#10B981' }} />
                              {f}
                            </li>
                          ))}
                          {features.length > 4 && (
                            <li className="text-[10px] italic" style={{ color: '#94A3B8' }}>
                              + {features.length - 4} outros recursos
                            </li>
                          )}
                        </ul>
                      </div>
                    )}

                    {hasError && (
                      <p className="text-[11px] mt-2" style={{ color: '#EF4444' }}>
                        ⚠ {(prev.data as { error: string }).error}
                      </p>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span style={{ color: '#CBD5E1' }}>{label}</span>
      <span>{children}</span>
    </div>
  )
}

function formatDate(s: string): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}
