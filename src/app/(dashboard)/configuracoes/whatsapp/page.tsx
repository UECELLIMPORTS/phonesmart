import { requireAuth } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import {
  getWhatsAppStatus, listTemplates, listRecentMessages,
} from '@/actions/whatsapp'
import { WhatsAppClient } from './whatsapp-client'

export const metadata = { title: 'WhatsApp — Phone Smart' }

export default async function WhatsAppPage() {
  try { await requireAuth() } catch { redirect('/login') }

  const [status, templates, messages] = await Promise.all([
    getWhatsAppStatus(),
    listTemplates(),
    listRecentMessages(20),
  ])

  return <WhatsAppClient initialStatus={status} initialTemplates={templates} initialMessages={messages} />
}
