'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Package, Plus, Search, Pencil, Trash2, X, Loader2,
  ToggleLeft, ToggleRight, ClipboardList, FileUp, CheckCircle, MoreVertical,
  Copy, Printer,
} from 'lucide-react'
import {
  deleteProduct, toggleProductActive, adjustStock, importProducts,
  removeDuplicateProducts, updateProductPrice, fetchProductsPage,
  type ProductRow, type ProductInput,
} from '@/actions/products'
import { ProdutoModal } from '@/components/estoque/produto-modal'
import { StockPopover } from '@/components/estoque/stock-popover'

// ── Helpers ───────────────────────────────────────────────────────────────────

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100)

const parseBRL = (v: string) => parseInt(v.replace(/\D/g, '') || '0', 10)
const fmtBRL   = (c: number) => (c / 100).toFixed(2).replace('.', ',')

// ── Types ─────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 100

type Props = {
  initialProducts: ProductRow[]
  initialTotal:    number
  brands:          string[]
  categories:      string[]
}

// ── Inline price cell ─────────────────────────────────────────────────────────

function InlinePrice({ product, onSaved }: { product: ProductRow; onSaved: (id: string, cents: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal]         = useState(fmtBRL(product.price_cents))
  const [saving, startSave]   = useTransition()
  const inputRef              = useRef<HTMLInputElement>(null)

  function activate() {
    setVal(fmtBRL(product.price_cents))
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function commit() {
    const cents = parseBRL(val)
    if (cents === product.price_cents) { setEditing(false); return }
    startSave(async () => {
      await updateProductPrice(product.id, cents)
      onSaved(product.id, cents)
      setEditing(false)
    })
  }

  if (editing) {
    return (
      <div className="flex items-center justify-end gap-1">
        <span className="text-xs text-muted">R$</span>
        <input
          ref={inputRef}
          type="text" inputMode="numeric"
          value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }}
          className="w-24 rounded border bg-transparent px-2 py-0.5 text-right text-sm text-text focus:outline-none focus:ring-1 focus:ring-accent"
          style={{ borderColor: '#10B981' }}
          disabled={saving}
        />
      </div>
    )
  }

  return (
    <button
      onClick={activate}
      title="Clique para editar o preço"
      className="group flex items-center justify-end gap-1 w-full"
    >
      <span className="text-sm font-semibold" style={{ color: '#10B981' }}>{BRL(product.price_cents)}</span>
      <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity text-muted" />
    </button>
  )
}

// ── 3-dot menu ────────────────────────────────────────────────────────────────

