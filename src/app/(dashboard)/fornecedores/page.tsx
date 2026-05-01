import { requireAuth } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { listSuppliers } from '@/actions/suppliers'
import { FornecedoresClient } from './fornecedores-client'

export const metadata = { title: 'Fornecedores — Phone Smart' }

export default async function FornecedoresPage() {
  try { await requireAuth() } catch { redirect('/login') }

  const suppliers = await listSuppliers(true).catch(() => [])
  return <FornecedoresClient initialSuppliers={suppliers} />
}
