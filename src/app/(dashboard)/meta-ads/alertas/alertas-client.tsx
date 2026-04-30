'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Bell, Plus, Play, Pause, Pencil, Trash2, X, Loader2, ArrowLeft,
  AlertTriangle, CheckCircle2, Archive, Check,
} from 'lucide-react'
import { toast } from 'sonner'
import type { MetaAdsAdAccount } from '@/actions/meta-ads'
import {
  createAlertRule, updateAlertRule, deleteAlertRule, toggleAlertRule,
  evaluateMyAlerts, markAlertEventRead, markAllAlertEventsRead,
  dismissAlertEvent,
  type MetaAdsAlertRule, type MetaAdsAlertEvent, type AlertRuleType, type MetaAdsAlertRuleInput,
} from '@/actions/meta-ads-alerts'
import { formatDateTime } from '@/lib/datetime'

type Props = {
  accounts: MetaAdsAdAccount[]
  rules:    MetaAdsAlertRule[]
  events:   MetaAdsAlertEvent[]
}

const RULE_TYPES: { value: AlertRuleType; label: string; description: string; needsCents: boolean; needsPercent: boolean }[] = [
  {
    value: 'high_cpc',
    label: 'CPC alto',
    description: 'Dispara quando o custo por clique da campanha excede um limite',
    needsCents: true, needsPercent: false,
  },
  {
    value: 'high_daily_spend',
    label: 'Gasto diário alto',
    description: 'Dispara quando o gasto em QUALQUER dia da janela excede um limite',
    needsCents: true, needsPercent: false,
  },
  {
    value: 'low_ctr',
    label: 'CTR baixo',
    description: 'Dispara quando a taxa de cliques da campanha fica abaixo de um mínimo',
    needsCents: false, needsPercent: true,
  },
  {
    value: 'zero_clicks',
    label: 'Zero cliques',
    description: 'Dispara quando a campanha entrega impressões mas não gera clique nenhum',
    needsCents: false, needsPercent: false,
  },
]

function ruleTypeConfig(type: AlertRuleType) {
  return RULE_TYPES.find(r => r.value === type)!
}

function humanizeRule(r: MetaAdsAlertRule, accounts: MetaAdsAdAccount[]): string {
  const scope = r.adAccountId
    ? accounts.find(a => a.adAccountId === r.adAccountId)?.displayName ?? r.adAccountId
    : 'todas as contas'

  const window = r.daysWindow === 1 ? 'no último dia' : `nos últimos ${r.daysWindow} dias`

  switch (r.ruleType) {
    case 'high_cpc':
      return `Se CPC > R$ ${((r.thresholdCents ?? 0) / 100).toFixed(2).replace('.', ',')} em ${scope}, ${window}`
    case 'high_daily_spend':
      return `Se gasto diário > R$ ${((r.thresholdCents ?? 0) / 100).toFixed(2).replace('.', ',')} em ${scope}, ${window}`
    case 'low_ctr':
      return `Se CTR < ${(r.thresholdPercent ?? 0).toFixed(2)}% em ${scope}, ${window}`
    case 'zero_clicks':
      return `Se campanhas de ${scope} entregarem impressões sem cliques, ${window}`
  }
}

// ── Main component ─────────────────────────────────────────────────────────

