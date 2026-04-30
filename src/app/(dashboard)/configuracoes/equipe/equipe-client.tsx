'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Users, ArrowLeft, UserPlus, Crown, Mail, Trash2, Loader2,
  Copy, Check, Clock, X, Edit2, Shield,
} from 'lucide-react'
import {
  inviteMember, removeMember, cancelInvite, updateMemberPermissions,
  type TeamMember, type PendingInvite, type TeamRole,
} from '@/actions/team'
import { MODULES, MODULE_FEATURES, featureKey, type ModuleKey } from '@/lib/permissions-shared'
import { toast } from 'sonner'

const inputCls = 'w-full rounded-lg border px-3.5 py-2.5 text-sm text-text placeholder:text-muted outline-none transition-colors focus:border-accent/60'
const inputStyle = { background: '#1B2638', borderColor: '#2A3650' }

const DT = (iso: string) => {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

type Props = {
  members:    TeamMember[]
  invites:    PendingInvite[]
  ownerEmail: string
}

export function EquipeClient({ members, invites, ownerEmail }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError]         = useState<string | null>(null)

  // Form de convite — permissions agora pode conter módulos OU feature keys ('dashboard:kpis')
  const [email, setEmail] = useState('')
  const [role, setRole]   = useState<Exclude<TeamRole, 'owner'>>('employee')
  const [permissions, setPermissions] = useState<string[]>(['pos', 'estoque'])  // defaults sensatos — sem dashboard
  const [limitManagerAccess, setLimitManagerAccess] = useState(false)
  const [showInviteUrl, setShowInviteUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Edição de permissions de membro existente
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null)
  const [editPerms, setEditPerms] = useState<string[]>([])

  /**
   * Toggle de módulo. Se módulo TEM features, ao marcar adiciona o módulo +
   * todas as features automáticas; ao desmarcar remove tudo. Owner pode
   * desmarcar features individuais via toggleFeature mantendo módulo marcado.
   */
  function toggleModule(key: ModuleKey, list: string[], setter: (v: string[]) => void) {
    const features = MODULE_FEATURES[key] ?? []
    const allFeatureKeys = features.map(f => featureKey(key, f.key))
    if (list.includes(key)) {
      // Desmarca módulo + todas suas features
      setter(list.filter(k => k !== key && !allFeatureKeys.includes(k)))
    } else {
      // Marca módulo + todas suas features (defaults)
      const next = new Set(list)
      next.add(key)
      for (const fk of allFeatureKeys) next.add(fk)
      setter(Array.from(next))
    }
  }

  function toggleFeature(fullKey: string, list: string[], setter: (v: string[]) => void) {
    if (list.includes(fullKey)) setter(list.filter(k => k !== fullKey))
    else                        setter([...list, fullKey])
  }

  /** Conta quantos módulos PRINCIPAIS estão marcados (ignora features). */
  function countModules(list: string[]): number {
    const moduleKeys = new Set(MODULES.map(m => m.key as string))
    return list.filter(k => moduleKeys.has(k)).length
  }

  function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    // Decide o que enviar como permissions:
    // - employee → sempre permissions
    // - manager + limitar acesso ON → permissions (limitado)
    // - manager + limitar acesso OFF → undefined (acesso total)
    const sendPerms = role === 'employee' || (role === 'manager' && limitManagerAccess)
      ? permissions
      : undefined
    startTransition(async () => {
      const result = await inviteMember({ email, role, permissions: sendPerms })
      if (!result.ok) { setError(result.error); return }
      setShowInviteUrl(result.inviteUrl)
      setEmail('')
      setRole('employee')
      setPermissions(['pos', 'estoque'])  // sem dashboard por default
      setLimitManagerAccess(false)
      router.refresh()
    })
  }

  function startEditMember(m: TeamMember) {
    setEditingMember(m)
    setEditPerms(m.permissions ?? [])
  }

  function handleSaveEditPerms() {
    if (!editingMember) return
    startTransition(async () => {
      const res = await updateMemberPermissions({
        userId: editingMember.userId,
        permissions: editPerms,
      })
      if (!res.ok) { toast.error(res.error ?? 'Erro'); return }
      toast.success('Permissões atualizadas')
      setEditingMember(null)
      router.refresh()
    })
  }

  function handleRemove(userId: string, email: string) {
    if (!confirm(`Remover ${email} da equipe?`)) return
    startTransition(async () => {
      try {
        await removeMember(userId)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao remover')
      }
    })
  }

  function handleCancelInvite(inviteId: string, email: string) {
    if (!confirm(`Cancelar convite pra ${email}?`)) return
    startTransition(async () => {
      try {
        await cancelInvite(inviteId)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao cancelar')
      }
    })
  }

  async function copyInviteUrl(url: string) {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <Link href="/configuracoes" className="inline-flex items-center gap-1.5 text-xs hover:underline mb-2"
          style={{ color: '#94A3B8' }}>
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar pra Configurações
        </Link>
        <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: '#F8FAFC' }}>
          <Users className="h-5 w-5" style={{ color: '#10B981' }} />
          Equipe
        </h1>
        <p className="mt-1 text-sm" style={{ color: '#94A3B8' }}>
          Gerencie quem tem acesso à sua conta. {members.length} {members.length === 1 ? 'pessoa' : 'pessoas'} no total.
        </p>
      </div>

      {/* Convite — mostra URL gerado */}
      {showInviteUrl && (
        <div className="rounded-xl border p-4" style={{ background: 'rgba(16,185,129,.04)', borderColor: 'rgba(16,185,129,.3)' }}>
          <p className="text-sm font-bold mb-2" style={{ color: '#10B981' }}>Convite criado!</p>
          <p className="text-xs mb-3" style={{ color: '#CBD5E1' }}>
            Email enviado pro convidado. Você também pode copiar o link e mandar manualmente:
          </p>
          <div className="flex gap-2">
            <input value={showInviteUrl} readOnly
              className="flex-1 rounded-lg border px-3 py-2 text-xs font-mono outline-none"
              style={{ background: '#1B2638', borderColor: '#2A3650', color: '#F8FAFC' }} />
            <button onClick={() => copyInviteUrl(showInviteUrl)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition-opacity hover:opacity-90"
              style={{ background: copied ? '#10B981' : '#22C55E', color: '#131C2A' }}>
              {copied ? <><Check className="h-3.5 w-3.5" />Copiado</> : <><Copy className="h-3.5 w-3.5" />Copiar</>}
            </button>
          </div>
          <button onClick={() => setShowInviteUrl(null)}
            className="mt-3 text-xs hover:underline" style={{ color: '#94A3B8' }}>
            Fechar
          </button>
        </div>
      )}

      {/* Form convidar membro */}
      <div className="rounded-xl border p-5" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: '#F8FAFC' }}>
          <UserPlus className="h-4 w-4" style={{ color: '#22C55E' }} />
          Convidar novo membro
        </h2>
        <form onSubmit={handleInvite} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest mb-1.5 block"
                style={{ color: '#94A3B8' }}>
                Email do convidado
              </label>
              <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                placeholder="email@empresa.com" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest mb-1.5 block"
                style={{ color: '#94A3B8' }}>
                Tipo de acesso
              </label>
              <select value={role} onChange={e => setRole(e.target.value as 'manager' | 'employee')}
                className={inputCls} style={inputStyle}>
                <option value="employee">Funcionário (módulos restritos)</option>
                <option value="manager">Manager (acesso total)</option>
              </select>
            </div>
          </div>

          {/* Toggle "Limitar acessos" — só aparece se manager */}
          {role === 'manager' && (
            <label className="flex items-center gap-2.5 rounded-lg border p-3 cursor-pointer transition-colors hover:bg-white/[0.02]"
              style={{
                background: limitManagerAccess ? 'rgba(255,184,0,.06)' : '#131C2A',
                borderColor: limitManagerAccess ? '#F59E0B' : '#2A3650',
              }}>
              <input type="checkbox" checked={limitManagerAccess}
                onChange={e => setLimitManagerAccess(e.target.checked)}
                className="h-4 w-4 cursor-pointer" />
              <div className="flex-1">
                <p className="text-xs font-bold flex items-center gap-1.5" style={{ color: '#F8FAFC' }}>
                  <Shield className="h-3 w-3" style={{ color: '#F59E0B' }} />
                  Limitar acessos desse manager
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: '#CBD5E1' }}>
                  Marque pra escolher quais módulos esse manager pode acessar.
                  Sem marcar, ele tem acesso total (exceto Equipe e Assinatura).
                </p>
              </div>
            </label>
          )}

          {/* Checklist de módulos — aparece pra employee SEMPRE ou pra manager limitado */}
          {(role === 'employee' || (role === 'manager' && limitManagerAccess)) && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-widest mb-2 block flex items-center gap-1.5"
                style={{ color: '#94A3B8' }}>
                <Shield className="h-3 w-3" /> Módulos liberados {role === 'employee' ? 'pra esse funcionário' : 'pra esse manager'}
              </label>
              <PermissionsChecklist
                value={permissions}
                onChange={setPermissions}
                onToggleModule={(k) => toggleModule(k, permissions, setPermissions)}
                onToggleFeature={(k) => toggleFeature(k, permissions, setPermissions)}
              />
              <p className="text-[10px] mt-2" style={{ color: '#94A3B8' }}>
                Funcionário só vai ver no menu lateral os módulos que você marcar.
                Módulos com sub-itens (Dashboard) podem ter partes específicas
                liberadas — desmarque blocos individuais pra restringir.
              </p>
            </div>
          )}

          <div className="flex justify-end">
            <button type="submit"
              disabled={pending || !email
                || (role === 'employee' && countModules(permissions) === 0)
                || (role === 'manager' && limitManagerAccess && countModules(permissions) === 0)}
              className="inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #22C55E, #10B981)', color: '#131C2A' }}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Enviar convite
            </button>
          </div>
        </form>
        <p className="mt-3 text-xs" style={{ color: '#94A3B8' }}>
          {role === 'employee'
            ? 'Funcionário entra com acesso APENAS aos módulos marcados acima.'
            : limitManagerAccess
              ? 'Manager limitado: só vê os módulos marcados acima.'
              : 'Manager entra com acesso total exceto Equipe e Assinatura.'}
          {' '}Convite expira em 7 dias.
        </p>
        {error && (
          <p className="mt-2 text-xs" style={{ color: '#EF4444' }}>{error}</p>
        )}
      </div>

      {/* Lista de membros ativos */}
      <div className="rounded-xl border overflow-hidden" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="border-b px-5 py-3" style={{ borderColor: '#2A3650' }}>
          <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#94A3B8' }}>
            Membros ativos ({members.length})
          </h2>
        </div>
        <ul>
          {members.map(m => (
            <li key={m.userId}
              className="flex items-center gap-3 px-5 py-4 border-b last:border-0"
              style={{ borderColor: '#2A3650' }}>
              <div className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold shrink-0"
                style={{ background: m.role === 'owner'
                  ? 'linear-gradient(135deg, #F59E0B, #F59E0B)'
                  : 'linear-gradient(135deg, #22C55E, #10B981)',
                  color: '#131C2A' }}>
                {(m.fullName ?? m.email).slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold truncate" style={{ color: '#F8FAFC' }}>
                    {m.fullName ?? m.email}
                  </p>
                  {m.role === 'owner' && (
                    <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold uppercase"
                      style={{ background: 'rgba(255,184,0,.15)', color: '#F59E0B' }}>
                      <Crown className="h-3 w-3" /> dono
                    </span>
                  )}
                  {m.role === 'manager' && countModules(m.permissions) === 0 && (
                    <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase"
                      style={{ background: 'rgba(34,197,94,.15)', color: '#22C55E' }}>
                      manager · acesso total
                    </span>
                  )}
                  {m.role === 'manager' && countModules(m.permissions) > 0 && (
                    <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase"
                      style={{ background: 'rgba(255,184,0,.15)', color: '#F59E0B' }}>
                      manager · limitado
                    </span>
                  )}
                  {m.role === 'employee' && (
                    <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase"
                      style={{ background: 'rgba(16,185,129,.12)', color: '#10B981' }}>
                      funcionário
                    </span>
                  )}
                </div>
                <p className="text-xs truncate" style={{ color: '#CBD5E1' }}>{m.email}</p>
                {(m.role === 'employee' || (m.role === 'manager' && countModules(m.permissions) > 0)) && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {countModules(m.permissions) === 0 ? (
                      <span className="text-[10px] italic" style={{ color: '#EF4444' }}>
                        ⚠ sem módulos liberados
                      </span>
                    ) : (
                      m.permissions
                        .filter(p => MODULES.some(mo => mo.key === p))
                        .map(p => {
                        const mod = MODULES.find(m => m.key === p)
                        if (!mod) return null
                        return (
                          <span key={p} className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                            style={{ background: 'rgba(34,197,94,.1)', color: '#22C55E' }}>
                            {mod.label}
                          </span>
                        )
                      })
                    )}
                  </div>
                )}
                <p className="text-[10px] mt-1" style={{ color: '#94A3B8' }}>
                  No time desde {DT(m.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {(m.role === 'employee' || m.role === 'manager') && (
                  <button onClick={() => startEditMember(m)}
                    disabled={pending}
                    className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/5 transition-colors"
                    title="Editar permissões"
                    style={{ color: '#22C55E' }}>
                    <Edit2 className="h-4 w-4" />
                  </button>
                )}
                {m.role !== 'owner' && (
                  <button onClick={() => handleRemove(m.userId, m.email)}
                    disabled={pending}
                    className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/5 transition-colors"
                    title="Remover da equipe"
                    style={{ color: '#EF4444' }}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Modal edit permissions */}
      {editingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={() => setEditingMember(null)}>
          <div className="rounded-2xl border w-full max-w-lg max-h-[90vh] overflow-y-auto"
            style={{ background: '#1B2638', borderColor: '#3A4868' }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b"
              style={{ borderColor: '#2A3650' }}>
              <h3 className="text-base font-bold flex items-center gap-2" style={{ color: '#F8FAFC' }}>
                <Shield className="h-4 w-4" style={{ color: '#22C55E' }} />
                Permissões — {editingMember.fullName ?? editingMember.email}
              </h3>
              <button onClick={() => setEditingMember(null)}
                className="p-1 rounded hover:bg-white/5" style={{ color: '#94A3B8' }}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-3">
              <p className="text-xs" style={{ color: '#CBD5E1' }}>
                {editingMember.role === 'manager'
                  ? 'Marque os módulos pra limitar o acesso. Desmarque tudo pra dar acesso total.'
                  : 'Marque os módulos que esse funcionário pode acessar.'}
              </p>

              {editingMember.role === 'manager' && (
                <button type="button"
                  onClick={() => setEditPerms([])}
                  className="w-full rounded-lg border py-2 text-xs font-bold transition-colors hover:bg-white/[0.02]"
                  style={{ borderColor: '#2A3650', color: '#F59E0B' }}>
                  🔓 Dar acesso total (limpar todas)
                </button>
              )}

              <PermissionsChecklist
                value={editPerms}
                onChange={setEditPerms}
                onToggleModule={(k) => toggleModule(k, editPerms, setEditPerms)}
                onToggleFeature={(k) => toggleFeature(k, editPerms, setEditPerms)}
              />

              <div className="flex gap-2 pt-2">
                <button onClick={() => setEditingMember(null)} disabled={pending}
                  className="flex-1 rounded-lg py-2.5 text-sm font-bold border"
                  style={{ borderColor: '#2A3650', color: '#CBD5E1' }}>
                  Cancelar
                </button>
                <button onClick={handleSaveEditPerms}
                  disabled={pending || (editingMember.role === 'employee' && countModules(editPerms) === 0)}
                  className="flex-1 rounded-lg py-2.5 text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #22C55E, #10B981)', color: '#131C2A' }}>
                  {pending ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lista de convites pendentes */}
      {invites.length > 0 && (
        <div className="rounded-xl border overflow-hidden" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
          <div className="border-b px-5 py-3" style={{ borderColor: '#2A3650' }}>
            <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: '#94A3B8' }}>
              Convites pendentes ({invites.length})
            </h2>
          </div>
          <ul>
            {invites.map(inv => (
              <li key={inv.id}
                className="flex items-center gap-3 px-5 py-4 border-b last:border-0"
                style={{ borderColor: '#2A3650' }}>
                <div className="flex h-10 w-10 items-center justify-center rounded-full shrink-0"
                  style={{ background: 'rgba(255,184,0,.15)' }}>
                  <Clock className="h-5 w-5" style={{ color: '#F59E0B' }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: '#F8FAFC' }}>{inv.email}</p>
                  <p className="text-xs" style={{ color: '#CBD5E1' }}>
                    Convidado em {DT(inv.createdAt)} · expira em {DT(inv.expiresAt)}
                  </p>
                </div>
                <button onClick={() => copyInviteUrl(inv.inviteUrl)}
                  className="hidden sm:flex h-8 px-3 items-center gap-1.5 rounded-lg hover:bg-white/5 text-xs"
                  style={{ color: '#CBD5E1' }}
                  title="Copiar link do convite">
                  <Copy className="h-3.5 w-3.5" /> Copiar link
                </button>
                <button onClick={() => handleCancelInvite(inv.id, inv.email)}
                  disabled={pending}
                  className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-white/5"
                  title="Cancelar convite"
                  style={{ color: '#EF4444' }}>
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Disclaimer */}
      <p className="text-xs" style={{ color: '#94A3B8' }}>
        Você é o dono ({ownerEmail}). Apenas você pode convidar/remover membros e gerenciar a assinatura.
      </p>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// PermissionsChecklist — lista hierárquica de módulos + sub-features
// ──────────────────────────────────────────────────────────────────────────

type ChecklistProps = {
  value:           string[]
  onChange:        (v: string[]) => void
  onToggleModule:  (k: ModuleKey) => void
  onToggleFeature: (fullKey: string) => void
}

function PermissionsChecklist({ value, onToggleModule, onToggleFeature }: ChecklistProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {MODULES.map(mod => {
        const checked = value.includes(mod.key)
        const features = MODULE_FEATURES[mod.key] ?? []

        return (
          <div key={mod.key}
            className="rounded-lg border transition-colors"
            style={{
              background: checked ? 'rgba(34,197,94,.06)' : '#131C2A',
              borderColor: checked ? '#22C55E' : '#2A3650',
            }}>
            {/* Módulo principal */}
            <label className="flex items-start gap-2.5 p-3 cursor-pointer">
              <input type="checkbox" checked={checked}
                onChange={() => onToggleModule(mod.key)}
                className="mt-0.5 h-4 w-4 accent-accent cursor-pointer" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold" style={{ color: '#F8FAFC' }}>{mod.label}</p>
                <p className="text-[10px] mt-0.5" style={{ color: '#CBD5E1' }}>{mod.description}</p>
              </div>
            </label>

            {/* Sub-features — só mostram se módulo está marcado E tem features */}
            {checked && features.length > 0 && (
              <div className="border-t px-3 py-2 space-y-1.5"
                style={{ borderColor: 'rgba(34,197,94,.15)' }}>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1"
                  style={{ color: '#22C55E' }}>
                  Partes liberadas:
                </p>
                {features.map(f => {
                  const fk = featureKey(mod.key, f.key)
                  const fChecked = value.includes(fk)
                  return (
                    <label key={fk}
                      className="flex items-start gap-2 cursor-pointer rounded px-2 py-1.5 transition-colors hover:bg-white/[0.03]">
                      <input type="checkbox" checked={fChecked}
                        onChange={() => onToggleFeature(fk)}
                        className="mt-0.5 h-3.5 w-3.5 accent-accent cursor-pointer" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-semibold" style={{ color: '#F8FAFC' }}>{f.label}</p>
                        <p className="text-[10px]" style={{ color: '#94A3B8' }}>{f.description}</p>
                      </div>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
