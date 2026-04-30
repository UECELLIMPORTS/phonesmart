import { requireAuth } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { listProductsWithMeta } from '@/actions/products'
import { EstoqueClient } from './estoque-client'

export const metadata = { title: 'Estoque — Phone Smart' }

export default async function EstoquePage() {
  try { await requireAuth() } catch { redirect('/login') }

  const { products, total, brands, categories } = await listProductsWithMeta()

  return <EstoqueClient initialProducts={products} initialTotal={total} brands={brands} categories={categories} />
}