export function AlertasClient({ accounts, rules, events }: Props) {
  const router = useRouter()
  const [modalRule, setModalRule] = useState<MetaAdsAlertRule | 'new' | null>(null)
  const [evaluating, startEvaluate] = useTransition()

  async function handleEvaluate() {
    startEvaluate(async () => {
      try {
        const result = await evaluateMyAlerts()
        if (result.errors.length > 0) {
          toast.warning(`Avaliação concluída com avisos: ${result.errors.slice(0, 2).join('; ')}`)
        } else if (result.eventsCreated > 0) {
          toast.success(`${result.eventsCreated} alerta(s) disparado(s) em ${result.campaignsChecked} campanha(s)`)
        } else {
          toast.success(`${result.campaignsChecked} campanha(s) avaliada(s) — tudo dentro dos limites`)
        }
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Erro ao avaliar')
      }
    })
  }

  const unreadCount = events.filter(e => !e.readAt).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href="/meta-ads" className="mb-2 inline-flex items-center gap-1 text-xs" style={{ color: '#94A3B8' }}>
            <ArrowLeft className="h-3 w-3" /> Voltar ao Dashboard
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: '#F8FAFC' }}>
            <Bell className="h-5 w-5" style={{ color: '#F59E0B' }} />
            Alertas
            {unreadCount > 0 && (
              <span className="text-[10px] font-bold rounded-full px-2 py-0.5"
                style={{ background: '#EF4444', color: '#fff' }}>
                {unreadCount} novo{unreadCount === 1 ? '' : 's'}
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm" style={{ color: '#94A3B8' }}>
            Regras que monitoram CPC, gasto, CTR e engajamento das suas campanhas
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleEvaluate}
            disabled={evaluating || rules.filter(r => r.isActive).length === 0}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-black transition-opacity disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #22C55E, #10B981)' }}
          >
            {evaluating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Avaliar agora
          </button>
          <button
            onClick={() => setModalRule('new')}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold transition-colors hover:bg-white/5"
            style={{ borderColor: '#2A3650', color: '#22C55E' }}
          >
            <Plus className="h-4 w-4" />
            Nova regra
          </button>
        </div>
      </div>

      {/* Regras */}
      <RulesSection
        accounts={accounts}
        rules={rules}
        onEdit={r => setModalRule(r)}
        onChange={() => router.refresh()}
      />

      {/* Eventos */}
      <EventsSection events={events} unreadCount={unreadCount} onChange={() => router.refresh()} />

      {/* Modal */}
      {modalRule && (
        <RuleModal
          accounts={accounts}
          rule={modalRule === 'new' ? null : modalRule}
          onClose={() => setModalRule(null)}
          onSaved={() => { setModalRule(null); router.refresh() }}
        />
      )}
    </div>
  )
}

// ── Regras ─────────────────────────────────────────────────────────────────

