'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff, Loader2, ArrowRight, Check, AlertCircle } from 'lucide-react'
import { signupTenant, loginAfterSignup } from '@/actions/signup'
import { AuthShell } from '@/components/auth-shell'

export default function SignupPage() {
  const router = useRouter()
  const [fullName, setFullName]     = useState('')
  const [tenantName, setTenantName] = useState('')
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [showPass, setShowPass]     = useState(false)
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const result = await signupTenant({ fullName, tenantName, email, password })
    if (!result.ok) {
      setLoading(false)
      setError(result.error)
      return
    }

    const login = await loginAfterSignup(email, password)
    setLoading(false)
    if (!login.ok) {
      router.push('/login?signed_up=1')
      return
    }
    router.push('/')
    router.refresh()
  }

  const ready =
    fullName.trim().length >= 2 &&
    tenantName.trim().length >= 2 &&
    /^\S+@\S+\.\S+$/.test(email) &&
    password.length >= 8

  return (
    <AuthShell>
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#F8FAFC' }}>
          Comece agora — 7 dias grátis
        </h1>
        <p className="mt-1 text-sm" style={{ color: '#94A3B8' }}>
          Sem cartão de crédito. Cancele quando quiser.
        </p>
      </div>

      <ul className="mb-6 space-y-2 text-xs" style={{ color: '#CBD5E1' }}>
        <li className="flex items-center gap-2">
          <Check className="h-3.5 w-3.5 shrink-0" style={{ color: '#10B981' }} />
          Todos os recursos do plano Premium liberados no trial
        </li>
        <li className="flex items-center gap-2">
          <Check className="h-3.5 w-3.5 shrink-0" style={{ color: '#10B981' }} />
          Suporte por WhatsApp incluso desde o primeiro dia
        </li>
      </ul>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Seu nome completo">
          <input value={fullName} onChange={e => setFullName(e.target.value)}
            placeholder="João Silva" required autoComplete="name"
            className="auth-input" />
        </Field>

        <Field label="Nome da sua empresa">
          <input value={tenantName} onChange={e => setTenantName(e.target.value)}
            placeholder="Minha Loja LTDA" required
            className="auth-input" />
        </Field>

        <Field label="E-mail">
          <input value={email} onChange={e => setEmail(e.target.value)}
            type="email" placeholder="voce@empresa.com.br" required autoComplete="email"
            className="auth-input" />
        </Field>

        <Field label="Senha (mínimo 8 caracteres)">
          <div className="relative">
            <input value={password} onChange={e => setPassword(e.target.value)}
              type={showPass ? 'text' : 'password'} placeholder="••••••••"
              required autoComplete="new-password" minLength={8}
              className="auth-input pr-10" />
            <button type="button" onClick={() => setShowPass(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2"
              tabIndex={-1} aria-label="Mostrar/esconder senha"
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

        <button type="submit" disabled={!ready || loading} className="auth-btn-primary">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {loading ? 'Criando sua conta...' : 'Começar 7 dias grátis'}
        </button>
      </form>

      <p className="mt-4 text-center text-[11px]" style={{ color: '#64748B' }}>
        Ao criar a conta você concorda com nossos{' '}
        <a href="https://phonesmart.vercel.app/termos"
          target="_blank" rel="noopener noreferrer"
          className="underline transition-opacity hover:opacity-80"
          style={{ color: '#22C55E' }}>Termos de Uso</a>
        {' '}e{' '}
        <a href="https://phonesmart.vercel.app/privacidade"
          target="_blank" rel="noopener noreferrer"
          className="underline transition-opacity hover:opacity-80"
          style={{ color: '#22C55E' }}>Política de Privacidade</a>.
      </p>

      <p className="mt-8 text-center text-sm" style={{ color: '#94A3B8' }}>
        Já tem conta?{' '}
        <Link href="/login" className="font-semibold hover:underline" style={{ color: '#22C55E' }}>
          Fazer login
        </Link>
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
