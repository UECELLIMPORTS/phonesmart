'use client'

import { useState, useEffect, useTransition, useCallback } from 'react'
import {
  MessageCircle, Smartphone, RefreshCw, X, Power, Loader2, CheckCircle2,
  AlertTriangle, Save, ChevronDown, ChevronUp, History, Eye, EyeOff,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  connectWhatsApp, getWhatsAppQr, refreshWhatsAppStatus, disconnectWhatsApp,
  updateTemplate,
  type WhatsAppStatus, type TemplateRow, type SentMessageRow,
} from '@/actions/whatsapp'

const TEMPLATE_LABEL: Record<string, { title: string; subtitle: string; icon: string }> = {
  post_sale:         { title: 'Pós-venda',           subtitle: 'Após uma venda no PDV',                      icon: '🛍️' },
  post_service:      { title: 'Pós-assistência',     subtitle: 'Após entregar uma OS',                       icon: '🛠️' },
  post_acquisition:  { title: 'Compra de aparelho',  subtitle: 'Imediato após registrar compra de usado',    icon: '📱' },
  installment_due:   { title: 'Parcela vencendo',    subtitle: '1 dia antes da parcela vencer',              icon: '💰' },
  warranty_expiring: { title: 'Garantia expirando',  subtitle: '7 dias antes da garantia vencer',            icon: '🛡️' },
  birthday_month:    { title: 'Aniversário (mês)',   subtitle: 'No início do mês de aniversário do cliente', icon: '🎁' },
  birthday_day:      { title: 'Aniversário (dia)',    subtitle: 'No dia do aniversário',                      icon: '🎂' },
}

const PLACEHOLDERS = [
  { key: '{nome}',           desc: 'Nome do cliente' },
  { key: '{loja}',           desc: 'Nome da sua loja' },
  { key: '{ano}',            desc: 'Ano atual (ex: 2026)' },
  { key: '{ultimo_dia_mes}', desc: 'Último dia do mês corrente' },
  { key: '{aparelho}',       desc: 'Modelo do produto (vendas)' },
  { key: '{valor}',          desc: 'Valor da transação' },
]

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}