function RowMenu({ product, onCloneForm, onPrint }: {
  product:     ProductRow
  onCloneForm: (p: ProductRow) => void
  onPrint:     (p: ProductRow) => void
}) {
  const [open, setOpen] = useState(false)
  const btnRef          = useRef<HTMLButtonElement>(null)
  const [pos, setPos]   = useState({ top: 0, right: 0 })

  useEffect(() => {
    if (open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
    }
  }, [open])

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-white hover:bg-white/10 transition-colors"
        title="Mais opções"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="fixed z-40 w-44 rounded-lg border shadow-xl overflow-hidden"
            style={{ background: '#131C2A', borderColor: '#2A3650', top: pos.top, right: pos.right }}
          >
            <button
              onClick={() => { onCloneForm(product); setOpen(false) }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-text hover:bg-white/5 transition-colors"
            >
              <Copy className="h-4 w-4 text-muted" />
              Clonar produto
            </button>
            <button
              onClick={() => { onPrint(product); setOpen(false) }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-text hover:bg-white/5 transition-colors"
            >
              <Printer className="h-4 w-4 text-muted" />
              Imprimir etiqueta
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Print label ───────────────────────────────────────────────────────────────

function printLabel(product: ProductRow) {
  const w = window.open('', '_blank', 'width=400,height=300')
  if (!w) return
  const price = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(product.price_cents / 100)
  w.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Etiqueta — ${product.name}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Arial, sans-serif; padding: 16px; }
        .label { border: 2px solid #000; padding: 12px; width: 280px; }
        .name  { font-size: 14px; font-weight: bold; line-height: 1.3; margin-bottom: 6px; }
        .sku   { font-size: 11px; color: #555; margin-bottom: 4px; }
        .cat   { font-size: 11px; color: #555; margin-bottom: 8px; }
        .price { font-size: 22px; font-weight: bold; }
        .barcode { margin-top: 8px; font-family: monospace; font-size: 11px; letter-spacing: 2px; color: #333; }
        @media print { body { padding: 0; } }
      </style>
    </head>
    <body onload="window.print(); window.close()">
      <div class="label">
        <div class="name">${product.name}</div>
        ${product.code ? `<div class="sku">SKU: ${product.code}</div>` : ''}
        ${product.category ? `<div class="cat">Categoria: ${product.category}</div>` : ''}
        <div class="price">${price}</div>
        ${product.gtin ? `<div class="barcode">${product.gtin}</div>` : ''}
      </div>
    </body>
    </html>
  `)
  w.document.close()
}

// ── Main component ────────────────────────────────────────────────────────────

export function EstoqueClient({ initialProducts, initialTotal, brands: initialBrands, categories: initialCategories }: Props) {
  const router = useRouter()
  const [products, setProducts]     = useState<ProductRow[]>(initialProducts)
  const [brands, setBrands]         = useState<string[]>(initialBrands)
  const [categories, setCategories] = useState<string[]>(initialCategories)

  const [search, setSearch]                 = useState('')
  const [filterBrand, setFilterBrand]       = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterActive, setFilterActive]     = useState<'all' | 'active' | 'inactive'>('all')

  const [page, setPage]         = useState(0)
  const [total, setTotal]       = useState(initialTotal)
  const [fetching, startFetch]  = useTransition()
  const isFirstRender           = useRef(true)

  const [modalOpen, setModalOpen]     = useState(false)
  const [editing, setEditing]         = useState<ProductRow | null>(null)
  const [cloneTarget, setCloneTarget] = useState<ProductRow | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<ProductRow | null>(null)
  const [deleting, startDel]            = useTransition()
  const [deleteError, setDeleteError]   = useState('')

  const [toggling, startToggle]        = useTransition()
  const [deduping, startDedup]         = useTransition()
  const [dedupResult, setDedupResult]  = useState<number | null>(null)

  const [balanceTarget, setBalanceTarget] = useState<ProductRow | null>(null)
  const [balanceQty, setBalanceQty]       = useState('')
  const [balancing, startBalance]         = useTransition()
  const [balanceError, setBalanceError]   = useState('')


  const [importOpen, setImportOpen]     = useState(false)
  const [importRows, setImportRows]     = useState<ProductInput[]>([])
  const [importParsed, setImportParsed] = useState(false)
  const [importing, startImport]        = useTransition()
  const [importResult, setImportResult] = useState<{ created: number; updated: number; errors: number } | null>(null)
  const [importError, setImportError]   = useState('')
  const importFileRef                   = useRef<HTMLInputElement>(null)

  // ── Server-side pagination ────────────────────────────────────────────────

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return }
    const id = setTimeout(() => {
      startFetch(async () => {
        const r = await fetchProductsPage({
          search:   search || undefined,
          brand:    filterBrand || undefined,
          category: filterCategory || undefined,
          active:   filterActive,
          page,
          pageSize: PAGE_SIZE,
        })
        setProducts(r.products)
        setTotal(r.total)
      })
    }, 300)
    return () => clearTimeout(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filterBrand, filterCategory, filterActive, page])

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleSaved(product: ProductRow, isNew: boolean) {
    if (isNew) { setProducts(ps => [product, ...ps]); setTotal(t => t + 1) }
    else       setProducts(ps => ps.map(p => p.id === product.id ? product : p))
  }

  function handleNewBrand(brand: string) {
    if (brand && !brands.includes(brand)) setBrands(bs => [...bs, brand].sort())
  }

  function handleNewCategory(category: string) {
    if (category && !categories.includes(category)) setCategories(cs => [...cs, category].sort())
  }

  function handlePriceUpdate(id: string, cents: number) {
    setProducts(ps => ps.map(p => p.id === id ? { ...p, price_cents: cents } : p))
  }

  function handleDelete() {
    if (!deleteTarget) return
    startDel(async () => {
      try {
        await deleteProduct(deleteTarget.id)
        setProducts(ps => ps.filter(p => p.id !== deleteTarget.id))
        setTotal(t => Math.max(0, t - 1))
        setDeleteTarget(null)
      } catch (e) {
        setDeleteError(e instanceof Error ? e.message : 'Erro ao excluir.')
      }
    })
  }

  function handleToggle(p: ProductRow) {
    startToggle(async () => {
      try {
        await toggleProductActive(p.id, !p.active)
        setProducts(ps => ps.map(x => x.id === p.id ? { ...x, active: !p.active } : x))
      } catch { /* silencioso */ }
    })
  }

  function handleRemoveDuplicates() {
    startDedup(async () => {
      try {
        const { removed } = await removeDuplicateProducts()
        setDedupResult(removed)
        if (removed > 0) window.location.reload()
      } catch { /* silencioso */ }
    })
  }

  function handleBalance() {
    if (!balanceTarget) return
    const qty = parseInt(balanceQty) || 0
    startBalance(async () => {
      try {
        await adjustStock(balanceTarget.id, qty)
        setProducts(ps => ps.map(p => p.id === balanceTarget.id ? { ...p, stock_qty: qty } : p))
        setBalanceTarget(null)
      } catch (e) {
        setBalanceError(e instanceof Error ? e.message : 'Erro ao ajustar.')
      }
    })
  }

  // ── CSV ────────────────────────────────────────────────────────────────────

  function normHeader(h: string) {
    return h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  }
  function parseCsvPrice(v: string) {
    if (!v) return 0
    return Math.round((parseFloat(v.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')) || 0) * 100)
  }
  function parseCsvInt(v: string) {
    if (!v) return 0
    return Math.round(parseFloat(v.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '')) || 0)
  }

  function parseCSVText(text: string): ProductInput[] {
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) return []
    const sep = lines[0].includes(';') ? ';' : ','
    const normHeaders = lines[0].split(sep).map(h => normHeader(h.replace(/^"|"$/g, '').trim()))

    const col = (keys: string[], exclude = -1) => {
      for (const k of keys) {
        const idx = normHeaders.findIndex((h, i) => i !== exclude && h.includes(k))
        if (idx >= 0) return idx
      }
      return -1
    }

    const iBlingId   = normHeaders.findIndex(h => h === 'id')
    const iCod       = col(['codigo', 'sku', 'cod'])
    const iNome      = col(['nome', 'descricao', 'descri', 'produto'])
    const iMarca     = col(['marca'])
    const iCategoria = col(['categoria', 'category'])
    const iPrecoCu   = col(['preco de custo', 'preco custo', 'custo'])
    const iPrecoComp = col(['preco de compra', 'preco compra', 'valor de compra'], iPrecoCu)
    const iPrecoV    = col(['preco de venda', 'preco venda', 'valor de venda', 'valor venda', 'preco', 'valor'], iPrecoCu)
    const iEstoque   = col(['saldo em estoque', 'saldo fisico', 'saldo', 'estoque fisico', 'estoque', 'quantidade', 'qtd'])
    const iUnidade   = col(['unidade de medida', 'unidade', 'un'])
    const iFornec    = col(['fornecedor'])
    const iSituacao  = col(['situacao', 'ativo', 'status'])
    const iGtin      = col(['gtin', 'ean', 'codigo de barras'])

    const cell = (row: string[], idx: number) =>
      idx >= 0 ? (row[idx] ?? '').replace(/^"|"$/g, '').trim() : ''

    return lines.slice(1).filter(l => l.trim()).map(line => {
      const cells    = line.split(sep)
      const situacao = cell(cells, iSituacao).toLowerCase()
      const sku      = cell(cells, iCod)
      return {
        code:               sku || cell(cells, iBlingId),
        name:               cell(cells, iNome),
        brand:              cell(cells, iMarca),
        category:           cell(cells, iCategoria),
        format:             'simples' as const,
        condition:          'novo' as const,
        gtin:               cell(cells, iGtin),
        weightG: null, grossWeightG: null, heightCm: null, widthCm: null, depthCm: null,
        purchasePriceCents: parseCsvPrice(cell(cells, iPrecoComp !== -1 ? iPrecoComp : iPrecoCu)),
        costCents:          parseCsvPrice(cell(cells, iPrecoCu)),
        priceCents:         parseCsvPrice(cell(cells, iPrecoV)),
        unit:               cell(cells, iUnidade) || 'Un',
        stockQty:           parseCsvInt(cell(cells, iEstoque)),
        stockMin: 0, stockMax: 0, location: '',
        supplier:           cell(cells, iFornec),
        imageUrls: [], description: '',
        active: !situacao || situacao === 'ativo' || situacao === 'a' || situacao === '1',
      }
    }).filter(r => r.name)
  }

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportResult(null); setImportError('')
    if (importFileRef.current) importFileRef.current.value = ''

    const applyRows = (rows: ProductInput[]) => { setImportRows(rows); setImportParsed(true) }
    const readWith  = (encoding: string, fallback?: () => void) => {
      const reader = new FileReader()
      reader.onload = ev => {
        const text = ev.target?.result as string
        const rows = parseCSVText(text)
        if (encoding === 'UTF-8' && fallback && rows.length > 0 && rows.every(r => r.priceCents === 0)) { fallback(); return }
        applyRows(rows)
      }
      reader.readAsText(file, encoding)
    }
    readWith('UTF-8', () => readWith('ISO-8859-1'))
  }

  function handleImport() {
    startImport(async () => {
      try {
        const result = await importProducts(importRows)
        setImportResult(result)
        if (result.created > 0 || result.updated > 0) window.location.reload()
      } catch (e) { setImportError(e instanceof Error ? e.message : 'Erro ao importar.') }
    })
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text">Estoque</h1>
          <p className="mt-1 text-sm text-muted">Cadastro e controle de produtos</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleRemoveDuplicates} disabled={deduping}
            title="Remove duplicados mantendo o mais antigo"
            className="flex shrink-0 items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium text-muted hover:text-red-400 transition-colors disabled:opacity-50"
            style={{ borderColor: '#2A3650' }}>
            {deduping ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            {deduping ? 'Limpando…' : dedupResult !== null ? `${dedupResult} removidos` : 'Limpar duplicatas'}
          </button>
          <button
            onClick={() => { setImportOpen(true); setImportParsed(false); setImportRows([]); setImportResult(null); setImportError('') }}
            className="flex shrink-0 items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium text-muted hover:text-text transition-colors"
            style={{ borderColor: '#2A3650' }}>
            <FileUp className="h-4 w-4" /> Importar CSV
          </button>
          <button onClick={() => { setEditing(null); setModalOpen(true) }}
            className="flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-black"
            style={{ background: '#10B981' }}>
            <Plus className="h-4 w-4" /> Novo Produto
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-52">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(0) }}
            placeholder="Buscar por nome, SKU ou marca…"
            className="w-full rounded-lg border bg-transparent py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            style={{ borderColor: '#2A3650', paddingLeft: '2.25rem', paddingRight: '0.75rem' }} />
        </div>
        <select value={filterBrand} onChange={e => { setFilterBrand(e.target.value); setPage(0) }}
          className="rounded-lg border bg-transparent px-3 py-2 text-sm text-text"
          style={{ borderColor: '#2A3650', minWidth: '150px' }}>
          <option value="">Todas as marcas</option>
          {brands.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setPage(0) }}
          className="rounded-lg border bg-transparent px-3 py-2 text-sm text-text"
          style={{ borderColor: '#2A3650', minWidth: '160px' }}>
          <option value="">Todas as categorias</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterActive} onChange={e => { setFilterActive(e.target.value as typeof filterActive); setPage(0) }}
          className="rounded-lg border bg-transparent px-3 py-2 text-sm text-text"
          style={{ borderColor: '#2A3650' }}>
          <option value="all">Todos</option>
          <option value="active">Ativos</option>
          <option value="inactive">Inativos</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-xl border overflow-hidden" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
        <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: '#2A3650' }}>
          <h2 className="text-sm font-semibold text-text">Produtos</h2>
          <div className="flex items-center gap-3">
            {fetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />}
            <span className="text-xs text-muted">{total} {total === 1 ? 'produto' : 'produtos'}</span>
          </div>
        </div>

        {products.length === 0 && !fetching ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20">
            <Package className="h-10 w-10" style={{ color: '#64748B' }} />
            <p className="text-sm text-muted">Nenhum produto encontrado</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="grid gap-3 px-5 py-3 border-b text-xs font-medium uppercase tracking-wider text-muted"
              style={{ borderColor: '#2A3650', gridTemplateColumns: 'minmax(280px, 2fr) 100px 120px 110px 120px 80px 90px 152px', minWidth: '1100px' }}>
              <span>Nome</span><span>SKU</span><span>Marca</span>
              <span className="text-right">Pr. Custo</span>
              <span className="text-right">Pr. Venda</span>
              <span className="text-right">Estoque</span>
              <span className="text-center">Situação</span>
              <span className="text-right">Ações</span>
            </div>

            {products.map(p => (
              <div key={p.id}
                className="grid gap-3 px-5 py-3.5 border-b items-center last:border-0 hover:bg-white/[0.02] transition-colors"
                style={{ borderColor: '#2A3650', gridTemplateColumns: 'minmax(280px, 2fr) 100px 120px 110px 120px 80px 90px 152px', minWidth: '1100px' }}>

                {/* Nome + imagem */}
                <div className="flex items-center gap-3 min-w-0">
                  {p.image_urls?.[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_urls[0]} alt={p.name} className="h-9 w-9 rounded-lg object-cover shrink-0" style={{ border: '1px solid #2A3650' }} />
                  ) : (
                    <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#2A3650' }}>
                      <Package className="h-4 w-4 text-muted" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text break-words">{p.name}</p>
                    <p className="text-xs text-muted break-words">
                      {p.category ?? ''}{p.category && p.supplier ? ' · ' : ''}{p.supplier ?? ''}
                    </p>
                  </div>
                </div>

                <p className="text-xs text-muted font-mono">{p.code || '—'}</p>
                <p className="text-xs text-muted truncate">{p.brand || '—'}</p>
                <p className="text-sm text-right text-muted">{BRL(p.cost_cents)}</p>

                {/* Preço inline editável */}
                <InlinePrice product={p} onSaved={handlePriceUpdate} />

                {/* Estoque — tooltip interativo com detalhes */}
                <StockPopover product={p} />

                {/* Toggle */}
                <div className="flex justify-center">
                  <button onClick={() => handleToggle(p)} disabled={toggling}
                    title={p.active ? 'Ativo — clique para inativar' : 'Inativo — clique para ativar'}>
                    {p.active
                      ? <ToggleRight className="h-6 w-6" style={{ color: '#10B981' }} />
                      : <ToggleLeft className="h-6 w-6 text-muted" />}
                  </button>
                </div>

                {/* Ações */}
                <div className="flex items-center justify-end gap-1">
                  <button onClick={() => router.push(`/estoque/${p.id}`)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-yellow-400 hover:bg-yellow-400/10 transition-colors"
                    title="Histórico de movimentações">
                    <ClipboardList className="h-4 w-4" />
                  </button>
                  <button onClick={() => { setEditing(p); setModalOpen(true) }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-white hover:bg-white/10 transition-colors"
                    title="Editar produto">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => { setDeleteError(''); setDeleteTarget(p) }}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors"
                    title="Excluir produto">
                    <Trash2 className="h-4 w-4" />
                  </button>
                  <RowMenu product={p} onCloneForm={p => { setCloneTarget(p); setEditing(null); setModalOpen(true) }} onPrint={printLabel} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Paginação ──────────────────────────────────────────────────────── */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t px-5 py-4" style={{ borderColor: '#2A3650' }}>
            <span className="text-xs text-muted">
              Exibindo {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total} produtos
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPage(p => p - 1)}
                disabled={page === 0 || fetching}
                className="rounded-lg border px-3 py-1.5 text-sm text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                style={{ borderColor: '#2A3650' }}>
                ← Anterior
              </button>
              <span className="text-xs text-muted">
                {page + 1} / {Math.ceil(total / PAGE_SIZE)}
              </span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={(page + 1) * PAGE_SIZE >= total || fetching}
                className="rounded-lg border px-3 py-1.5 text-sm text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                style={{ borderColor: '#2A3650' }}>
                Próxima →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Modal Produto ─────────────────────────────────────────────────────── */}
      {modalOpen && (
        <ProdutoModal
          editing={editing}
          cloneFrom={cloneTarget}
          brands={brands}
          categories={categories}
          onClose={() => { setModalOpen(false); setEditing(null); setCloneTarget(null) }}
          onSaved={handleSaved}
          onNewBrand={handleNewBrand}
          onNewCategory={handleNewCategory}
        />
      )}

      {/* ── Modal Balanço ────────────────────────────────────────────────────── */}
      {balanceTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="w-full max-w-sm rounded-2xl border p-6 space-y-4" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: '#F59E0B18' }}>
                <ClipboardList className="h-5 w-5" style={{ color: '#F59E0B' }} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-text">Ajuste de Estoque</h3>
                <p className="text-xs text-muted truncate">{balanceTarget.name}</p>
              </div>
            </div>
            <div className="rounded-lg border px-4 py-3 flex items-center justify-between" style={{ borderColor: '#2A3650' }}>
              <span className="text-xs text-muted">Estoque atual</span>
              <span className="text-sm font-bold text-text">{balanceTarget.stock_qty} {balanceTarget.unit}</span>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Nova quantidade</label>
              <input type="number" min={0} value={balanceQty} onChange={e => setBalanceQty(e.target.value)}
                className="w-full rounded-lg border bg-transparent px-3 py-2.5 text-sm text-text focus:outline-none focus:ring-1 focus:ring-accent"
                style={{ borderColor: '#2A3650' }} autoFocus />
            </div>
            {balanceError && <p className="text-xs" style={{ color: '#EF4444' }}>{balanceError}</p>}
            <div className="flex gap-3">
              <button onClick={() => setBalanceTarget(null)} className="flex-1 rounded-lg border py-2 text-sm text-muted hover:text-text" style={{ borderColor: '#2A3650' }}>Cancelar</button>
              <button onClick={handleBalance} disabled={balancing || balanceQty === ''}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold text-black disabled:opacity-50"
                style={{ background: '#F59E0B' }}>
                {balancing && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal CSV ────────────────────────────────────────────────────────── */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="relative w-full max-w-2xl rounded-2xl border my-8" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
            <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
              <h2 className="text-base font-semibold text-text">Importar Produtos (CSV)</h2>
              <button onClick={() => setImportOpen(false)} className="text-muted hover:text-text"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 px-6 py-5">
              {!importParsed ? (
                <>
                  <div className="rounded-lg border p-4 space-y-2" style={{ background: '#1B2638', borderColor: '#2A3650' }}>
                    <p className="text-xs font-semibold text-muted uppercase tracking-wider">Colunas reconhecidas (exportação Bling)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {['Código', 'Nome', 'Marca', 'Categoria', 'GTIN', 'Preço de Venda', 'Preço de Custo', 'Estoque', 'Unidade', 'Fornecedor'].map(c => (
                        <span key={c} className="rounded px-2 py-0.5 text-xs" style={{ background: '#10B98110', color: '#10B981', border: '1px solid #10B98130' }}>{c}</span>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => importFileRef.current?.click()}
                    className="w-full flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-10 transition-colors hover:border-accent"
                    style={{ borderColor: '#2A3650' }}>
                    <FileUp className="h-8 w-8 text-muted" />
                    <p className="text-sm font-medium text-text">Clique para selecionar o CSV</p>
                    <p className="text-xs text-muted">Exportação do Bling ou qualquer CSV com cabeçalho</p>
                  </button>
                  <input ref={importFileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleCsvFile} />
                </>
              ) : importResult ? (
                <div className="flex flex-col items-center gap-4 py-8">
                  <CheckCircle className="h-12 w-12" style={{ color: '#10B981' }} />
                  <div className="text-center space-y-1">
                    {importResult.created > 0 && <p className="text-lg font-bold text-text">{importResult.created} produto{importResult.created !== 1 ? 's' : ''} criado{importResult.created !== 1 ? 's' : ''}</p>}
                    {importResult.updated > 0 && <p className="text-base font-semibold" style={{ color: '#10B981' }}>{importResult.updated} atualizado{importResult.updated !== 1 ? 's' : ''}</p>}
                    {importResult.errors > 0  && <p className="text-sm text-muted">{importResult.errors} linha{importResult.errors !== 1 ? 's' : ''} ignorada{importResult.errors !== 1 ? 's' : ''}</p>}
                  </div>
                  <button onClick={() => setImportOpen(false)} className="rounded-lg px-6 py-2 text-sm font-semibold text-black" style={{ background: '#10B981' }}>Fechar</button>
                </div>
              ) : (
                <>
                  <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#2A3650' }}>
                    <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: '#2A3650', background: '#1B2638' }}>
                      <p className="text-sm font-medium text-text">{importRows.length} produtos encontrados</p>
                      <button onClick={() => { setImportParsed(false); setImportRows([]) }} className="text-xs text-muted hover:text-text">Trocar arquivo</button>
                    </div>
                    <div className="max-h-64 overflow-y-auto divide-y divide-[#2A3650]">
                      {importRows.slice(0, 50).map((r, i) => (
                        <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                          <div className="min-w-0">
                            <p className="text-text truncate font-medium">{r.name}</p>
                            <p className="text-xs text-muted">{r.code && `SKU: ${r.code} · `}{r.brand && `${r.brand} · `}{r.category && `${r.category} · `}Estoque: {r.stockQty}</p>
                          </div>
                          <p className="text-xs font-semibold ml-3 shrink-0" style={{ color: '#10B981' }}>
                            {r.priceCents > 0 ? `R$ ${(r.priceCents / 100).toFixed(2).replace('.', ',')}` : '—'}
                          </p>
                        </div>
                      ))}
                      {importRows.length > 50 && <p className="px-4 py-2 text-xs text-muted">… e mais {importRows.length - 50} produtos</p>}
                    </div>
                  </div>
                  {importError && <p className="text-xs" style={{ color: '#EF4444' }}>{importError}</p>}
                  <div className="flex gap-3">
                    <button onClick={() => setImportOpen(false)} className="flex-1 rounded-lg border py-2.5 text-sm text-muted hover:text-text" style={{ borderColor: '#2A3650' }}>Cancelar</button>
                    <button onClick={handleImport} disabled={importing}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold text-black"
                      style={{ background: '#10B981' }}>
                      {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                      {importing ? 'Importando…' : `Importar ${importRows.length} produtos`}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Delete ─────────────────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.7)' }}>
          <div className="w-full max-w-sm rounded-2xl border p-6 space-y-4" style={{ background: '#131C2A', borderColor: '#2A3650' }}>
            <div className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: '#EF444418' }}>
              <Trash2 className="h-6 w-6" style={{ color: '#EF4444' }} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-text">Excluir produto?</h3>
              <p className="mt-1 text-sm text-muted"><span className="font-medium text-text">{deleteTarget.name}</span> será removido permanentemente.</p>
            </div>
            {deleteError && <p className="text-xs" style={{ color: '#EF4444' }}>{deleteError}</p>}
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} className="flex-1 rounded-lg border py-2 text-sm text-muted hover:text-text" style={{ borderColor: '#2A3650' }}>Cancelar</button>
              <button onClick={handleDelete} disabled={deleting}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold text-white"
                style={{ background: '#EF4444' }}>
                {deleting && <Loader2 className="h-4 w-4 animate-spin" />} Excluir
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  )
}
