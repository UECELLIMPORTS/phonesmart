'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Bell, Check, Sparkles, AlertTriangle, TrendingUp, Users,
  Wrench, CreditCard, MailCheck, Inbox, Loader2,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  listMyNotifications, countUnreadNotifications,
  markNotificationAsRead, markAllNotificationsAsRead,
} from '@/actions/notifications'
import type { Notification, NotificationType } from '@/lib/notifications'

/** Mapeia type → ícone + cor visual. */
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
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

export function NotificationsBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  // Carrega contador inicial
  const refreshCount = useCallback(async () => {
    const c = await countUnreadNotifications()
    setUnread(c)
  }, [])

  useEffect(() => { refreshCount() }, [refreshCount])

  // Realtime: subscribe em INSERT na tabela notifications
  useEffect(() => {
    const supabase = createClient()
    let userId: string | null = null

    supabase.auth.getUser().then(({ data }) => {
      userId = data.user?.id ?? null
      if (!userId) return

      const channel = supabase
        .channel('notifications-bell')
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
          () => {
            // Quando chega notif nova, recarrega contador e (se aberto) lista
            refreshCount()
            if (open) loadList()
          },
        )
        .subscribe()

      return () => { supabase.removeChannel(channel) }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshCount])

  // Fecha dropdown ao clicar fora
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [open])

  async function loadList() {
    setLoading(true)
    const list = await listMyNotifications(30)
    setItems(list)
    setLoading(false)
  }

  function toggleOpen() {
    if (!open) loadList()
    setOpen(!open)
  }

  async function handleClick(n: Notification) {
    if (!n.readAt) {
      await markNotificationAsRead(n.id)
      setUnread(c => Math.max(0, c - 1))
      setItems(arr => arr.map(i => i.id === n.id ? { ...i, readAt: new Date() } : i))
    }
    if (n.link) {
      setOpen(false)
      router.push(n.link)
    }
  }

  async function handleMarkAllRead() {
    await markAllNotificationsAsRead()
    setUnread(0)
    setItems(arr => arr.map(i => ({ ...i, readAt: i.readAt ?? new Date() })))
  }

  return (
    <div className="relative" ref={dropRef}>
      <button
        onClick={toggleOpen}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border transition-colors hover:bg-card"
        style={{ borderColor: '#2A3650', color: '#94A3B8' }}
        aria-label={`Notificações${unread > 0 ? ` (${unread} não lidas)` : ''}`}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold"
            style={{ background: '#EF4444', color: '#fff' }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-12 z-50 w-80 sm:w-96 rounded-xl border overflow-hidden"
          style={{
            background: '#1B2638',
            borderColor: '#3A4868',
            boxShadow: '0 12px 36px rgba(0,0,0,0.65)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b"
            style={{ borderColor: '#2A3650' }}>
            <p className="text-sm font-bold" style={{ color: '#F8FAFC' }}>
              Notificações {unread > 0 && (
                <span className="text-xs font-normal" style={{ color: '#CBD5E1' }}>
                  · {unread} não lida{unread !== 1 ? 's' : ''}
                </span>
              )}
            </p>
            {unread > 0 && (
              <button onClick={handleMarkAllRead}
                className="inline-flex items-center gap-1 text-[11px] font-semibold hover:underline"
                style={{ color: '#22C55E' }}>
                <Check className="h-3 w-3" /> Marcar todas
              </button>
            )}
          </div>

          {/* Lista */}
          <div className="max-h-96 overflow-y-auto">
            {loading && items.length === 0 ? (
              <div className="flex items-center justify-center py-12" style={{ color: '#94A3B8' }}>
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-6" style={{ color: '#94A3B8' }}>
                <Inbox className="h-8 w-8 mb-2" />
                <p className="text-sm">Você não tem notificações ainda.</p>
                <p className="text-xs mt-1">Avisos importantes vão aparecer aqui.</p>
              </div>
            ) : (
              <ul>
                {items.map(n => {
                  const { icon: Icon, color } = ICONS[n.type] ?? ICONS.generic
                  const isUnread = !n.readAt
                  return (
                    <li key={n.id}>
                      <button
                        onClick={() => handleClick(n)}
                        className="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03] border-b"
                        style={{
                          borderColor: '#2A3650',
                          background: isUnread ? 'rgba(34,197,94,.04)' : undefined,
                        }}
                      >
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg shrink-0 border"
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
                            <p className="text-xs mt-0.5" style={{ color: '#CBD5E1' }}>{n.body}</p>
                          )}
                          <p className="text-[10px] mt-1" style={{ color: '#94A3B8' }}>
                            {timeAgo(n.createdAt)}
                          </p>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* Footer */}
          {items.length > 0 && (
            <div className="border-t px-4 py-2 text-center" style={{ borderColor: '#2A3650' }}>
              <Link href="/notificacoes" onClick={() => setOpen(false)}
                className="text-xs font-semibold hover:underline" style={{ color: '#22C55E' }}>
                Ver todas
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
