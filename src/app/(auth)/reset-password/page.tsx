'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff, Loader2, ArrowRight, CheckCircle, AlertTriangle, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { AuthShell } from '@/components/auth-shell'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [done, setDone]         = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [validSession, setValidSession] = useState<boolean | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      setValidSession(!!data.session)
    })
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (password.length < 8) { setError('Senha precisa ter pelo menos 8 caracteres.'); return }
    if (password !== confirm) { setError('As senhas não conferem.'); return }

    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      setError('Erro ao atualizar senha. Tente solicitar o link novamente.')
      return
    }
    setDone(true)
    setTimeout(() => router.push('/'), 2500)
  }

  return (
    <AuthShell>
      {validSession === false ? (
        <div className="text-center py-6">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: '#FEF2F2' }}>
            <AlertTriangle className="h-7 w-7" style={{ color: '#EF4444' }} />
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: '#F8FAFC' }}>Link expirado ou inválido</h1>
          <p className="text-sm mb-4" style={{ color: '#94A3B8' }}>
            Este link não é mais válido (links de recuperação expiram em 1 hora).
          </p>
          <Link href="/forgot-password"
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold transition-opacity hover:opacity-90"
            style={{ background: '#22C55E', color: 'white' }}>
            Solicitar novo link
          </Link>
        </div>
      ) : done ? (
        <div className="text-center py-6">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: '#ECFDF5' }}>
            <CheckCircle className="h-7 w-7" style={{ color: '#10B981' }} />
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: '#F8FAFC' }}>Senha atualizada!</h1>
          <p className="text-sm" style={{ color: '#94A3B8' }}>
            Redirecionando pro dashboard…
          </p>
        </div>
      ) : (
        <>
          <div className="mb-8">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#F8FAFC' }}>
              Criar nova senha
            </h1>
            <p className="mt-1 text-sm" style={{ color: '#94A3B8' }}>
              Defina sua nova senha de acesso.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Nova senha (mínimo 8 caracteres)">
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

            <Field label="Confirme a nova senha">
              <input value={confirm} onChange={e => setConfirm(e.target.value)}
                type={showPass ? 'text' : 'password'} placeholder="••••••••"
                required minLength={8} autoComplete="new-password"
                className="auth-input" />
            </Field>

            {error && (
              <div className="rounded-lg border px-3 py-2.5 text-sm flex items-start gap-2"
                style={{ background: '#FEF2F2', borderColor: '#FECACA', color: '#B91C1C' }}>
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" disabled={loading || validSession !== true} className="auth-btn-primary">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {loading ? 'Atualizando...' : 'Atualizar senha'}
            </button>
          </form>
        </>
      )}
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
