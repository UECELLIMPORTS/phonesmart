'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react'
import { AuthShell } from '@/components/auth-shell'

export default function LoginPage() {
  const router  = useRouter()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    setLoading(false)
    if (error) {
      setError('E-mail ou senha incorretos.')
      return
    }
    router.push('/')
    router.refresh()
  }

  return (
    <AuthShell>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#F8FAFC' }}>
          Entrar na sua conta
        </h1>
        <p className="mt-1 text-sm" style={{ color: '#94A3B8' }}>
          Use seu email e senha pra acessar o painel.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="E-mail">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            placeholder="seu@email.com"
            className="auth-input"
          />
        </Field>

        <Field label="Senha">
          <div className="relative">
            <input
              type={showPass ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="auth-input pr-10"
            />
            <button type="button" onClick={() => setShowPass(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2"
              style={{ color: '#64748B' }}>
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

        <button type="submit" disabled={loading} className="auth-btn-primary">
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {loading ? 'Entrando...' : 'Entrar'}
        </button>

        <p className="text-center text-xs">
          <a href="/forgot-password" className="hover:underline" style={{ color: '#94A3B8' }}>
            Esqueci minha senha
          </a>
        </p>
      </form>

      <p className="mt-8 text-center text-sm" style={{ color: '#94A3B8' }}>
        Ainda não tem conta?{' '}
        <a href="/signup" className="font-semibold hover:underline" style={{ color: '#22C55E' }}>
          Criar grátis (7 dias)
        </a>
      </p>
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
