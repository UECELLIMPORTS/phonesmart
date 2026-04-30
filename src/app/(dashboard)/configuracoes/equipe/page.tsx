import { requireAuth } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { listTeamMembers, listPendingInvites } from '@/actions/team'
import { EquipeClient } from './equipe-client'
import Link from 'next/link'
import { ArrowLeft, Lock } from 'lucide-react'

export const metadata = { title: 'Equipe — Phone Smart' }

export default async function EquipePage() {
  let auth: Awaited<ReturnType<typeof requireAuth>>
  try { auth = await requireAuth() } catch { redirect('/login') }

  const isOwner = auth.user.app_metadata?.tenant_role === 'owner'

  // Gate owner-only — manager não acessa essa página
  if (!isOwner) {
    return (
      <div className="max-w-2xl">
        <Link href="/configuracoes" className="inline-flex items-center gap-1.5 text-xs hover:underline mb-4"
          style={{ color: '#94A3B8' }}>
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar pra Configurações
        </Link>
        <div className="rounded-2xl border p-8 text-center"
          style={{ background: '#131C2A', borderColor: 'rgba(255,77,109,.3)' }}>
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border"
            style={{ background: 'rgba(255,77,109,.1)', borderColor: 'rgba(255,77,109,.3)' }}>
            <Lock className="h-7 w-7" style={{ color: '#EF4444' }} />
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: '#F8FAFC' }}>Acesso restrito</h1>
          <p className="text-sm" style={{ color: '#CBD5E1' }}>
            Apenas o dono da conta pode gerenciar a equipe.
          </p>
        </div>
      </div>
    )
  }

  const [members, invites] = await Promise.all([
    listTeamMembers(),
    listPendingInvites(),
  ])

  return <EquipeClient members={members} invites={invites} ownerEmail={auth.user.email ?? ''} />
}
