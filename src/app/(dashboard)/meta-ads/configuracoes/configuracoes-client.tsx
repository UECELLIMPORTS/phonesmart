'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Key, ExternalLink, CheckCircle2, XCircle, Loader2, Trash2, ArrowLeft,
  AlertTriangle, BookOpen, Star, Plus, Pencil, Play, Pause, Check, X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  saveMetaAdsCredentials,
  testMetaAdsConnection,
  deleteMetaAdsCredentials,
  createAdAccount,
  updateAdAccount,
  deleteAdAccount,
  setPrimaryAdAccount,
  type MetaAdsCredentialsSafe,
  type MetaAdsAdAccount,
} from '@/actions/meta-ads'
import { formatDateTime } from '@/lib/datetime'

type Props = {
  current:  MetaAdsCredentialsSafe | null
  accounts: MetaAdsAdAccount[]
}

export function ConfiguracoesClient({ current, accounts }: Props) {
  const router = useRouter()
  const [form, setForm] = useState({
    appId:       current?.appId ?? '',
    appSecret:   '',  // nunca pré-populado (segurança)
    accessToken: '',  // nunca pré-populado
    adAccountId: current?.adAccountId ?? '',
    businessId:  current?.businessId ?? '',
  })
  const [saving, setSaving]     = useState(false)
  const [testing, setTesting]   = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function handleSave() {
    if (!form.appId || !form.appSecret || !form.accessToken || !form.adAccountId) {
      toast.error('Preencha todos os campos obrigatórios')
      return
    }
    setSaving(true)
    try {
      await saveMetaAdsCredentials(form)
      toast.success('Credenciais salvas!')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testMetaAdsConnection()
      setTestResult(result)
      if (result.ok) toast.success('Conexão OK!')
      else           toast.error('Falha na conexão')
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : 'Erro' })
    } finally {
      setTesting(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Remover as credenciais do Meta Ads? O dashboard vai parar de funcionar até você configurar de novo.')) return
    try {
      await deleteMetaAdsCredentials()
      toast.success('Credenciais removidas')
      setForm({ appId: '', appSecret: '', accessToken: '', adAccountId: '', businessId: '' })
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/meta-ads" className="mb-2 inline-flex items-center gap-1 text-xs" style={{ color: '#94A3B8' }}>
            <ArrowLeft className="h-3 w-3" /> Voltar ao Dashboard
          </Link>
          <h1 className="text-2xl font-bold" style={{ color: '#F8FAFC' }}>Configurações do Meta Ads</h1>
          <p className="mt-1 text-sm" style={{ color: '#94A3B8' }}>
            Credenciais da sua conta Meta Business e contas de anúncios conectadas
          </p>
        </div>
      </div>

      {/* Status atual */}
      {current && (
        <div
          className="rounded-xl border p-4"
          style={{
            background: current.lastError ? 'rgba(255,77,109,.08)' : 'rgba(16,185,129,.06)',
            borderColor: current.lastError ? 'rgba(255,77,109,.3)' : 'rgba(16,185,129,.3)',
          }}
        >
          <div className="flex items-start gap-3">
            {current.lastError
              ? <XCircle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: '#EF4444' }} />
              : <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: '#10B981' }} />
            }
            <div className="flex-1">
              <p className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>
                {current.lastError ? 'Erro na última sincronização' : 'Credenciais configuradas'}
              </p>
              <p className="mt-1 text-xs" style={{ color: '#CBD5E1' }}>
                {accounts.length} {accounts.length === 1 ? 'conta conectada' : 'contas conectadas'}
                {current.lastSyncAt && <> · Última sync: {formatDateTime(current.lastSyncAt)}</>}
              </p>
              {current.lastError && (
                <p className="mt-2 text-xs font-mono" style={{ color: '#EF4444' }}>{current.lastError}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Contas conectadas */}
      {current && (
        <AccountsSection accounts={accounts} onChange={() => router.refresh()} />
      )}

      {/* Guia */}
      <div
        className="rounded-xl border p-5"
        style={{ background: 'rgba(34,197,94,.04)', borderColor: 'rgba(34,197,94,.25)' }}
      >
        <div className="flex items-start gap-3 mb-3">
          <BookOpen className="h-5 w-5 mt-0.5 shrink-0" style={{ color: '#22C55E' }} />
          <div>
            <h2 className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>Como pegar cada credencial</h2>
            <p className="text-xs" style={{ color: '#CBD5E1' }}>Siga a ordem — ~15 minutos no total</p>
          </div>
        </div>
        <ol className="space-y-2 text-xs pl-8 list-decimal" style={{ color: '#CBD5E1' }}>
          <li>
            <strong className="text-text">App ID e App Secret</strong>: crie um app em{' '}
            <a href="https://developers.facebook.com/apps/" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline" style={{ color: '#22C55E' }}>
              developers.facebook.com/apps <ExternalLink className="h-2.5 w-2.5" />
            </a>
            {' '}→ tipo <em>Business</em> → adicione o produto <em>Marketing API</em>. Dashboard do app mostra o ID e o Secret.
          </li>
          <li>
            <strong className="text-text">Access Token</strong>: no{' '}
            <a href="https://business.facebook.com/settings/" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline" style={{ color: '#22C55E' }}>
              Business Settings <ExternalLink className="h-2.5 w-2.5" />
            </a>
            {' '}→ Users → <em>System Users</em> → gerar token com permissões <code className="px-1 rounded" style={{ background: '#2A3650', color: '#22C55E' }}>ads_read</code> e <code className="px-1 rounded" style={{ background: '#2A3650', color: '#22C55E' }}>ads_management</code>.
            Token de System User não expira — mais estável que token de usuário.
          </li>
          <li>
            <strong className="text-text">Ad Account ID</strong>: abra o{' '}
            <a href="https://business.facebook.com/adsmanager/" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline" style={{ color: '#22C55E' }}>
              Ads Manager <ExternalLink className="h-2.5 w-2.5" />
            </a>
            {' '}→ canto superior esquerdo mostra a conta ativa. Copie o ID e adicione o prefixo <code className="px-1 rounded" style={{ background: '#2A3650', color: '#22C55E' }}>act_</code>.
            Exemplo: <code className="px-1 rounded font-mono" style={{ background: '#2A3650', color: '#10B981' }}>act_1234567890</code>
          </li>
          <li>
            <strong className="text-text">Business ID (opcional)</strong>: Business Settings → Informações do Negócio. Útil se você tem múltiplas contas.
          </li>
        </ol>

        <div className="mt-4 flex items-start gap-2 rounded-lg px-3 py-2 text-[11px]"
          style={{ background: 'rgba(255,170,0,.06)', borderLeft: '2px solid #F59E0B' }}>
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: '#F59E0B' }} />
          <span style={{ color: '#CBD5E1' }}>
            <strong style={{ color: '#F59E0B' }}>Segurança:</strong> essas credenciais dão acesso à sua conta de anúncios.
            Não compartilhe. Elas são armazenadas com RLS por tenant — só esta loja tem acesso.
          </span>
        </div>
      </div>

      {/* Formulário */}
      <div className="rounded-xl border p-6 space-y-5" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4" style={{ color: '#F59E0B' }} />
          <h2 className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>Credenciais</h2>
        </div>

        <Field
          label="App ID *"
          hint="Número do seu app no Meta for Developers"
          value={form.appId}
          onChange={v => setForm(f => ({ ...f, appId: v }))}
          placeholder="1234567890123456"
        />

        <Field
          label="App Secret *"
          hint={current ? 'Em branco = manter o atual; preencha só para alterar' : 'Secret do app — nunca compartilhe'}
          value={form.appSecret}
          onChange={v => setForm(f => ({ ...f, appSecret: v }))}
          placeholder="••••••••••••••••••••••••••••••••"
          type="password"
        />

        <Field
          label="Access Token *"
          hint={current ? 'Em branco = manter o atual; preencha só para alterar' : 'Token longo gerado no Business Settings'}
          value={form.accessToken}
          onChange={v => setForm(f => ({ ...f, accessToken: v }))}
          placeholder="EAAxxxxxxxxxxxx..."
          type="password"
          mono
        />

        <Field
          label="Ad Account ID *"
          hint="Formato act_XXXXXXXXX — ID da conta no Ads Manager (será a conta principal na primeira configuração)"
          value={form.adAccountId}
          onChange={v => setForm(f => ({ ...f, adAccountId: v }))}
          placeholder="act_1234567890"
          mono
        />

        <Field
          label="Business ID"
          hint="Opcional — Business Settings → Informações do Negócio"
          value={form.businessId}
          onChange={v => setForm(f => ({ ...f, businessId: v }))}
          placeholder="1234567890"
          mono
        />

        {/* Resultado do teste */}
        {testResult && (
          <div
            className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
            style={{
              background: testResult.ok ? 'rgba(16,185,129,.08)' : 'rgba(255,77,109,.08)',
              borderLeft: `2px solid ${testResult.ok ? '#10B981' : '#EF4444'}`,
            }}
          >
            {testResult.ok
              ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: '#10B981' }} />
              : <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" style={{ color: '#EF4444' }} />
            }
            <span style={{ color: testResult.ok ? '#10B981' : '#EF4444' }}>{testResult.message}</span>
          </div>
        )}

        {/* Ações */}
        <div className="flex items-center gap-3 flex-wrap border-t pt-5" style={{ borderColor: '#2A3650' }}>
          <button
            onClick={handleSave}
            disabled={saving || !form.appId || (!current && (!form.appSecret || !form.accessToken)) || !form.adAccountId}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-black transition-opacity disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg, #22C55E, #10B981)' }}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Salvar credenciais
          </button>
          {current && (
            <>
              <button
                onClick={handleTest}
                disabled={testing}
                className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-bold transition-opacity disabled:opacity-50 hover:bg-white/5"
                style={{ borderColor: '#2A3650', color: '#22C55E' }}
              >
                {testing && <Loader2 className="h-4 w-4 animate-spin" />}
                Testar conexão
              </button>
              <button
                onClick={handleDelete}
                className="ml-auto flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold transition-colors hover:bg-red-500/10"
                style={{ borderColor: 'rgba(255,77,109,.3)', color: '#EF4444' }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remover credenciais
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Contas conectadas ──────────────────────────────────────────────────────

function AccountsSection({ accounts, onChange }: { accounts: MetaAdsAdAccount[]; onChange: () => void }) {
  const [adding, setAdding] = useState(false)
  const [newAdAccountId, setNewAdAccountId] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [creating, setCreating] = useState(false)

  async function handleAdd() {
    if (!newAdAccountId.trim() || !newDisplayName.trim()) {
      toast.error('Preencha o ID e o nome da conta')
      return
    }
    setCreating(true)
    try {
      await createAdAccount({ adAccountId: newAdAccountId, displayName: newDisplayName })
      toast.success('Conta adicionada')
      setNewAdAccountId('')
      setNewDisplayName('')
      setAdding(false)
      onChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="rounded-xl border p-6 space-y-4" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: '#F8FAFC' }}>
            <Star className="h-4 w-4" style={{ color: '#F59E0B' }} />
            Contas conectadas
          </h2>
          <p className="text-xs mt-0.5" style={{ color: '#94A3B8' }}>
            Mesmo access_token; cada conta tem métricas e ROAS isolados
          </p>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors hover:bg-white/5"
            style={{ borderColor: '#2A3650', color: '#22C55E' }}
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar conta
          </button>
        )}
      </div>

      {adding && (
        <div className="rounded-lg border p-4 space-y-3" style={{ background: '#131C2A', borderColor: 'rgba(34,197,94,.3)' }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                Ad Account ID
              </label>
              <input
                value={newAdAccountId}
                onChange={e => setNewAdAccountId(e.target.value)}
                placeholder="act_1234567890"
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none font-mono"
                style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }}
                autoComplete="off"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                Nome para exibição
              </label>
              <input
                value={newDisplayName}
                onChange={e => setNewDisplayName(e.target.value)}
                placeholder="Victoria Auto Peças"
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }}
                autoComplete="off"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleAdd}
              disabled={creating}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #22C55E, #10B981)' }}
            >
              {creating && <Loader2 className="h-3 w-3 animate-spin" />}
              Adicionar
            </button>
            <button
              onClick={() => { setAdding(false); setNewAdAccountId(''); setNewDisplayName('') }}
              className="rounded-lg border px-3 py-1.5 text-xs font-bold hover:bg-white/5"
              style={{ borderColor: '#2A3650', color: '#CBD5E1' }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {accounts.map(acc => <AccountRow key={acc.id} account={acc} onChange={onChange} />)}
      </div>

      {accounts.length === 0 && !adding && (
        <p className="text-xs text-center py-4" style={{ color: '#94A3B8' }}>
          Nenhuma conta cadastrada. Clique em &quot;Adicionar conta&quot; pra começar.
        </p>
      )}
    </div>
  )
}

