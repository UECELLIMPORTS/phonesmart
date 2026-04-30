'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, CheckCircle2, ShoppingCart, Wrench, Package, Loader2, Link2, Unlink, TrendingDown } from 'lucide-react'
import {
  backfillSaleItemsCostSnapshot, linkOrphanSaleItem, autoLinkExactMatches, unlinkSaleItem,
  type ProfitDiagnostics, type DiagPeriod, type OrphanSaleItem, type CatalogItem, type LosingSale,
} from '@/actions/profit-diagnostics'

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(c / 100)
    .replace(/ /g, ' ')
    .replace(/ /g, ' ')

const DT = (iso: string) => {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

const PERIODS: { v: DiagPeriod; label: string }[] = [
  { v: '7d',  label: '7 dias' },
  { v: '30d', label: '30 dias' },
  { v: '90d', label: '90 dias' },
]

export function DiagnosticoClient({
  diag, orphans, catalog, losing,
}: {
  diag: ProfitDiagnostics; orphans: OrphanSaleItem[]; catalog: CatalogItem[]; losing: LosingSale[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<{ updated: number; skipped: number } | null>(null)
  const [error,  setError]  = useState<string | null>(null)
  const [autoLinkResult, setAutoLinkResult] = useState<{ linked: number; skipped: number } | null>(null)
  const [linkPending, setLinkPending] = useState<string | null>(null)   // saleItemId em ação
  const [linkError,   setLinkError]   = useState<string | null>(null)

  const uniqueExactCount = orphans.filter(o => o.hasUniqueExact).length
  const totalLosingCents = losing.reduce((s, l) => s + l.profitCents, 0)   // negativo

  const onUnlink = (saleItemId: string, itemName: string) => {
    if (!confirm(
      `Desvincular o item "${itemName}"?\n\n` +
      `Vai remover product_id e cost_snapshot_cents desse item — ele volta a ser órfão. ` +
      `Use isso quando você vinculou ao produto errado.`
    )) return
    setLinkError(null)
    setLinkPending(saleItemId)
    startTransition(async () => {
      try {
        await unlinkSaleItem(saleItemId)
        router.refresh()
      } catch (e) {
        setLinkError(e instanceof Error ? e.message : 'Erro ao desvincular item.')
      } finally {
        setLinkPending(null)
      }
    })
  }

  const onAutoLink = () => {
    if (!confirm(
      `Vai vincular automaticamente ${uniqueExactCount} item(s) que tem 1 match exato único no estoque.\n\n` +
      `Cada item vai ganhar product_id + cost_snapshot_cents preenchido com o custo atual do produto.\n\n` +
      `Continuar?`
    )) return
    setLinkError(null); setAutoLinkResult(null)
    startTransition(async () => {
      try {
        const r = await autoLinkExactMatches(diag.period)
        setAutoLinkResult(r)
        router.refresh()
      } catch (e) {
        setLinkError(e instanceof Error ? e.message : 'Erro ao vincular itens.')
      }
    })
  }

  const onLinkOne = (saleItemId: string, productId: string, productName: string) => {
    if (!confirm(`Vincular esse item ao produto "${productName}"?`)) return
    setLinkError(null)
    setLinkPending(saleItemId)
    startTransition(async () => {
      try {
        await linkOrphanSaleItem(saleItemId, productId)
        router.refresh()
      } catch (e) {
        setLinkError(e instanceof Error ? e.message : 'Erro ao vincular item.')
      } finally {
        setLinkPending(null)
      }
    })
  }

  const onBackfill = () => {
    if (!confirm(
      `Vai preencher cost_snapshot_cents em ${diag.fixableSnapshotsCount} item(s) usando o custo ATUAL do produto.\n\n` +
      `Atenção: se o custo do produto mudou desde a venda, o lucro vai refletir o custo atual, não o histórico real. ` +
      `Mesmo assim, é mais correto que o estado atual (lucro = receita).\n\n` +
      `Continuar?`
    )) return

    setError(null); setResult(null)
    startTransition(async () => {
      try {
        const r = await backfillSaleItemsCostSnapshot()
        setResult(r)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao executar backfill.')
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href="/erp-clientes" className="inline-flex items-center gap-1.5 text-xs hover:underline mb-2" style={{ color: '#94A3B8' }}>
            <ArrowLeft className="h-3.5 w-3.5" /> Voltar pra ERP Clientes
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: '#F8FAFC' }}>
            <AlertTriangle className="h-5 w-5" style={{ color: '#F59E0B' }} />
            Diagnóstico de Lucro
          </h1>
          <p className="mt-1 text-sm" style={{ color: '#94A3B8' }}>
            Identifica vendas e OSs onde o lucro está aparecendo igual à receita por falta de custo cadastrado.
          </p>
        </div>
        <div className="flex gap-1 rounded-xl p-1" style={{ background: '#1B2638', border: '1px solid #2A3650' }}>
          {PERIODS.map(p => (
            <button key={p.v}
              onClick={() => router.push(`/erp-clientes/diagnostico-lucro?period=${p.v}`)}
              className="rounded-lg px-3 py-1.5 text-xs font-bold transition-all"
              style={diag.period === p.v
                ? { background: '#22C55E', color: '#131C2A' }
                : { color: '#94A3B8' }
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Itens órfãos (sem product_id)" value={String(orphans.length)}        color={orphans.length > 0 ? '#EF4444' : '#10B981'} />
        <Stat label="Vendas com prejuízo"           value={String(losing.length)}         color={losing.length > 0 ? '#EF4444' : '#10B981'} />
        <Stat label="OSs suspeitas"                 value={String(diag.suspiciousOsCount)} color={diag.suspiciousOsCount > 0 ? '#EF4444' : '#10B981'} />
        <Stat label="Match exato único"             value={String(uniqueExactCount)}      color="#10B981" />
      </div>

      {/* Banner de correção automática */}
      {diag.fixableSnapshotsCount > 0 && (
        <div className="rounded-2xl border p-5" style={{ background: 'rgba(34,197,94,.04)', borderColor: 'rgba(34,197,94,.3)' }}>
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 mt-0.5 shrink-0" style={{ color: '#22C55E' }} />
            <div className="flex-1">
              <p className="text-sm font-bold" style={{ color: '#22C55E' }}>
                Correção automática disponível pra {diag.fixableSnapshotsCount} item(s)
              </p>
              <p className="text-xs mt-1" style={{ color: '#F8FAFC' }}>
                Esses itens estão com <code style={{ color: '#CBD5E1' }}>cost_snapshot_cents</code> NULL/0,
                mas o produto referenciado tem <code style={{ color: '#CBD5E1' }}>products.cost_cents</code> &gt; 0.
                Posso copiar esse custo atual pro snapshot — vai destravar o cálculo de lucro dessas vendas.
              </p>
              <p className="text-[11px] mt-2" style={{ color: '#CBD5E1' }}>
                ⚠️ Usa o custo <strong>atual</strong> do produto. Se o custo mudou desde a venda original, o lucro vai refletir o atual (não o histórico).
              </p>
              <button
                onClick={onBackfill}
                disabled={pending}
                className="mt-3 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-colors hover:opacity-90 disabled:opacity-50"
                style={{ background: '#22C55E', color: '#131C2A' }}
              >
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {pending ? 'Aplicando…' : `Aplicar correção em ${diag.fixableSnapshotsCount} item(s)`}
              </button>
              {result && (
                <p className="mt-2 text-xs" style={{ color: '#10B981' }}>
                  ✓ {result.updated} item(s) atualizado(s), {result.skipped} pulado(s).
                </p>
              )}
              {error && (
                <p className="mt-2 text-xs" style={{ color: '#EF4444' }}>{error}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Itens órfãos (sem product_id) — CAUSA RAIZ MAIS COMUM */}
      {orphans.length > 0 && (
        <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
          <div className="border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <div className="h-4 w-1 rounded-full" style={{ background: '#EF4444' }} />
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: '#CBD5E1' }}>
                    <Unlink className="h-3.5 w-3.5" />
                    Itens vendidos sem vínculo ao estoque ({orphans.length})
                  </h2>
                  <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>
                    Vendas onde o item foi adicionado como &quot;manual&quot; no POS — sem <code>product_id</code>, então sem como rastrear custo.
                    Procurei o produto correspondente por nome no estoque pra você revisar e vincular.
                  </p>
                  {orphans[0]?.catalogStats && (
                    <p className="text-[10px] mt-1" style={{ color: '#94A3B8' }}>
                      Estoque consultado: <strong style={{ color: '#CBD5E1' }}>{orphans[0].catalogStats.products}</strong> produto(s) ·{' '}
                      <strong style={{ color: '#CBD5E1' }}>{orphans[0].catalogStats.parts}</strong> peça(s)
                    </p>
                  )}
                </div>
              </div>
              {uniqueExactCount > 0 && (
                <button
                  onClick={onAutoLink}
                  disabled={pending}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-colors hover:opacity-90 disabled:opacity-50"
                  style={{ background: '#10B981', color: '#131C2A' }}
                >
                  {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <Link2 className="h-3.5 w-3.5" />
                  Vincular {uniqueExactCount} match(es) exatos
                </button>
              )}
            </div>
            {autoLinkResult && (
              <p className="mt-3 text-xs" style={{ color: '#10B981' }}>
                ✓ {autoLinkResult.linked} vinculado(s), {autoLinkResult.skipped} pulado(s).
              </p>
            )}
            {linkError && <p className="mt-2 text-xs" style={{ color: '#EF4444' }}>{linkError}</p>}
          </div>

          <div className="p-6 space-y-3">
            {orphans.map(o => (
              <OrphanCard
                key={o.saleItemId}
                orphan={o}
                catalog={catalog}
                pending={pending}
                linkPending={linkPending}
                onLinkOne={onLinkOne}
              />
            ))}
          </div>
        </div>
      )}

      {/* Vendas com prejuízo (custo > receita) */}
      {losing.length > 0 && (
        <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
          <div className="border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
            <div className="flex items-center gap-2">
              <div className="h-4 w-1 rounded-full" style={{ background: '#EF4444' }} />
              <div className="flex-1">
                <h2 className="text-xs font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: '#CBD5E1' }}>
                  <TrendingDown className="h-3.5 w-3.5" />
                  Vendas com prejuízo ({losing.length}) — total {BRL(totalLosingCents)}
                </h2>
                <p className="text-[11px] mt-0.5" style={{ color: '#94A3B8' }}>
                  Vendas onde o custo somado dos itens ficou maior que o faturamento. Provável causa: custo errado no produto, ou item vinculado ao produto errado.
                </p>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-3">
            {losing.map(l => (
              <div key={l.saleId} className="rounded-xl border p-4 space-y-3"
                style={{ background: 'rgba(255,77,109,.04)', borderColor: 'rgba(255,77,109,.3)' }}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>
                      {l.customerName ?? 'Sem cliente'}
                    </p>
                    <p className="text-[11px]" style={{ color: '#94A3B8' }}>
                      {DT(l.saleDate)} · ID <code>{l.saleId.slice(0,8)}</code>
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="grid grid-cols-3 gap-x-3 text-[11px]">
                      <div>
                        <p style={{ color: '#94A3B8' }}>Receita</p>
                        <p className="font-mono font-bold" style={{ color: '#F8FAFC' }}>{BRL(l.totalCents)}</p>
                      </div>
                      <div>
                        <p style={{ color: '#94A3B8' }}>Custo</p>
                        <p className="font-mono font-bold" style={{ color: '#F59E0B' }}>{BRL(l.totalCostCents)}</p>
                      </div>
                      <div>
                        <p style={{ color: '#94A3B8' }}>Prejuízo</p>
                        <p className="font-mono font-bold" style={{ color: '#EF4444' }}>{BRL(l.profitCents)}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t pt-3 overflow-x-auto" style={{ borderColor: 'rgba(255,77,109,.3)' }}>
                  <table className="w-full text-[11px] min-w-[640px]">
                    <thead>
                      <tr style={{ color: '#94A3B8' }}>
                        <th className="text-left py-1">Item</th>
                        <th className="text-right py-1">Qtd</th>
                        <th className="text-right py-1">Preço unit.</th>
                        <th className="text-right py-1">Custo unit. (snapshot)</th>
                        <th className="text-right py-1">Lucro item</th>
                        <th className="text-right py-1">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {l.items.map(it => {
                        const unitCost = it.quantity > 0 ? Math.round(it.totalCostCents / it.quantity) : 0
                        return (
                          <tr key={it.saleItemId} className="border-t" style={{ borderColor: 'rgba(30,45,69,.5)' }}>
                            <td className="py-1.5" style={{ color: '#F8FAFC' }}>
                              {it.name}
                              {it.productName && it.productName !== it.name && (
                                <span className="ml-1 text-[10px]" style={{ color: '#94A3B8' }}>
                                  → vinculado a &quot;{it.productName}&quot;
                                </span>
                              )}
                            </td>
                            <td className="text-right font-mono" style={{ color: '#CBD5E1' }}>{it.quantity}</td>
                            <td className="text-right font-mono" style={{ color: '#CBD5E1' }}>{BRL(it.unitPriceCents)}</td>
                            <td className="text-right font-mono" style={{ color: unitCost > it.unitPriceCents ? '#EF4444' : '#CBD5E1' }}>
                              {it.snapshotCents == null ? 'NULL' : BRL(unitCost)}
                            </td>
                            <td className="text-right font-mono font-semibold" style={{ color: it.itemProfitCents < 0 ? '#EF4444' : '#10B981' }}>
                              {BRL(it.itemProfitCents)}
                            </td>
                            <td className="text-right">
                              <div className="inline-flex gap-1">
                                {it.productId && (
                                  <Link
                                    href={`/estoque/${it.productId}`}
                                    className="text-[10px] font-bold px-2 py-1 rounded hover:opacity-80"
                                    style={{ background: 'rgba(34,197,94,.15)', color: '#22C55E' }}
                                    title="Editar custo do produto no estoque"
                                  >
                                    Editar custo
                                  </Link>
                                )}
                                {it.productId && (
                                  <button
                                    onClick={() => onUnlink(it.saleItemId, it.name)}
                                    disabled={linkPending === it.saleItemId || pending}
                                    className="text-[10px] font-bold px-2 py-1 rounded hover:opacity-80 disabled:opacity-50"
                                    style={{ background: 'rgba(255,170,0,.15)', color: '#F59E0B' }}
                                    title="Desvincular esse item (volta a ser órfão pra você re-vincular)"
                                  >
                                    {linkPending === it.saleItemId ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Desvincular'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Vendas suspeitas */}
      <Section
        title="Vendas suspeitas"
        icon={ShoppingCart}
        color="#F59E0B"
        count={diag.suspiciousSalesCount}
        empty="Nenhuma venda suspeita no período. Lucro das vendas está sendo calculado corretamente."
      >
        {diag.suspiciousSales.map(s => (
          <div key={s.id} className="rounded-xl border p-4 space-y-2" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>
                  {s.customerName ?? 'Sem cliente'}
                </p>
                <p className="text-[11px]" style={{ color: '#94A3B8' }}>
                  {DT(s.createdAt)} · {s.itemsCount} item(s) · ID <code>{s.id.slice(0,8)}</code>
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-mono font-bold" style={{ color: '#F59E0B' }}>{BRL(s.totalCents)}</p>
                <DiagnosisBadge diagnosis={s.diagnosis} />
              </div>
            </div>

            {s.items.length > 0 && (
              <div className="border-t pt-2 overflow-x-auto" style={{ borderColor: '#2A3650' }}>
                <table className="w-full text-[11px] min-w-[640px]">
                  <thead>
                    <tr style={{ color: '#94A3B8' }}>
                      <th className="text-left py-1">Item</th>
                      <th className="text-right py-1">Qtd</th>
                      <th className="text-right py-1">Snapshot</th>
                      <th className="text-right py-1">Custo atual produto</th>
                      <th className="text-right py-1">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.items.map((it, idx) => (
                      <tr key={idx} className="border-t" style={{ borderColor: 'rgba(30,45,69,.5)', color: '#F8FAFC' }}>
                        <td className="py-1.5">
                          {it.name}
                          {it.productName && it.productName !== it.name && (
                            <span className="ml-1" style={{ color: '#94A3B8' }}>({it.productName})</span>
                          )}
                          {!it.productId && (
                            <span className="ml-1 text-[10px]" style={{ color: '#EF4444' }}>sem product_id</span>
                          )}
                        </td>
                        <td className="text-right font-mono" style={{ color: '#CBD5E1' }}>{it.quantity}</td>
                        <td className="text-right font-mono" style={{ color: it.snapshotCents == null ? '#EF4444' : '#CBD5E1' }}>
                          {it.snapshotCents == null ? 'NULL' : BRL(it.snapshotCents)}
                        </td>
                        <td className="text-right font-mono" style={{ color: it.productCostCents != null && it.productCostCents > 0 ? '#22C55E' : '#EF4444' }}>
                          {it.productCostCents == null ? '—' : BRL(it.productCostCents)}
                        </td>
                        <td className="text-right">
                          {it.fixable
                            ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(34,197,94,.15)', color: '#22C55E' }}>Corrigível</span>
                            : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,77,109,.15)', color: '#EF4444' }}>Sem custo</span>
                          }
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </Section>

      {/* OSs suspeitas */}
      <Section
        title="OSs com peças sem custo"
        icon={Wrench}
        color="#8B5CF6"
        count={diag.suspiciousOsCount}
        empty="Nenhuma OS suspeita. OSs com peças têm parts_cost_cents preenchido, ou são só de serviço (sem peças, sem custo — normal)."
      >
        {diag.suspiciousOs.map(o => (
          <div key={o.id} className="rounded-xl border p-4 flex items-start justify-between gap-3 flex-wrap"
            style={{ background: '#131C2A', borderColor: '#2A3650' }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>
                {o.customerName ?? 'Sem cliente'}
              </p>
              <p className="text-[11px]" style={{ color: '#94A3B8' }}>
                {DT(o.receivedAt)} · ID <code>{o.id.slice(0,8)}</code>
              </p>
              <div className="mt-2 grid grid-cols-2 gap-x-4 text-[11px]">
                <span style={{ color: '#CBD5E1' }}>Serviço: <span className="font-mono">{BRL(o.servicePriceCents)}</span></span>
                <span style={{ color: '#CBD5E1' }}>Peças vendidas: <span className="font-mono" style={{ color: '#F59E0B' }}>{BRL(o.partsSaleCents)}</span></span>
                <span style={{ color: '#CBD5E1' }}>Total: <span className="font-mono">{BRL(o.totalPriceCents)}</span></span>
                <span style={{ color: '#CBD5E1' }}>Custo das peças: <span className="font-mono" style={{ color: '#EF4444' }}>{o.partsCostCents == null ? 'NULL' : BRL(o.partsCostCents)}</span></span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm font-mono font-bold" style={{ color: '#F59E0B' }}>{BRL(o.totalPriceCents)}</p>
              <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(255,77,109,.15)', color: '#EF4444' }}>
                Peça sem custo
              </span>
              <p className="mt-2 text-[10px]" style={{ color: '#CBD5E1' }}>
                Edite a OS no CheckSmart e preencha o custo das peças.
              </p>
            </div>
          </div>
        ))}
      </Section>

      {/* Produtos órfãos */}
      <Section
        title="Produtos sem custo cadastrado"
        icon={Package}
        color="#EF4444"
        count={diag.orphanProductsCount}
        empty="Todos os produtos vendidos no período têm cost_cents > 0."
      >
        <div className="rounded-xl border overflow-x-auto" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: '#2A3650' }}>
                <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>Produto</th>
                <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>Apareceu em</th>
                <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: '#94A3B8' }}>Ação</th>
              </tr>
            </thead>
            <tbody>
              {diag.orphanProducts.map(p => (
                <tr key={p.id} className="border-b" style={{ borderColor: 'rgba(30,45,69,.5)' }}>
                  <td className="px-4 py-2" style={{ color: '#F8FAFC' }}>{p.name}</td>
                  <td className="px-4 py-2 font-mono text-xs" style={{ color: '#CBD5E1' }}>{p.appearedInSales} venda(s)</td>
                  <td className="px-4 py-2">
                    <Link href={`/estoque/${p.id}`} className="text-xs font-semibold hover:underline" style={{ color: '#22C55E' }}>
                      Editar produto →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}

function OrphanCard({
  orphan, catalog, pending, linkPending, onLinkOne,
}: {
  orphan:      OrphanSaleItem
  catalog:     CatalogItem[]
  pending:     boolean
  linkPending: string | null
  onLinkOne:   (saleItemId: string, productId: string, productName: string) => void
}) {
  const [search,    setSearch]    = useState('')
  const [selectedId, setSelectedId] = useState<string>('')

  // Pré-filtra catálogo pela busca digitada (case/acento insensitive simples).
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const filtered = search.trim().length >= 1
    ? catalog.filter(c => norm(c.name).includes(norm(search)))
    : catalog
  const filteredTop = filtered.slice(0, 50)

  const selectedItem = catalog.find(c => c.id === selectedId)

  return (
    <div className="rounded-xl border p-4" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold" style={{ color: '#F8FAFC' }}>{orphan.itemName}</p>
          <p className="text-[11px]" style={{ color: '#94A3B8' }}>
            Cliente: <span style={{ color: '#CBD5E1' }}>{orphan.customerName ?? 'Sem cliente'}</span> ·
            {' '}Venda <code>{orphan.saleId.slice(0,8)}</code> ·
            {' '}{DT(orphan.saleDate)} · qtd {orphan.quantity} · {BRL(orphan.unitPriceCents)}/un
          </p>
        </div>
        {orphan.matches.length === 0 && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(255,77,109,.15)', color: '#EF4444' }}>
            Nenhuma sugestão automática
          </span>
        )}
        {orphan.hasUniqueExact && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(16,185,129,.15)', color: '#10B981' }}>
            ✓ 1 match exato
          </span>
        )}
      </div>

      {/* Sugestões automáticas */}
      {orphan.matches.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#94A3B8' }}>
            Sugestões ({orphan.matches.length})
          </p>
          {orphan.matches.map(m => {
            const matchStyle = m.matchType === 'exact'
              ? { bg: 'rgba(16,185,129,.05)', border: 'rgba(16,185,129,.25)', badgeBg: 'rgba(16,185,129,.2)', badgeColor: '#10B981', label: 'exato' }
              : m.matchType === 'fuzzy'
                ? { bg: 'rgba(255,170,0,.05)', border: 'rgba(255,170,0,.25)', badgeBg: 'rgba(255,170,0,.2)', badgeColor: '#F59E0B', label: 'parcial' }
                : { bg: 'rgba(155,109,255,.05)', border: 'rgba(155,109,255,.25)', badgeBg: 'rgba(155,109,255,.2)', badgeColor: '#8B5CF6', label: 'palavras' }
            return (
              <div key={m.productId} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                style={{ background: matchStyle.bg, borderColor: matchStyle.border }}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: matchStyle.badgeBg, color: matchStyle.badgeColor }}>
                      {matchStyle.label} {m.matchType !== 'exact' && `· ${Math.round(m.score * 100)}%`}
                    </span>
                    <span className="text-xs font-medium truncate" style={{ color: '#F8FAFC' }}>{m.productName}</span>
                    <span className="text-[10px]" style={{ color: '#94A3B8' }}>({m.source})</span>
                  </div>
                  <p className="text-[11px] mt-0.5" style={{ color: '#CBD5E1' }}>
                    Custo cadastrado: <span className="font-mono" style={{ color: m.costCents > 0 ? '#10B981' : '#EF4444' }}>
                      {m.costCents > 0 ? BRL(m.costCents) : 'sem custo'}
                    </span>
                  </p>
                </div>
                <button
                  onClick={() => onLinkOne(orphan.saleItemId, m.productId, m.productName)}
                  disabled={linkPending === orphan.saleItemId || pending}
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors hover:opacity-90 disabled:opacity-50 shrink-0"
                  style={{ background: '#22C55E', color: '#131C2A' }}
                >
                  {linkPending === orphan.saleItemId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
                  Vincular
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Seleção manual — sempre disponível */}
      <div className="mt-3 pt-3 border-t" style={{ borderColor: '#2A3650' }}>
        <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#94A3B8' }}>
          Buscar produto manualmente ({catalog.length} no catálogo)
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setSelectedId('') }}
            placeholder="Digite parte do nome do produto…"
            className="flex-1 rounded-lg border px-3 py-2 text-sm"
            style={{ background: '#1B2638', borderColor: '#2A3650', color: '#F8FAFC' }}
          />
          <select
            value={selectedId}
            onChange={e => setSelectedId(e.target.value)}
            className="flex-1 rounded-lg border px-3 py-2 text-sm"
            style={{ background: '#1B2638', borderColor: '#2A3650', color: '#F8FAFC' }}
          >
            <option value="">— Selecione ({filtered.length} encontrado{filtered.length !== 1 ? 's' : ''}) —</option>
            {filteredTop.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}{c.costCents > 0 ? ` · ${BRL(c.costCents)}` : ' · sem custo'} {c.source === 'parts_catalog' ? '[peça]' : ''}
              </option>
            ))}
            {filtered.length > 50 && (
              <option disabled>… +{filtered.length - 50} produto(s) — refine a busca</option>
            )}
          </select>
          <button
            onClick={() => selectedItem && onLinkOne(orphan.saleItemId, selectedItem.id, selectedItem.name)}
            disabled={!selectedItem || linkPending === orphan.saleItemId || pending}
            className="inline-flex items-center justify-center gap-1 rounded-lg px-4 py-2 text-xs font-bold transition-colors hover:opacity-90 disabled:opacity-30"
            style={{ background: '#10B981', color: '#131C2A' }}
          >
            {linkPending === orphan.saleItemId ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
            Vincular escolhido
          </button>
        </div>
        {selectedItem && (
          <p className="text-[11px] mt-2" style={{ color: '#CBD5E1' }}>
            Vai vincular ao produto <strong style={{ color: '#F8FAFC' }}>{selectedItem.name}</strong>
            {selectedItem.costCents > 0
              ? <> com custo <span className="font-mono" style={{ color: '#10B981' }}>{BRL(selectedItem.costCents)}</span></>
              : <> <span style={{ color: '#EF4444' }}>(sem custo cadastrado — o lucro vai continuar inflado até você cadastrar)</span></>
            }
          </p>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-2xl border p-4" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#94A3B8' }}>{label}</p>
      <p className="text-2xl font-bold font-mono mt-1" style={{ color }}>{value}</p>
    </div>
  )
}

function Section({
  title, icon: Icon, color, count, empty, children,
}: {
  title: string; icon: React.ElementType; color: string
  count: number; empty: string; children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
      <div className="border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
        <div className="flex items-center gap-2">
          <div className="h-4 w-1 rounded-full" style={{ background: color }} />
          <h2 className="text-xs font-bold uppercase tracking-widest flex items-center gap-1.5" style={{ color: '#CBD5E1' }}>
            <Icon className="h-3.5 w-3.5" />
            {title} ({count})
          </h2>
        </div>
      </div>
      {count === 0 ? (
        <p className="p-8 text-center text-sm" style={{ color: '#94A3B8' }}>{empty}</p>
      ) : (
        <div className="p-6 space-y-3">{children}</div>
      )}
    </div>
  )
}

function DiagnosisBadge({ diagnosis }: { diagnosis: 'fixable' | 'product_missing_cost' | 'no_items' }) {
  const map = {
    fixable:              { color: '#22C55E', bg: 'rgba(34,197,94,.15)', label: 'Corrigível automaticamente' },
    product_missing_cost: { color: '#EF4444', bg: 'rgba(255,77,109,.15)', label: 'Produto sem custo' },
    no_items:             { color: '#F59E0B', bg: 'rgba(255,170,0,.15)', label: 'Sem itens registrados' },
  }
  const s = map[diagnosis]
  return (
    <span className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  )
}
