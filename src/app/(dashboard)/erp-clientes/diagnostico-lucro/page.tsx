import { requireAuth } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import {
  getProfitDiagnostics, findOrphanSaleItems, getAllCatalogItems, findLosingSales,
  type DiagPeriod,
} from '@/actions/profit-diagnostics'
import { DiagnosticoClient } from './diagnostico-client'

export const metadata = { title: 'Diagnóstico de Lucro — Phone Smart' }

const VALID: DiagPeriod[] = ['7d', '30d', '90d']

export default async function DiagnosticoLucroPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  try { await requireAuth() } catch { redirect('/login') }

  const { period: rawPeriod = '30d' } = await searchParams
  const period = (VALID as string[]).includes(rawPeriod) ? (rawPeriod as DiagPeriod) : '30d'

  const [diag, orphans, catalog, losing] = await Promise.all([
    getProfitDiagnostics(period),
    findOrphanSaleItems(period),
    getAllCatalogItems(),
    findLosingSales(period),
  ])

  return <DiagnosticoClient diag={diag} orphans={orphans} catalog={catalog} losing={losing} />
}
