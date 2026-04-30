'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { LogOut, Sparkles, Crown, Zap, AlertTriangle, Clock } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { MobileNav } from './mobile-nav'
import { NotificationsBell } from './notifications-bell'
import type { ModuleKey } from '@/lib/permissions-shared'

export type PlanBadge = {
  label: string
  kind:  'trial' | 'pending' | 'late' | 'basico' | 'pro' | 'premium'
}

type Props = {
  userName:        string
  userEmail:       string
  planBadge:       PlanBadge | null
  hasFullAccess?:  boolean
  allowedModules?: ModuleKey[]
  isOwner?:        boolean
}

const BADGE_STYLES: Record<PlanBadge['kind'], { bg: string; color: string; border: string; icon: React.ElementType }> = {
  trial:    { bg: 'rgba(255,184,0,.12)',   color: '#F59E0B', border: 'rgba(255,184,0,.3)', icon: Clock },
  pending:  { bg: 'rgba(255,77,109,.12)',  color: '#EF4444', border: 'rgba(255,77,109,.3)', icon: AlertTriangle },
  late:     { bg: 'rgba(255,77,109,.12)',  color: '#EF4444', border: 'rgba(255,77,109,.4)', icon: AlertTriangle },
  basico:   { bg: 'rgba(138,168,200,.12)', color: '#CBD5E1', border: 'rgba(138,168,200,.3)', icon: Sparkles },
  pro:      { bg: 'rgba(34,197,94,.12)',   color: '#22C55E', border: 'rgba(34,197,94,.3)', icon: Zap },
  premium:  { bg: 'rgba(16,185,129,.12)',   color: '#10B981', border: 'rgba(16,185,129,.4)', icon: Crown },
}

export function Topbar({
  userName, userEmail, planBadge,
  hasFullAccess = true, allowedModules = [], isOwner = true,
}: Props) {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    toast.success('Sessão encerrada.')
    router.push('/login')
    router.refresh()
  }

  const initials = userName
    ? userName.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()
    : userEmail?.slice(0, 2).toUpperCase() ?? 'U'

  return (
    <header
      // No mobile (left:0) ocupa tela toda; em lg+ recua 240px pra dar espaço pra Sidebar.
      // z-50 (acima da sidebar z-40) pra que dropdowns filhos (notifs, badge plano)
      // possam sobrepor a sidebar quando expandem pra esquerda.
      className="fixed right-0 top-0 z-50 flex h-16 items-center justify-between border-b px-4 sm:px-6 left-0 lg:left-60"
      style={{ background: '#131C2A', borderColor: '#2A3650' }}
    >
      {/* Slot esquerdo: hamburger no mobile */}
      <MobileNav hasFullAccess={hasFullAccess} allowedModules={allowedModules} isOwner={isOwner} />

      <div className="flex items-center gap-3">
        {/* Badge do plano atual — clicável vai pra página de assinatura */}
        {planBadge && (() => {
          const s = BADGE_STYLES[planBadge.kind]
          const Icon = s.icon
          return (
            <Link href="/configuracoes/assinatura"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
              style={{ background: s.bg, color: s.color, borderColor: s.border }}>
              <Icon className="h-3.5 w-3.5" />
              {planBadge.label}
            </Link>
          )
        })()}

        {/* Notificações */}
        <NotificationsBell />

        {/* Usuário */}
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold"
            style={{ background: 'linear-gradient(135deg, #22C55E, #22D3EE)', color: '#131C2A' }}
          >
            {initials}
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-medium text-text leading-none">{userName || userEmail}</p>
            <p className="mt-0.5 text-xs leading-none" style={{ color: '#94A3B8' }}>{userEmail}</p>
          </div>
        </div>

        {/* Sair */}
        <button
          onClick={handleSignOut}
          className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium
            transition-colors hover:bg-card"
          style={{ borderColor: '#2A3650', color: '#94A3B8' }}
        >
          <LogOut className="h-3.5 w-3.5" />
          Sair
        </button>
      </div>
    </header>
  )
}
