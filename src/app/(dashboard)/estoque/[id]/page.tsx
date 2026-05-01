import { requireAuth } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getProductById } from '@/actions/products'
import { listMovements } from '@/actions/stock-movements'
import { listSerials } from '@/actions/product-serials'
import { MovimentosClient } from './movimentos-client'
import { SerialsPanel } from './serials-panel'

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

  const [product, movements, serials] = await Promise.all([
    getProductById(id).catch(() => null),
    listMovements(id).catch(() => []),
    listSerials(id, 'all').catch(() => []),
  ])

  if (!product) redirect('/estoque')

  return (
    <div className="space-y-6">
      {product.track_serials && (
        <SerialsPanel
          productId={product.id}
          productName={product.name}
          initialSerials={serials}
          defaultCostCents={product.cost_cents}
        />
      )}
      <MovimentosClient product={product} initialMovements={movements} />
    </div>
  )
}
