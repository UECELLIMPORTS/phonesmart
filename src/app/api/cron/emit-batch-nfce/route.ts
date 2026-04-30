/**
 * Cron — Emite NFC-e em lote pra tenants com emission_mode='batch'.
 *
 * Configurado em vercel.json pra rodar 01:00 UTC todo dia (= 22:00 BRT).
 *
 * Lógica:
 *  1. Busca todas fiscal_configs com enabled=true && emission_mode='batch'
 *  2. Pra cada tenant, busca vendas do dia (created_at >= 00:00 BRT) que
 *     ainda não têm fiscal_emission ou que tiveram apenas rejected
 *  3. Pra cada venda, chama emitNfceCore(tenantId, saleId) sequencial
 *
 * Auth: header Authorization: Bearer ${CRON_SECRET}
 *
 * Timeout do Vercel Cron Hobby = 60s; Pro = 300s. Em caso de muitas vendas,
 * Focus pode levar ~2-5s por nota — vai ficar limitado pelo timeout. Se
 * necessário, dividir em chunks ou rodar com schedule mais frequente.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { emitNfceCore } from '@/lib/fiscal-emit-core'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Pro plan; ignorado em Hobby

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET não configurado' }, { status: 500 })
  }
  if (authHeader !== expected) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  // 1. Tenants em modo batch com emissão habilitada
  const { data: configs, error: cfgErr } = await sb
    .from('fiscal_configs')
    .select('tenant_id')
    .eq('enabled', true)
    .eq('emission_mode', 'batch')

  if (cfgErr) {
    console.error('[emit-batch-nfce] erro ao buscar configs:', cfgErr.message)
    return NextResponse.json({ error: cfgErr.message }, { status: 500 })
  }

  type Cfg = { tenant_id: string }
  const tenants = (configs ?? []) as Cfg[]
  if (tenants.length === 0) {
    return NextResponse.json({ ok: true, tenants: 0, emitted: 0, message: 'Nenhum tenant em modo batch.' })
  }

  // Janela: vendas das últimas 24h (cobre o dia BRT mesmo com diferenças de TZ)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  type TenantReport = {
    tenantId: string
    sales:    number
    emitted:  number
    failed:   number
    errors:   { saleId: string; error: string }[]
  }
  const reports: TenantReport[] = []
  let totalEmitted = 0
  let totalFailed  = 0

  for (const cfg of tenants) {
    const report: TenantReport = { tenantId: cfg.tenant_id, sales: 0, emitted: 0, failed: 0, errors: [] }

    // Busca vendas do tenant no período sem emissão autorizada/processing/cancelled
    const { data: sales, error: saleErr } = await sb
      .from('sales')
      .select('id, fiscal_emissions ( id, status )')
      .eq('tenant_id', cfg.tenant_id)
      .gte('created_at', since)
      .neq('status', 'cancelled')
      .limit(500)

    if (saleErr) {
      console.error(`[emit-batch-nfce] tenant=${cfg.tenant_id} erro ao buscar vendas:`, saleErr.message)
      report.errors.push({ saleId: '*', error: saleErr.message })
      reports.push(report)
      continue
    }

    type SaleRow = { id: string; fiscal_emissions: { id: string; status: string }[] | null }
    const rows = (sales ?? []) as SaleRow[]

    // Filtra: sem emissão ativa (autorized/processing/draft/cancelled). Só
    // tenta de novo se todas as emissões anteriores estão rejected.
    const pending = rows.filter(s => {
      const emis = s.fiscal_emissions ?? []
      if (emis.length === 0) return true
      return emis.every(e => e.status === 'rejected')
    })

    report.sales = pending.length

    for (const s of pending) {
      try {
        const result = await emitNfceCore(cfg.tenant_id, s.id)
        if (result.ok) {
          report.emitted++
          totalEmitted++
        } else {
          report.failed++
          totalFailed++
          report.errors.push({ saleId: s.id, error: result.error })
        }
      } catch (e) {
        report.failed++
        totalFailed++
        report.errors.push({ saleId: s.id, error: e instanceof Error ? e.message : String(e) })
      }
    }

    reports.push(report)
    console.log(`[emit-batch-nfce] tenant=${cfg.tenant_id} sales=${report.sales} emitted=${report.emitted} failed=${report.failed}`)
  }

  return NextResponse.json({
    ok:           true,
    tenants:      tenants.length,
    totalEmitted,
    totalFailed,
    reports,
    timestamp:    new Date().toISOString(),
  })
}
