import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Bell } from 'lucide-react'
import { requireAuth } from '@/lib/supabase/server'
import { listMyNotifications, countUnreadNotifications } from '@/actions/notifications'
import { NotificacoesClient } from './notificacoes-client'

export const metadata = { title: 'Notificações — Phone Smart' }

export default async function NotificacoesPage() {
  try { await requireAuth() } catch { redirect('/login') }

  // Histórico completo (até 200 — pra mais que isso, paginar depois)
  const [items, unread] = await Promise.all([
    listMyNotifications(200),
    countUnreadNotifications(),
  ])

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs hover:underline mb-2"
          style={{ color: '#94A3B8' }}>
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar pro Dashboard
        </Link>
        <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: '#F8FAFC' }}>
          <Bell className="h-5 w-5" style={{ color: '#22C55E' }} />
          Notificações
        </h1>
        <p className="mt-1 text-sm" style={{ color: '#94A3B8' }}>
          Histórico completo de avisos, alertas e atualizações da sua conta.
          {unread > 0 && (
            <span className="ml-2" style={{ color: '#22C55E' }}>
              · {unread} não lida{unread !== 1 ? 's' : ''}
            </span>
          )}
        </p>
      </div>

      <NotificacoesClient initialItems={items} initialUnread={unread} />
    </div>
  )
}
