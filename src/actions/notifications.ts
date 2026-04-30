'use server'

import { revalidatePath } from 'next/cache'
import { requireAuth } from '@/lib/supabase/server'
import type { Notification, NotificationType } from '@/lib/notifications'

/**
 * Lista notificações do user logado, mais recentes primeiro.
 * Por padrão limita a 30 (lista do dropdown). Pra histórico completo,
 * usar parâmetro maior.
 */
export async function listMyNotifications(limit = 30): Promise<Notification[]> {
  const { supabase } = await requireAuth()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data, error } = await sb
    .from('notifications')
    .select('id, type, title, body, link, metadata, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('[listMyNotifications] erro:', error.message)
    return []
  }

  type Row = {
    id: string; type: NotificationType; title: string; body: string | null
    link: string | null; metadata: Record<string, unknown> | null
    read_at: string | null; created_at: string
  }
  return ((data ?? []) as Row[]).map(r => ({
    id:        r.id,
    type:      r.type,
    title:     r.title,
    body:      r.body,
    link:      r.link,
    metadata:  r.metadata,
    readAt:    r.read_at    ? new Date(r.read_at)    : null,
    createdAt: new Date(r.created_at),
  }))
}

/** Conta notifs não lidas do user logado (pra badge no sino). */
export async function countUnreadNotifications(): Promise<number> {
  const { supabase } = await requireAuth()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { count, error } = await sb
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)

  if (error) {
    console.error('[countUnreadNotifications] erro:', error.message)
    return 0
  }
  return count ?? 0
}

/** Marca uma notif específica como lida. */
export async function markNotificationAsRead(id: string): Promise<void> {
  const { supabase } = await requireAuth()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .is('read_at', null)

  if (error) console.error('[markNotificationAsRead] erro:', error.message)
  revalidatePath('/', 'layout')
}

/** Marca todas as não-lidas do user como lidas. */
export async function markAllNotificationsAsRead(): Promise<void> {
  const { supabase, user } = await requireAuth()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { error } = await sb
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null)

  if (error) console.error('[markAllNotificationsAsRead] erro:', error.message)
  revalidatePath('/', 'layout')
}
