import { createAdminClient } from '@/lib/supabase/admin'
import { AceitarConviteClient } from './aceitar-convite-client'
import { AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { AuthShell } from '@/components/auth-shell'

export const metadata = { title: 'Aceitar convite — Phone Smart' }

export default async function AceitarConvitePage(props: {
  params: Promise<{ token: string }>
}) {
  const { token } = await props.params
  const admin = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  const { data: invite } = await sb
    .from('tenant_invites')
    .select('id, tenant_id, email, role, expires_at, accepted_at, tenants(name)')
    .eq('token', token)
    .maybeSingle()

  if (!invite) return <ConviteInvalido reason="Convite não encontrado." />
  if (invite.accepted_at) return <ConviteInvalido reason="Esse convite já foi aceito. Faça login normalmente." />
  if (new Date(invite.expires_at) < new Date()) {
    return <ConviteInvalido reason="Convite expirado. Peça um novo pro dono da conta." />
  }

  return (
    <AceitarConviteClient
      token={token}
      email={invite.email}
      role={invite.role}
      tenantName={invite.tenants?.name ?? 'a equipe'}
    />
  )
}

function ConviteInvalido({ reason }: { reason: string }) {
  return (
    <AuthShell>
      <div className="text-center py-6">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
          style={{ background: '#FEF2F2' }}>
          <AlertTriangle className="h-7 w-7" style={{ color: '#EF4444' }} />
        </div>
        <h1 className="text-xl font-bold mb-2" style={{ color: '#F8FAFC' }}>Convite indisponível</h1>
        <p className="text-sm mb-6" style={{ color: '#94A3B8' }}>{reason}</p>
        <Link href="/login"
          className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold transition-opacity hover:opacity-90"
          style={{ background: '#22C55E', color: 'white' }}>
          Ir pra Login
        </Link>
      </div>
    </AuthShell>
  )
}
