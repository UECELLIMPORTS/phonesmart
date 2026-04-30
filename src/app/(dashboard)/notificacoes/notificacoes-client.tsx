'use client'

/**
 * Lista completa de notificações do user. Permite marcar como lida (clicando)
 * ou marcar todas. Reusa os ícones/cores do componente NotificationsBell.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bell, Check, Sparkles, AlertTriangle, TrendingUp, Users,
  Wrench, CreditCard, MailCheck, Inbox,
} from 'lucide-react'
import {
  markNotificationAsRead, markAllNotificationsAsRead,
} from '@/actions/notifications'
import type { Notification, NotificationType } from '@/lib/notifications'
import { toast } from 'sonner'

const ICONS: Record<NotificationType, { icon: React.ElementType; color: string }> = {
  welcome:                 { icon: Sparkles,      color: '#10B981' },
  trial_ending:            { icon: AlertTriangle, color: '#F59E0B' },
  subscription_active:     { icon: CreditCard,    color: '#10B981' },
  meta_ads_alert:          { icon: TrendingUp,    color: '#E4405F' },
  customer_at_risk:        { icon: Users,         color: '#EF4444' },
  os_pending:              { icon: Wrench,        color: '#F59E0B' },
  team_invite_accepted:    { icon: MailCheck,     color: '#22C55E' },
  generic:                 { icon: Bell,          color: '#CBD5E1' },
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60)     return 'agora'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60)     return `${minutes} min atrás`
  const hours = Math.floor(minutes / 60)
  if (hours < 24)       return `${hours}h atrás`
  const days = Math.floor(hours / 24)
  if (days < 30)        return `${days}d atrás`
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

type Props = { initialItems: Notification[]; initialUnread: number }

export function NotificacoesClient({ initialItems, initialUnread }: Props) {
  const router = useRouter()
  const [items, setItems] = useState<Notification[]>(initialItems)
  const [unread, setUnread] = useState(initialUnread)
  const [busy, setBusy] = useState(false)

  async function handleClick(n: Notification) {
    if (!n.readAt) {
      await markNotificationAsRead(n.id)
      setUnread(c => Math.max(0, c - 1))
      setItems(arr => arr.map(i => i.id === n.id ? { ...i, readAt: new Date() } : i))
    }
    if (n.link) router.push(n.link)
  }

  async function handleMarkAllRead() {
    setBusy(true)
    await markAllNotificationsAsRead()
    setUnread(0)
    setItems(arr => arr.map(i => ({ ...i, readAt: i.readAt ?? new Date() })))
    setBusy(false)
    toast.success('Todas marcadas como lidas.')
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border p-12 text-center"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}>
        <Inbox className="h-12 w-12 mx-auto mb-3" style={{ color: '#94A3B8' }} />
        <p className="text-sm font-bold" style={{ color: '#F8FAFC' }}>
          Você não tem notificações ainda
        </p>
        <p className="text-xs mt-1" style={{ color: '#CBD5E1' }}>
          Avisos importantes vão aparecer aqui — alertas de pagamento, alertas Meta Ads,
          OS pendentes, e muito mais.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Toolbar: marcar todas */}
      {unread > 0 && (
        <div className="flex items-center justify-end">
          <button onClick={handleMarkAllRead} disabled={busy}
            className="inline-flex items-center gap-1.5 text-xs font-semibold hover:underline disabled:opacity-50"
            style={{ color: '#22C55E' }}>
            <Check className="h-3.5 w-3.5" /> Marcar todas como lidas
          </button>
        </div>
      )}

      {/* Lista */}
      <ul className="rounded-2xl border overflow-hidden"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}>
        {items.map(n => {
          const { icon: Icon, color } = ICONS[n.type] ?? ICONS.generic
          const isUnread = !n.readAt
          return (
            <li key={n.id} className="border-b last:border-b-0" style={{ borderColor: '#2A3650' }}>
              <button onClick={() => handleClick(n)}
                className="w-full flex items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-white/[0.03]"
                style={{ background: isUnread ? 'rgba(34,197,94,.04)' : undefined }}>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg shrink-0 border"
                  style={{ background: `${color}15`, borderColor: `${color}40` }}>
                  <Icon className="h-4 w-4" style={{ color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold truncate" style={{ color: '#F8FAFC' }}>
                      {n.title}
                    </p>
                    {isUnread && (
                      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: '#22C55E' }} />
                    )}
                  </div>
                  {n.body && (
                    <p className="text-xs mt-1" style={{ color: '#CBD5E1' }}>{n.body}</p>
                  )}
                  <p className="text-[10px] mt-1.5" style={{ color: '#94A3B8' }}>
                    {timeAgo(n.createdAt)}
                  </p>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
