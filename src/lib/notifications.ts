import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Tipos de notificação. Cada um tem um ícone/cor padrão na UI
 * (NotificationsBell.tsx mapeia type → ícone + cor).
 */
export type NotificationType =
  | 'welcome'                     // boas-vindas após signup
  | 'trial_ending'                // trial vai expirar
  | 'subscription_active'         // pagamento confirmado
  | 'meta_ads_alert'              // campanha com problema
  | 'customer_at_risk'            // cliente sem comprar há X dias
  | 'os_pending'                  // nova OS aguardando
  | 'team_invite_accepted'        // alguém aceitou seu convite
  | 'generic'

export type Notification = {
  id:        string
  type:      NotificationType
  title:     string
  body:      string | null
  link:      string | null
  metadata:  Record<string, unknown> | null
  readAt:    Date | null
  createdAt: Date
}

export type CreateNotificationInput = {
  userId:    string
  tenantId?: string | null
  type:      NotificationType
  title:     string
  body?:     string
  link?:     string
  metadata?: Record<string, unknown>
}

/**
 * Cria uma notificação. Use em Server Actions quando algum evento de negócio
 * acontecer e o user precisar saber (ex: cliente em risco detectado, OS nova).
 *
 * Best-effort: nunca lança exceção. Se falhar, loga e segue — porque o
 * evento de negócio principal não pode quebrar por culpa da notif.
 */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  try {
    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = admin as any
    const { error } = await sb.from('notifications').insert({
      user_id:   input.userId,
      tenant_id: input.tenantId ?? null,
      type:      input.type,
      title:     input.title,
      body:      input.body ?? null,
      link:      input.link ?? null,
      metadata:  input.metadata ?? null,
    })
    if (error) console.error('[createNotification] erro:', error.message)
  } catch (e) {
    console.error('[createNotification] exceção:', e)
  }
}

/**
 * Cria a mesma notif pra múltiplos users de uma vez (ex: avisar todo mundo
 * do tenant que uma OS chegou).
 */
export async function createNotificationForUsers(
  userIds: string[],
  base:    Omit<CreateNotificationInput, 'userId'>,
): Promise<void> {
  if (userIds.length === 0) return
  try {
    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = admin as any
    const rows = userIds.map(userId => ({
      user_id:   userId,
      tenant_id: base.tenantId ?? null,
      type:      base.type,
      title:     base.title,
      body:      base.body ?? null,
      link:      base.link ?? null,
      metadata:  base.metadata ?? null,
    }))
    const { error } = await sb.from('notifications').insert(rows)
    if (error) console.error('[createNotificationForUsers] erro:', error.message)
  } catch (e) {
    console.error('[createNotificationForUsers] exceção:', e)
  }
}
