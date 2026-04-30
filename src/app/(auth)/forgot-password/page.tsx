'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, ArrowRight, ArrowLeft, Mail, CheckCircle, AlertCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { AuthShell } from '@/components/auth-shell'

export default function ForgotPasswordPage() {
  const [email, setEmail]     = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent]       = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    setLoading(false)
    if (error) {
      setError('Erro ao enviar email. Verifique se o endereço está correto.')
      return
    }
    setSent(true)
  }

  return (
    <AuthShell>
      <Link href="/login" className="inline-flex items-center gap-1.5 text-xs hover:underline mb-6"
        style={{ color: '#94A3B8' }}>
        <ArrowLeft className="h-3.5 w-3.5" /> Voltar pra login
      </Link>

      {sent ? (
        <div className="text-center py-6">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
            style={{ background: '#ECFDF5' }}>
            <CheckCircle className="h-7 w-7" style={{ color: '#10B981' }} />
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: '#F8FAFC' }}>Email enviado!</h1>
          <p className="text-sm" style={{ color: '#94A3B8' }}>
            Se essa conta existe, em alguns segundos você vai receber um email
            em <strong style={{ color: '#F8FAFC' }}>{email}</strong> com o link pra criar nova senha.
          </p>
          <p className="mt-4 text-xs" style={{ color: '#64748B' }}>
            Não chegou? Verifica a pasta de spam.
          </p>
        </div>
      ) : (
        <>
          <div className="mb-8">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#F8FAFC' }}>
              Esqueci minha senha
            </h1>
            <p className="mt-1 text-sm" style={{ color: '#94A3B8' }}>
              Digite seu email pra receber o link de recuperação.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wider" style={{ color: '#94A3B8' }}>
                E-mail
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none"
                  style={{ color: '#64748B' }} />
                <input value={email} onChange={e => setEmail(e.target.value)}
                  type="email" placeholder="seu@email.com" required autoComplete="email"
                  className="auth-input pl-9" />
              </div>
            </div>

            {error && (
              <div className="rounded-lg border px-3 py-2.5 text-sm flex items-start gap-2"
                style={{ background: '#FEF2F2', borderColor: '#FECACA', color: '#B91C1C' }}>
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" disabled={loading || !email} className="auth-btn-primary">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {loading ? 'Enviando...' : 'Enviar link de recuperação'}
            </button>
          </form>
        </>
      )}
    </AuthShell>
  )
}