function AccountRow({ account, onChange }: { account: MetaAdsAdAccount; onChange: () => void }) {
  const [editingName, setEditingName] = useState(false)
  const [editValue, setEditValue] = useState(account.displayName)
  const [busy, setBusy] = useState(false)

  async function handleRename() {
    if (!editValue.trim() || editValue === account.displayName) {
      setEditingName(false)
      setEditValue(account.displayName)
      return
    }
    setBusy(true)
    try {
      await updateAdAccount(account.id, { displayName: editValue })
      toast.success('Nome atualizado')
      setEditingName(false)
      onChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setBusy(false)
    }
  }

  async function handleSetPrimary() {
    setBusy(true)
    try {
      await setPrimaryAdAccount(account.id)
      toast.success(`"${account.displayName}" agora é a conta principal`)
      onChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setBusy(false)
    }
  }

  async function handleToggleActive() {
    setBusy(true)
    try {
      await updateAdAccount(account.id, { isActive: !account.isActive })
      toast.success(account.isActive ? 'Conta desativada' : 'Conta reativada')
      onChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setBusy(false)
    }
  }

  async function handleTest() {
    setBusy(true)
    try {
      const res = await testMetaAdsConnection(account.adAccountId)
      if (res.ok) toast.success(res.message)
      else        toast.error(res.message)
      onChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Remover a conta "${account.displayName}"? Essa ação não pode ser desfeita.`)) return
    setBusy(true)
    try {
      await deleteAdAccount(account.id)
      toast.success('Conta removida')
      onChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="rounded-lg border p-3"
      style={{
        background: account.isPrimary ? 'rgba(255,170,0,.05)' : '#131C2A',
        borderColor: account.isPrimary ? 'rgba(255,170,0,.3)' : '#2A3650',
        opacity: account.isActive ? 1 : 0.5,
      }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <div className="flex items-center gap-2 flex-wrap">
            {account.isPrimary && <Star className="h-3.5 w-3.5 fill-current shrink-0" style={{ color: '#F59E0B' }} />}
            {editingName ? (
              <div className="flex items-center gap-1 flex-1 min-w-0">
                <input
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  handleRename()
                    if (e.key === 'Escape') { setEditingName(false); setEditValue(account.displayName) }
                  }}
                  autoFocus
                  className="flex-1 rounded border px-2 py-0.5 text-sm outline-none"
                  style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }}
                />
                <button onClick={handleRename} disabled={busy} className="p-1 hover:bg-white/5 rounded shrink-0">
                  <Check className="h-3.5 w-3.5" style={{ color: '#10B981' }} />
                </button>
                <button onClick={() => { setEditingName(false); setEditValue(account.displayName) }} className="p-1 hover:bg-white/5 rounded shrink-0">
                  <X className="h-3.5 w-3.5" style={{ color: '#EF4444' }} />
                </button>
              </div>
            ) : (
              <>
                <span className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>{account.displayName}</span>
                <button onClick={() => { setEditingName(true); setEditValue(account.displayName) }} className="p-0.5 opacity-40 hover:opacity-100" title="Renomear">
                  <Pencil className="h-3 w-3" style={{ color: '#CBD5E1' }} />
                </button>
                {account.isPrimary && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ background: 'rgba(255,170,0,.15)', color: '#F59E0B' }}>
                    Principal
                  </span>
                )}
                {!account.isActive && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ background: 'rgba(138,168,200,.15)', color: '#CBD5E1' }}>
                    Inativa
                  </span>
                )}
              </>
            )}
          </div>
          <p className="text-xs mt-1 font-mono break-all" style={{ color: '#CBD5E1' }}>
            {account.adAccountId}
            {account.currency && <span className="ml-2" style={{ color: '#94A3B8' }}>· {account.currency}</span>}
          </p>
          <p className="text-[10px] mt-1" style={{ color: account.lastError ? '#EF4444' : '#94A3B8' }}>
            {account.lastError
              ? `Erro: ${account.lastError.slice(0, 80)}`
              : account.lastSyncAt
                ? `Última sync: ${formatDateTime(account.lastSyncAt)}`
                : 'Nunca sincronizada'}
          </p>
        </div>

        <div className="flex items-center gap-1 flex-wrap justify-end">
          <button
            onClick={handleTest}
            disabled={busy}
            className="flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-bold transition-colors hover:bg-white/5 disabled:opacity-50"
            style={{ borderColor: '#2A3650', color: '#22C55E' }}
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            Testar
          </button>
          {!account.isPrimary && account.isActive && (
            <button
              onClick={handleSetPrimary}
              disabled={busy}
              className="flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-bold transition-colors hover:bg-white/5 disabled:opacity-50"
              style={{ borderColor: 'rgba(255,170,0,.3)', color: '#F59E0B' }}
            >
              <Star className="h-3 w-3" />
              Tornar principal
            </button>
          )}
          <button
            onClick={handleToggleActive}
            disabled={busy}
            className="flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-bold transition-colors hover:bg-white/5 disabled:opacity-50"
            style={{ borderColor: '#2A3650', color: '#CBD5E1' }}
            title={account.isActive ? 'Desativar (não aparece no seletor)' : 'Reativar'}
          >
            {account.isActive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            {account.isActive ? 'Desativar' : 'Ativar'}
          </button>
          {!account.isPrimary && (
            <button
              onClick={handleDelete}
              disabled={busy}
              className="flex items-center gap-1 rounded border px-2 py-1 text-[10px] font-bold transition-colors hover:bg-red-500/10 disabled:opacity-50"
              style={{ borderColor: 'rgba(255,77,109,.3)', color: '#EF4444' }}
              title="Remover conta"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Input reutilizável ─────────────────────────────────────────────────────

function Field({
  label, hint, value, onChange, placeholder, type = 'text', mono = false,
}: {
  label: string; hint?: string
  value: string; onChange: (v: string) => void
  placeholder?: string; type?: string; mono?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-lg border px-3.5 py-2.5 text-sm text-text outline-none transition-colors focus:border-accent/60 placeholder:text-muted ${mono ? 'font-mono' : ''}`}
        style={{ background: '#131C2A', borderColor: '#2A3650' }}
        autoComplete="off"
      />
      {hint && <p className="text-[10px]" style={{ color: '#94A3B8' }}>{hint}</p>}
    </div>
  )
}
