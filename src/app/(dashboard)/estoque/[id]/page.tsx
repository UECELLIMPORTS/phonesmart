import { requireAuth } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getProductById } from '@/actions/products'
import { listMovements } from '@/actions/stock-movements'
import { MovimentosClient } from './movimentos-client'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const product = await getProductById(id).catch(() => null)
  return { title: product ? `${product.name} — Movimentações` : 'Movimentações — Phone Smart' }
}

export default async function MovimentosPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  try { await requireAuth() } catch { redirect('/login') }

  const { id } = await params

  const [product, movements] = await Promise.all([
    getProductById(id).catch(() => null),
    listMovements(id).catch(() => []),
  ])

  if (!product) redirect('/estoque')

  return <MovimentosClient product={product} initialMovements={movements} />
}