function RulesSection({
  accounts, rules, onEdit, onChange,
}: {
  accounts: MetaAdsAdAccount[]
  rules: MetaAdsAlertRule[]
  onEdit: (r: MetaAdsAlertRule) => void
  onChange: () => void
}) {
  return (
    <div className="rounded-2xl border p-6 space-y-4" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="flex items-center gap-2">
        <div className="h-4 w-1 rounded-full" style={{ background: '#F59E0B' }} />
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#CBD5E1' }}>
            Regras configuradas
          </h2>
          <p className="text-[11px]" style={{ color: '#94A3B8' }}>
            {rules.length === 0
              ? 'Nenhuma regra ainda. Crie a primeira pra começar a monitorar.'
              : `${rules.filter(r => r.isActive).length} ativa(s) de ${rules.length}`}
          </p>
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="rounded-xl border p-6 text-center" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
          <Bell className="h-8 w-8 mx-auto mb-2" style={{ color: '#F59E0B', opacity: 0.5 }} />
          <p className="text-sm" style={{ color: '#CBD5E1' }}>
            Exemplos úteis: <strong>CPC acima de R$ 2,00</strong>, <strong>CTR abaixo de 1%</strong>,
            ou <strong>zero cliques em 2 dias</strong>.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map(r => (
            <RuleRow key={r.id} rule={r} accounts={accounts} onEdit={onEdit} onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  )
}

function RuleRow({
  rule, accounts, onEdit, onChange,
}: {
  rule: MetaAdsAlertRule
  accounts: MetaAdsAdAccount[]
  onEdit: (r: MetaAdsAlertRule) => void
  onChange: () => void
}) {
  const [busy, setBusy] = useState(false)
  const config = ruleTypeConfig(rule.ruleType)

  async function handleToggle() {
    setBusy(true)
    try {
      await toggleAlertRule(rule.id, !rule.isActive)
      toast.success(rule.isActive ? 'Regra desativada' : 'Regra ativada')
      onChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Remover a regra "${rule.name}"? O histórico de eventos dela também será apagado.`)) return
    setBusy(true)
    try {
      await deleteAlertRule(rule.id)
      toast.success('Regra removida')
      onChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border p-3 flex items-start justify-between gap-3 flex-wrap"
      style={{
        background: rule.isActive ? '#131C2A' : 'rgba(13,19,32,0.5)',
        borderColor: '#2A3650',
        opacity: rule.isActive ? 1 : 0.6,
      }}>
      <div className="flex-1 min-w-[240px]">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>{rule.name}</span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase"
            style={{ background: 'rgba(255,170,0,.15)', color: '#F59E0B' }}>
            {config.label}
          </span>
          {!rule.isActive && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase"
              style={{ background: 'rgba(138,168,200,.15)', color: '#CBD5E1' }}>
              Pausada
            </span>
          )}
        </div>
        <p className="text-xs mt-1" style={{ color: '#CBD5E1' }}>{humanizeRule(rule, accounts)}</p>
        <p className="text-[10px] mt-1" style={{ color: '#94A3B8' }}>
          Cooldown: {rule.cooldownHours}h · Janela: {rule.daysWindow} dia{rule.daysWindow > 1 ? 's' : ''}
        </p>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={handleToggle}
          disabled={busy}
          title={rule.isActive ? 'Desativar' : 'Ativar'}
          className="rounded-md border p-1.5 transition-colors hover:bg-white/5 disabled:opacity-40"
          style={{
            borderColor: rule.isActive ? 'rgba(255,170,0,.3)' : 'rgba(16,185,129,.3)',
            color:       rule.isActive ? '#F59E0B' : '#10B981',
          }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (rule.isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />)}
        </button>
        <button
          onClick={() => onEdit(rule)}
          title="Editar regra"
          className="rounded-md border p-1.5 transition-colors hover:bg-white/5"
          style={{ borderColor: '#2A3650', color: '#22C55E' }}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={handleDelete}
          disabled={busy}
          title="Remover regra"
          className="rounded-md border p-1.5 transition-colors hover:bg-red-500/10 disabled:opacity-40"
          style={{ borderColor: 'rgba(255,77,109,.3)', color: '#EF4444' }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// ── Eventos (histórico) ────────────────────────────────────────────────────

function EventsSection({
  events, unreadCount, onChange,
}: {
  events: MetaAdsAlertEvent[]
  unreadCount: number
  onChange: () => void
}) {
  const [markingAll, setMarkingAll] = useState(false)

  async function handleMarkAllRead() {
    setMarkingAll(true)
    try {
      await markAllAlertEventsRead()
      toast.success('Todos marcados como lidos')
      onChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setMarkingAll(false)
    }
  }

  return (
    <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="flex items-center justify-between gap-3 border-b px-6 py-4 flex-wrap"
        style={{ borderColor: '#2A3650' }}>
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full" style={{ background: '#EF4444' }} />
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#CBD5E1' }}>
              Histórico de alertas
            </h2>
            <p className="text-[11px]" style={{ color: '#94A3B8' }}>
              {events.length === 0
                ? 'Nenhum alerta disparou ainda'
                : `${events.length} no total · ${unreadCount} não lido(s)`}
            </p>
          </div>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={handleMarkAllRead}
            disabled={markingAll}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors hover:bg-white/5 disabled:opacity-50"
            style={{ borderColor: '#2A3650', color: '#22C55E' }}
          >
            {markingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Marcar todos como lidos
          </button>
        )}
      </div>

      {events.length === 0 ? (
        <div className="p-10 text-center">
          <CheckCircle2 className="h-8 w-8 mx-auto mb-2" style={{ color: '#10B981', opacity: 0.5 }} />
          <p className="text-sm" style={{ color: '#CBD5E1' }}>Nenhum alerta no momento. Tudo sob controle.</p>
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: 'rgba(30,45,69,.5)' }}>
          {events.map(e => <EventRow key={e.id} event={e} onChange={onChange} />)}
        </div>
      )}
    </div>
  )
}

function EventRow({ event, onChange }: { event: MetaAdsAlertEvent; onChange: () => void }) {
  const [busy, setBusy] = useState(false)
  const isUnread = !event.readAt

  async function handleRead() {
    setBusy(true)
    try {
      await markAlertEventRead(event.id)
      onChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setBusy(false)
    }
  }

  async function handleDismiss() {
    setBusy(true)
    try {
      await dismissAlertEvent(event.id)
      toast.success('Alerta arquivado')
      onChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-start gap-3 px-6 py-3"
      style={{ background: isUnread ? 'rgba(255,77,109,.04)' : 'transparent' }}>
      <div className="mt-0.5 shrink-0">
        <AlertTriangle className="h-4 w-4" style={{ color: isUnread ? '#EF4444' : '#94A3B8' }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(255,170,0,.15)', color: '#F59E0B' }}>
            {ruleTypeConfig(event.ruleType).label}
          </span>
          {isUnread && (
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#EF4444' }} />
          )}
        </div>
        <p className="text-sm mt-1" style={{ color: '#F8FAFC' }}>{event.message}</p>
        <p className="text-[10px] mt-1" style={{ color: '#94A3B8' }}>
          {formatDateTime(event.triggeredAt)}
          {event.ruleName && ` · regra "${event.ruleName}"`}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {isUnread && (
          <button
            onClick={handleRead}
            disabled={busy}
            title="Marcar como lido"
            className="rounded-md border p-1.5 transition-colors hover:bg-white/5 disabled:opacity-40"
            style={{ borderColor: '#2A3650', color: '#22C55E' }}
          >
            <Check className="h-3 w-3" />
          </button>
        )}
        <button
          onClick={handleDismiss}
          disabled={busy}
          title="Arquivar"
          className="rounded-md border p-1.5 transition-colors hover:bg-white/5 disabled:opacity-40"
          style={{ borderColor: '#2A3650', color: '#CBD5E1' }}
        >
          <Archive className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

// ── Modal de criar/editar regra ────────────────────────────────────────────

function RuleModal({
  accounts, rule, onClose, onSaved,
}: {
  accounts: MetaAdsAdAccount[]
  rule: MetaAdsAlertRule | null
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!rule
  const [form, setForm] = useState({
    name:             rule?.name ?? '',
    ruleType:         rule?.ruleType ?? 'high_cpc' as AlertRuleType,
    adAccountId:      rule?.adAccountId ?? '',
    thresholdReaisStr: rule?.thresholdCents != null ? (rule.thresholdCents / 100).toFixed(2).replace('.', ',') : '',
    thresholdPercentStr: rule?.thresholdPercent != null ? rule.thresholdPercent.toFixed(2).replace('.', ',') : '',
    daysWindow:       rule?.daysWindow ?? 1,
    cooldownHours:    rule?.cooldownHours ?? 24,
  })
  const [saving, setSaving] = useState(false)

  const config = ruleTypeConfig(form.ruleType)

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error('Nome da regra é obrigatório')
      return
    }

    const input: MetaAdsAlertRuleInput = {
      name:          form.name,
      ruleType:      form.ruleType,
      adAccountId:   form.adAccountId || null,
      daysWindow:    form.daysWindow,
      cooldownHours: form.cooldownHours,
    }

    if (config.needsCents) {
      const parsed = parseFloat(form.thresholdReaisStr.replace(',', '.'))
      if (!Number.isFinite(parsed) || parsed <= 0) {
        toast.error('Informe o valor limite em reais')
        return
      }
      input.thresholdCents = Math.round(parsed * 100)
    }
    if (config.needsPercent) {
      const parsed = parseFloat(form.thresholdPercentStr.replace(',', '.'))
      if (!Number.isFinite(parsed) || parsed <= 0) {
        toast.error('Informe o percentual limite')
        return
      }
      input.thresholdPercent = parsed
    }

    setSaving(true)
    try {
      if (isEdit && rule) await updateAlertRule(rule.id, input)
      else                await createAlertRule(input)
      toast.success(isEdit ? 'Regra atualizada' : 'Regra criada')
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-lg rounded-2xl border p-6 space-y-4 max-h-[90vh] overflow-y-auto"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4" style={{ color: '#F59E0B' }} />
            <h3 className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>
              {isEdit ? 'Editar regra' : 'Nova regra'}
            </h3>
          </div>
          <button onClick={onClose} className="text-muted hover:text-coral transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Nome */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
            Nome da regra
          </label>
          <input
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="Ex: Alerta CPC alto (>R$ 2)"
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }}
            autoFocus
          />
        </div>

        {/* Tipo */}
        <div className="flex flex-col gap-2">
          <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
            Tipo de regra
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {RULE_TYPES.map(rt => (
              <button
                key={rt.value}
                onClick={() => setForm(f => ({ ...f, ruleType: rt.value }))}
                className="rounded-lg border p-3 text-left transition-colors"
                style={{
                  background:  form.ruleType === rt.value ? 'rgba(255,170,0,.08)' : '#1B2638',
                  borderColor: form.ruleType === rt.value ? 'rgba(255,170,0,.4)' : '#2A3650',
                }}
              >
                <p className="text-xs font-semibold" style={{ color: form.ruleType === rt.value ? '#F59E0B' : '#F8FAFC' }}>
                  {rt.label}
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: '#CBD5E1' }}>{rt.description}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Threshold condicional */}
        {config.needsCents && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
              Valor limite
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm" style={{ color: '#CBD5E1' }}>R$</span>
              <input
                value={form.thresholdReaisStr}
                onChange={e => setForm(f => ({ ...f, thresholdReaisStr: e.target.value.replace(/[^0-9,]/g, '') }))}
                placeholder="2,00"
                className="w-full rounded-lg border pl-10 pr-3 py-2 text-sm outline-none font-mono"
                style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }}
              />
            </div>
          </div>
        )}
        {config.needsPercent && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
              Percentual mínimo (CTR)
            </label>
            <div className="relative">
              <input
                value={form.thresholdPercentStr}
                onChange={e => setForm(f => ({ ...f, thresholdPercentStr: e.target.value.replace(/[^0-9,]/g, '') }))}
                placeholder="1,50"
                className="w-full rounded-lg border pr-8 pl-3 py-2 text-sm outline-none font-mono"
                style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }}
              />
              <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm" style={{ color: '#CBD5E1' }}>%</span>
            </div>
          </div>
        )}

        {/* Escopo: conta */}
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
            Conta de anúncios
          </label>
          <select
            value={form.adAccountId}
            onChange={e => setForm(f => ({ ...f, adAccountId: e.target.value }))}
            className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC', appearance: 'none' }}
          >
            <option value="">Todas as contas</option>
            {accounts.filter(a => a.isActive).map(a => (
              <option key={a.id} value={a.adAccountId}>{a.displayName}</option>
            ))}
          </select>
        </div>

        {/* Janela + cooldown */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
              Janela (dias)
            </label>
            <input
              type="number" min={1} max={30}
              value={form.daysWindow}
              onChange={e => setForm(f => ({ ...f, daysWindow: Math.max(1, parseInt(e.target.value) || 1) }))}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none font-mono"
              style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
              Cooldown (horas)
            </label>
            <input
              type="number" min={1} max={720}
              value={form.cooldownHours}
              onChange={e => setForm(f => ({ ...f, cooldownHours: Math.max(1, parseInt(e.target.value) || 24) }))}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none font-mono"
              style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }}
            />
          </div>
        </div>
        <p className="text-[10px]" style={{ color: '#94A3B8' }}>
          <strong>Cooldown:</strong> tempo mínimo entre disparos do mesmo alerta pra mesma campanha, evitando spam.
        </p>

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border py-2.5 text-sm font-medium hover:bg-white/5"
            style={{ borderColor: '#2A3650', color: '#CBD5E1' }}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !form.name.trim()}
            className="flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #22C55E, #10B981)', color: '#131C2A' }}
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {isEdit ? 'Salvar' : 'Criar regra'}
          </button>
        </div>
      </div>
    </div>
  )
}
