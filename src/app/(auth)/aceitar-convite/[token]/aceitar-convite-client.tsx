'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Loader2, ArrowRight, Mail, Crown, Users, AlertCircle } from 'lucide-react'
import { acceptInvite } from '@/actions/team'
import { createClient } from '@/lib/supabase/client'
import { AuthShell } from '@/components/auth-shell'

type Props = {
  token:      string
  email:      string
  role:       string
  tenantName: string
}

export function AceitarConviteClient({ token, email, role, tenantName }: Props) {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const result = await acceptInvite({ token, fullName, password })
    if (!result.ok) {
      setLoading(false)
      setError(result.error)
      return
    }

    const supabase = createClient()
    const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (loginErr) { router.push('/login?invite_accepted=1'); return }
    await supabase.auth.refreshSession()
    router.push('/')
    router.refresh()
  }

  const ready = fullName.trim().length >= 2 && password.length >= 8

  return (
    <AuthShell>
      <div className="text-center mb-6">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{ background: '#ECFDF5', border: '1px solid #A7F3D0' }}>
          <Users className="h-6 w-6" style={{ color: '#10B981' }} />
        </div>
        <h1 className="text-2xl font-bold mb-1 tracking-tight" style={{ color: '#F8FAFC' }}>
          Você foi convidado!
        </h1>
        <p className="text-sm" style={{ color: '#94A3B8' }}>
          Junte-se à equipe de <strong style={{ color: '#F8FAFC' }}>{tenantName}</strong> como{' '}
          <span className="inline-flex items-center gap-1 font-bold" style={{ color: '#22C55E' }}>
            {role === 'manager' ? <><Crown className="h-3 w-3" /> manager</> : role}
          </span>
        </p>
      </div>

      <div className="rounded-lg border p-3 mb-5 flex items-center gap-2"
        style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <Mail className="h-4 w-4 shrink-0" style={{ color: '#94A3B8' }} />
        <span className="text-sm" style={{ color: '#F8FAFC' }}>{email}</span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Seu nome completo">
          <input value={fullName} onChange={e => setFullName(e.target.value)}
            placeholder="João Silva" required autoComplete="name"
            className="auth-input" />
        </Field>

        <Field label="Crie sua senha (mínimo 8 caracteres)">
          <div className="relative">
            <input value={password} onChange={e => setPassword(e.target.value)}
              type={showPass ? 'text' : 'password'} placeholder="••••••••"
              required minLength={8} autoComplete="new-password"
              className="auth-input pr-10" />
            <button type="button" onClick={() => setShowPass(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2"
              tabIndex={-1} style={{ color: '#64748B' }}>
              {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>

        {error && (
          <div className="rounded-lg border px-3 py-2.5 text-sm flex items-start gap-2"
            style={{ background: '#FEF2F2', borderColor: '#FECACA', color: '#B91C1C' }}>
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <button type="submit" disabled={!ready || loading} className="auth-btn-primary">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {loading ? 'Aceitando convite...' : 'Aceitar e entrar'}
        </button>
      </form>
    </AuthShell>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium uppercase tracking-wider" style={{ color: '#94A3B8' }}>
        {label}
      </label>
      {children}
    </div>
  )
}
