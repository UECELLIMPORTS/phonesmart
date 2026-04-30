'use client'

/**
 * Onboarding wizard pra clientes recém-cadastrados.
 *
 * Aparece como banner sticky no topo do dashboard quando o tenant tá vazio
 * (zero produtos, zero clientes manualmente cadastrados além do Consumidor Final).
 *
 * 3 passos:
 * 1. Cadastrar primeiro produto
 * 2. Cadastrar primeiro cliente (ou fazer 1ª venda)
 * 3. Configurar canal de venda
 *
 * Cada passo vira um link clicável pra rota correspondente.
 *
 * O wizard some quando tenant deixa de estar vazio (não precisa flag persistida).
 */

import Link from 'next/link'
import { Sparkles, Package, UserPlus, Megaphone, Check, X } from 'lucide-react'
import { useState, useEffect } from 'react'

type Props = {
  productCount:  number
  customerCount: number   // sem contar Consumidor Final
  hasChannels:   boolean  // se já configurou canais de venda
}

const DISMISSED_KEY = 'phonesmart_onboarding_dismissed'

export function OnboardingWizard({ productCount, customerCount, hasChannels }: Props) {
  // hidden = true durante hidratação (evita flash) + após dismiss persistido
  const [hidden, setHidden] = useState(true)

  const hasProduct  = productCount > 0
  const hasCustomer = customerCount > 0

  const stepsCompleted = [hasProduct, hasCustomer, hasChannels].filter(Boolean).length
  const allDone = stepsCompleted === 3

  // Lê localStorage no mount — wizard só aparece se não foi dismissed
  useEffect(() => {
    if (typeof window === 'undefined') return
    const dismissed = localStorage.getItem(DISMISSED_KEY) === '1'
    setHidden(dismissed || allDone)
  }, [allDone])

  function handleDismiss() {
    localStorage.setItem(DISMISSED_KEY, '1')
    setHidden(true)
  }

  // Quando user clica num CTA do wizard, também marca como dismissed
  // (assumimos que ele engajou e não precisa mais ver o lembrete toda vez)
  function handleStepCta() {
    localStorage.setItem(DISMISSED_KEY, '1')
  }

  if (hidden || allDone) return null

  return (
    <div className="rounded-2xl border-2 p-5 mb-6 relative"
      style={{
        background: 'linear-gradient(135deg, rgba(34,197,94,.06) 0%, rgba(16,185,129,.04) 100%)',
        borderColor: 'rgba(34,197,94,.3)',
      }}>
      <button onClick={handleDismiss}
        className="absolute top-3 right-3 p-1 rounded hover:bg-white/5"
        style={{ color: '#94A3B8' }}
        aria-label="Fechar onboarding">
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
          style={{ background: 'linear-gradient(135deg, #22C55E, #10B981)', color: '#131C2A' }}>
          <Sparkles className="h-6 w-6" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest mb-1"
            style={{ color: '#22C55E' }}>
            Bem-vindo! · {stepsCompleted} de 3 passos
          </p>
          <h3 className="text-lg font-bold mb-1" style={{ color: '#F8FAFC' }}>
            Configure sua conta em poucos minutos
          </h3>
          <p className="text-xs mb-4" style={{ color: '#CBD5E1' }}>
            Esses 3 passos liberam tudo que o sistema oferece. Você pode começar agora.
          </p>

          <div className="space-y-2">
            <StepItem
              num={1}
              title="Cadastre seus primeiros produtos"
              desc="Importe ou cadastre o estoque inicial pra começar a vender"
              done={hasProduct}
              link="/estoque"
              cta="Ir pro Estoque"
              icon={Package}
              onCta={handleStepCta}
            />
            <StepItem
              num={2}
              title="Cadastre seus clientes"
              desc="Ou deixe o sistema criar automaticamente quando você fizer uma venda"
              done={hasCustomer}
              link="/clientes"
              cta="Ir pra Clientes"
              icon={UserPlus}
              onCta={handleStepCta}
            />
            <StepItem
              num={3}
              title="Configure seus canais de venda"
              desc="Defina os canais (Loja física, Instagram, WhatsApp, etc) pra rastrear origem das vendas"
              done={hasChannels}
              link="/analytics/canais"
              cta="Ir pra Canais"
              icon={Megaphone}
              onCta={handleStepCta}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function StepItem({
  num, title, desc, done, link, cta, icon: Icon, onCta,
}: {
  num: number; title: string; desc: string; done: boolean
  link: string; cta: string; icon: React.ElementType
  onCta?: () => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3"
      style={{
        background: done ? 'rgba(16,185,129,.06)' : '#131C2A',
        borderColor: done ? 'rgba(16,185,129,.3)' : '#2A3650',
      }}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={done
          ? { background: 'rgba(16,185,129,.15)', color: '#10B981' }
          : { background: 'rgba(34,197,94,.1)', color: '#22C55E' }
        }>
        {done ? <Check className="h-5 w-5" /> : <Icon className="h-4 w-4" />}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>
          {num}. {title}
        </p>
        <p className="text-[11px] mt-0.5" style={{ color: '#CBD5E1' }}>{desc}</p>
      </div>

      {!done && (
        <Link href={link}
          onClick={onCta}
          className="shrink-0 rounded-lg px-3 py-2 text-[11px] font-bold transition-opacity hover:opacity-90"
          style={{ background: '#22C55E', color: '#131C2A' }}>
          {cta} →
        </Link>
      )}
    </div>
  )
}