export function WhatsAppClient({
  initialStatus,
  initialTemplates,
  initialMessages,
}: {
  initialStatus:    WhatsAppStatus
  initialTemplates: TemplateRow[]
  initialMessages:  SentMessageRow[]
}) {
  const [status, setStatus]     = useState<WhatsAppStatus>(initialStatus)
  const [templates, setTemplates] = useState<TemplateRow[]>(initialTemplates)
  const [messages]              = useState<SentMessageRow[]>(initialMessages)

  const [qrModal, setQrModal] = useState<{ qrBase64: string | null; pairingCode: string | null } | null>(null)
  const [pending, startTransition] = useTransition()
  const [showHistory, setShowHistory] = useState(false)

  // Polling do QR enquanto conectando
  const refreshStatus = useCallback(async () => {
    const res = await refreshWhatsAppStatus()
    if (res.ok && res.data) {
      setStatus(res.data)
      // Se conectou, fecha modal QR
      if (res.data.state === 'connected' && qrModal) {
        setQrModal(null)
        toast.success(`WhatsApp conectado: ${res.data.phone ?? 'número desconhecido'}`)
      }
    }
  }, [qrModal])

  useEffect(() => {
    if (status.state !== 'connecting') return
    const t = setInterval(refreshStatus, 3000)
    return () => clearInterval(t)
  }, [status.state, refreshStatus])

  async function handleConnect() {
    if (!status.configured) {
      toast.error('Sistema sem WhatsApp configurado. Contate o administrador.')
      return
    }
    startTransition(async () => {
      const res = await connectWhatsApp()
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      // Pega QR
      const qrRes = await getWhatsAppQr()
      if (!qrRes.ok) {
        toast.error(qrRes.error)
        return
      }
      setQrModal(qrRes.data!)
      // Atualiza status pra 'connecting'
      await refreshStatus()
    })
  }

  async function handleRefreshQr() {
    const qrRes = await getWhatsAppQr()
    if (!qrRes.ok) {
      toast.error(qrRes.error)
      return
    }
    setQrModal(qrRes.data!)
  }

  function handleDisconnect(hard = false) {
    const ok = window.confirm(
      hard
        ? 'Desconectar e remover instância? Você precisará escanear o QR novamente pra reconectar.'
        : 'Desconectar WhatsApp? Mensagens automáticas vão parar até reconectar.'
    )
    if (!ok) return
    startTransition(async () => {
      const res = await disconnectWhatsApp({ hard })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('WhatsApp desconectado.')
      await refreshStatus()
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-emerald-500 p-2 text-white">
          <MessageCircle className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text">WhatsApp</h1>
          <p className="text-sm text-muted">Conecte seu número e configure mensagens automáticas pros clientes.</p>
        </div>
      </div>

      {!status.configured && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-300 flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">WhatsApp ainda não configurado no sistema</p>
            <p className="mt-1 text-xs">O administrador precisa configurar EVOLUTION_API_URL e EVOLUTION_API_KEY no Vercel pra ativar essa feature pra todos os tenants.</p>
          </div>
        </div>
      )}

      {/* Status card */}
      <ConnectionCard
        status={status}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onRefresh={refreshStatus}
        pending={pending}
      />

      {/* Templates */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-text">Mensagens automáticas</h2>
        {templates.length === 0 ? (
          <p className="text-sm text-muted">Carregando templates…</p>
        ) : (
          templates.map(t => (
            <TemplateCard
              key={t.id}
              template={t}
              onChange={updated => setTemplates(prev => prev.map(x => x.id === updated.id ? updated : x))}
            />
          ))
        )}
      </div>

      {/* Histórico */}
      <div className="rounded-2xl border bg-card p-5 ring-1 ring-zinc-800/40">
        <button
          onClick={() => setShowHistory(s => !s)}
          className="flex w-full items-center justify-between text-left"
        >
          <h2 className="flex items-center gap-2 text-base font-semibold text-text">
            <History className="h-4 w-4 text-emerald-500" />
            Últimas mensagens enviadas
            <span className="text-xs text-muted font-normal">({messages.length})</span>
          </h2>
          {showHistory ? <ChevronUp className="h-4 w-4 text-muted" /> : <ChevronDown className="h-4 w-4 text-muted" />}
        </button>

        {showHistory && (
          <div className="mt-4">
            {messages.length === 0 ? (
              <p className="text-sm text-muted py-3">Nenhuma mensagem enviada ainda.</p>
            ) : (
              <ul className="space-y-2 max-h-96 overflow-y-auto">
                {messages.map(m => (
                  <li key={m.id} className="rounded-lg border border-zinc-800/60 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-text">
                        {TEMPLATE_LABEL[m.type]?.icon ?? '💬'} {TEMPLATE_LABEL[m.type]?.title ?? m.type}
                      </span>
                      <StatusBadge status={m.status} />
                    </div>
                    <p className="mt-0.5 text-muted">
                      {m.customerName ?? m.recipient} · {fmtDateTime(m.sentAt ?? m.scheduledFor)}
                    </p>
                    {m.lastError && (
                      <p className="mt-0.5 text-rose-400">{m.lastError}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* QR Modal */}
      {qrModal && (
        <QrModal
          qr={qrModal}
          onClose={() => setQrModal(null)}
          onRefresh={handleRefreshQr}
          status={status}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────

function ConnectionCard({
  status, onConnect, onDisconnect, onRefresh, pending,
}: {
  status:        WhatsAppStatus
  onConnect:     () => void
  onDisconnect:  (hard?: boolean) => void
  onRefresh:     () => void
  pending:       boolean
}) {
  const isConnected   = status.state === 'connected'
  const isConnecting  = status.state === 'connecting'

  return (
    <div className={`rounded-2xl border p-5 ${
      isConnected ? 'border-emerald-500/40 bg-emerald-500/5'
    : isConnecting ? 'border-amber-500/40 bg-amber-500/5'
    : status.state === 'error' ? 'border-rose-500/40 bg-rose-500/5'
    : 'border-zinc-800/60 bg-card'
    }`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`rounded-xl p-2.5 ${
            isConnected ? 'bg-emerald-500/20 text-emerald-400'
          : isConnecting ? 'bg-amber-500/20 text-amber-400'
          : status.state === 'error' ? 'bg-rose-500/20 text-rose-400'
          : 'bg-zinc-700 text-muted'
          }`}>
            <Smartphone className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-text">
              {isConnected   ? 'Conectado'
             : isConnecting  ? 'Aguardando QR…'
             : status.state === 'error' ? 'Erro'
             : 'Desconectado'}
            </p>
            <p className="text-xs text-muted">
              {isConnected && status.phone   ? `Número ${status.phone}`
             : isConnected                    ? 'Conectado, aguardando número…'
             : isConnecting                   ? 'Escaneie o QR pra finalizar'
             : status.state === 'error'      ? status.lastError ?? 'erro desconhecido'
             : 'Nenhum WhatsApp vinculado'}
            </p>
            {isConnected && status.connectedAt && (
              <p className="text-[10px] text-muted">desde {fmtDateTime(status.connectedAt)}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {isConnected ? (
            <>
              <button
                onClick={onRefresh}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-muted hover:bg-zinc-800/60"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Atualizar
              </button>
              <button
                onClick={() => onDisconnect(false)}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-400 hover:bg-rose-500/20"
              >
                <Power className="h-3.5 w-3.5" />
                Desconectar
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onConnect}
                disabled={pending || !status.configured}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                Conectar WhatsApp
              </button>
              {status.hasInstance && (
                <button
                  onClick={() => onDisconnect(true)}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-muted hover:bg-zinc-800/60"
                >
                  Remover instância
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function TemplateCard({
  template,
  onChange,
}: {
  template: TemplateRow
  onChange: (t: TemplateRow) => void
}) {
  const cfg = TEMPLATE_LABEL[template.type] ?? { title: template.type, subtitle: '', icon: '💬' }
  const [draft, setDraft] = useState(template)
  const [open, setOpen]   = useState(false)
  const [saving, setSaving] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => { setDraft(template) }, [template])

  const dirty =
       draft.body         !== template.body
    || draft.delayMinutes !== template.delayMinutes
    || draft.enabled      !== template.enabled
    || draft.sendEmail    !== template.sendEmail
    || draft.emailSubject !== template.emailSubject

  // Split delayMinutes em horas + minutos pra UI
  const delayH = Math.floor(draft.delayMinutes / 60)
  const delayM = draft.delayMinutes % 60

  function setDelay(h: number, m: number) {
    const total = Math.max(0, h * 60 + m)
    setDraft(d => ({ ...d, delayMinutes: total }))
  }

  async function save() {
    setSaving(true)
    const res = await updateTemplate({
      id:           draft.id,
      enabled:      draft.enabled,
      delayMinutes: draft.delayMinutes,
      body:         draft.body,
      sendEmail:    draft.sendEmail,
      emailSubject: draft.emailSubject,
    })
    setSaving(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    onChange(draft)
    toast.success('Template salvo!')
  }

  return (
    <div className="rounded-2xl border border-zinc-800/60 bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-4">
        <div className="flex items-start gap-3 min-w-0">
          <span className="text-2xl">{cfg.icon}</span>
          <div>
            <p className="font-semibold text-text">{cfg.title}</p>
            <p className="text-xs text-muted">{cfg.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={e => setDraft(d => ({ ...d, enabled: e.target.checked }))}
              className="peer sr-only"
            />
            <div className="h-5 w-9 rounded-full bg-zinc-700 peer-checked:bg-emerald-500 transition-colors" />
            <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
          </label>
          <button
            onClick={() => setOpen(o => !o)}
            className="rounded-lg p-1.5 text-muted hover:bg-zinc-800/60"
          >
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-zinc-800/60 p-4 space-y-3">
          {(template.type === 'post_sale' || template.type === 'post_service') && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                Enviar quanto tempo após o gatilho?
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="720"
                  value={delayH}
                  onChange={e => setDelay(parseInt(e.target.value) || 0, delayM)}
                  className="w-20 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-text text-right"
                />
                <span className="text-xs text-muted">h</span>
                <input
                  type="number"
                  min="0"
                  max="59"
                  value={delayM}
                  onChange={e => setDelay(delayH, parseInt(e.target.value) || 0)}
                  className="w-20 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-text text-right"
                />
                <span className="text-xs text-muted">min</span>
                <span className="text-[11px] text-muted ml-2">
                  Total: {draft.delayMinutes} minuto{draft.delayMinutes !== 1 ? 's' : ''}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted">
                Ex: 24h 0min = 1 dia. 0h 5min = 5 minutos (útil pra teste).
              </p>
            </div>
          )}

          {/* Toggle email + assunto */}
          <div className="rounded-lg border border-zinc-800/60 bg-zinc-900/30 p-3 space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.sendEmail}
                onChange={e => setDraft(d => ({ ...d, sendEmail: e.target.checked }))}
                className="h-4 w-4 rounded border-zinc-600 text-emerald-500 focus:ring-emerald-500 bg-zinc-900"
              />
              <span className="text-xs font-medium text-text">
                Enviar também por email
                <span className="ml-1 text-muted font-normal">(se cliente tiver email cadastrado)</span>
              </span>
            </label>
            {draft.sendEmail && (
              <div>
                <label className="mb-1 block text-[11px] text-muted">Assunto do email</label>
                <input
                  value={draft.emailSubject ?? ''}
                  onChange={e => setDraft(d => ({ ...d, emailSubject: e.target.value }))}
                  placeholder="Ex: 🎂 Parabéns pelo seu aniversário!"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-text"
                />
                <p className="mt-1 text-[11px] text-muted">
                  Body do email = mesmo do WhatsApp (com formatação HTML simples)
                </p>
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-muted">Mensagem</label>
              <button
                onClick={() => setShowHelp(s => !s)}
                className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:underline"
              >
                {showHelp ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                Placeholders
              </button>
            </div>
            <textarea
              value={draft.body}
              onChange={e => setDraft(d => ({ ...d, body: e.target.value }))}
              rows={6}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-text font-mono"
            />
            {showHelp && (
              <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2 text-[11px] text-muted">
                <p className="mb-1 font-semibold text-text">Placeholders disponíveis:</p>
                <ul className="space-y-0.5">
                  {PLACEHOLDERS.map(p => (
                    <li key={p.key}>
                      <code className="text-emerald-400">{p.key}</code> — {p.desc}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-1 text-[11px] text-muted">{draft.body.length} caracteres</p>
          </div>

          {dirty && (
            <div className="flex justify-end">
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Salvar alterações
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function QrModal({
  qr, onClose, onRefresh, status,
}: {
  qr:        { qrBase64: string | null; pairingCode: string | null }
  onClose:   () => void
  onRefresh: () => void
  status:    WhatsAppStatus
}) {
  const [refreshing, setRefreshing] = useState(false)

  async function handleRefresh() {
    setRefreshing(true)
    await onRefresh()
    setRefreshing(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <h3 className="font-semibold text-text">Conectar WhatsApp</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-zinc-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <ol className="text-xs text-muted space-y-1 list-decimal list-inside">
            <li>Abra o WhatsApp no seu celular</li>
            <li>Toque em <b>Configurações &gt; Aparelhos conectados</b></li>
            <li>Toque em <b>Conectar um aparelho</b> e escaneie:</li>
          </ol>

          <div className="flex justify-center bg-white rounded-xl p-4">
            {qr.qrBase64 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr.qrBase64} alt="QR Code" className="w-64 h-64 object-contain" />
            ) : (
              <div className="w-64 h-64 flex items-center justify-center text-zinc-400 text-xs">
                QR não disponível ainda
              </div>
            )}
          </div>

          {qr.pairingCode && (
            <div className="rounded-lg bg-blue-500/10 border border-blue-500/30 p-3 text-center">
              <p className="text-xs text-blue-300 mb-1">Ou use o código de pareamento:</p>
              <p className="font-mono text-lg font-bold text-blue-400">{qr.pairingCode}</p>
            </div>
          )}

          <div className="flex items-center justify-between text-xs text-muted">
            <span>Status: {
              status.state === 'connecting' ? <span className="text-amber-400">aguardando…</span>
            : status.state === 'connected'  ? <span className="text-emerald-400">conectado!</span>
            : 'desconectado'
            }</span>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
              Renovar QR
            </button>
          </div>

          <p className="text-[11px] text-muted text-center">
            ⚡ Conectando automaticamente quando você escanear. Se não acontecer em 10s, clique em "Renovar QR".
          </p>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const cfg =
    status === 'sent'      ? { label: 'Enviada',  cls: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' }
  : status === 'failed'    ? { label: 'Falhou',   cls: 'bg-rose-500/20 text-rose-400 border-rose-500/30' }
  : status === 'cancelled' ? { label: 'Cancelada', cls: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30' }
  :                          { label: 'Pendente', cls: 'bg-amber-500/20 text-amber-400 border-amber-500/30' }
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}
