'use client'

import { useState, useRef, useTransition } from 'react'
import { X, Upload, Loader2, ChevronDown, AlertTriangle, ToggleLeft, ToggleRight, Copy } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  createProduct, updateProduct,
  type ProductRow, type ProductInput, type ProductFormat, type ProductCondition,
} from '@/actions/products'

// ── Constants ─────────────────────────────────────────────────────────────────

const UNITS = ['Un', 'Cx', 'Kg', 'g', 'L', 'ml', 'Par', 'Pç', 'Rolo', 'M']

const FORMATS: { value: ProductFormat; label: string }[] = [
  { value: 'simples',   label: 'Simples' },
  { value: 'variacoes', label: 'Com Variações' },
  { value: 'kit',       label: 'Kit' },
  { value: 'servico',   label: 'Serviço' },
]

const CONDITIONS: { value: ProductCondition; label: string }[] = [
  { value: 'novo',            label: 'Novo' },
  { value: 'usado',           label: 'Usado' },
  { value: 'recondicionado',  label: 'Recondicionado' },
]

const TABS = ['Dados Básicos', 'Características', 'Imagens', 'Estoque', 'Fiscal'] as const
type Tab = typeof TABS[number]

const EMPTY_FORM: ProductInput = {
  code: '', name: '', brand: '', category: '',
  format: 'simples', condition: 'novo', gtin: '',
  weightG: null, grossWeightG: null, heightCm: null, widthCm: null, depthCm: null,
  purchasePriceCents: 0, costCents: 0, priceCents: 0,
  unit: 'Un', stockQty: 0, stockMin: 0, stockMax: 0,
  location: '', supplier: '', imageUrls: [], description: '', active: true,
  ncm: '', cfop: '5102', cstCsosn: '102', origem: '0',
  warrantyDays: null,
}

const INP   = 'w-full rounded-lg border bg-transparent px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent'
const INP_S = { borderColor: '#2A3650' }

const BRL      = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100)
const parseBRL = (v: string) => parseInt(v.replace(/\D/g, '') || '0', 10)
const fmtBRL   = (c: number) => (c / 100).toFixed(2).replace('.', ',')

// GTIN válido: vazio (opcional) ou 8/12/13/14 dígitos numéricos
function validateGtin(gtin: string): string {
  const trimmed = gtin.trim()
  if (!trimmed) return ''
  if (!/^\d+$/.test(trimmed))           return 'GTIN deve conter apenas dígitos numéricos.'
  if (![8, 12, 13, 14].includes(trimmed.length))
    return `GTIN com ${trimmed.length} dígito${trimmed.length !== 1 ? 's' : ''} é inválido. Use 8, 12, 13 ou 14 dígitos.`
  return ''
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function PriceInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted">R$</span>
        <input
          type="text" inputMode="numeric"
          value={fmtBRL(value)}
          onChange={e => onChange(parseBRL(e.target.value))}
          className={INP} style={{ ...INP_S, paddingLeft: '2.25rem' }}
        />
      </div>
    </div>
  )
}

function NumberInput({ label, value, onChange, placeholder, unit }: {
  label: string; value: number | null; onChange: (v: number | null) => void; placeholder?: string; unit?: string
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      <div className="relative">
        <input
          type="number" min={0} step="any"
          value={value ?? ''}
          placeholder={placeholder ?? '0'}
          onChange={e => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
          className={INP}
          style={unit ? { ...INP_S, paddingRight: '2.5rem' } : INP_S}
        />
        {unit && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">{unit}</span>}
      </div>
    </div>
  )
}

function AutocompleteInput({ label, value, onChange, placeholder, suggestions }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; suggestions: string[]
}) {
  const [open, setOpen] = useState(false)
  const filtered = value ? suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase())) : suggestions
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      <div className="relative">
        <input
          value={value}
          onChange={e => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder} className={INP} style={INP_S}
        />
        {open && filtered.length > 0 && (
          <div className="absolute top-full left-0 right-0 z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border shadow-xl"
            style={{ background: '#131C2A', borderColor: '#2A3650' }}>
            {filtered.map(s => (
              <button key={s} type="button" onMouseDown={() => { onChange(s); setOpen(false) }}
                className="block w-full px-3 py-2 text-left text-sm text-text hover:bg-white/5">{s}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Props ──────────────────────────────────────────────────────────────────────

type Props = {
  editing:     ProductRow | null
  cloneFrom?:  ProductRow | null
  brands:      string[]
  categories:  string[]
  onClose:     () => void
  onSaved:     (product: ProductRow, isNew: boolean) => void
  onNewBrand:  (brand: string) => void
  onNewCategory: (category: string) => void
}

// ── Component ──────────────────────────────────────────────────────────────────

export function ProdutoModal({
  editing, cloneFrom, brands, categories,
  onClose, onSaved, onNewBrand, onNewCategory,
}: Props) {

  function buildInitial(): ProductInput {
    const source = cloneFrom ?? editing
    if (!source) return EMPTY_FORM
    return {
      code:               cloneFrom ? '' : (source.code ?? ''),
      name:               cloneFrom ? `${source.name} (Cópia)` : source.name,
      brand:              source.brand ?? '',
      category:           source.category ?? '',
      format:             source.format,
      condition:          source.condition,
      gtin:               cloneFrom ? '' : (source.gtin ?? ''),
      weightG:            source.weight_g,
      grossWeightG:       source.gross_weight_g,
      heightCm:           source.height_cm,
      widthCm:            source.width_cm,
      depthCm:            source.depth_cm,
      purchasePriceCents: source.purchase_price_cents,
      costCents:          source.cost_cents,
      priceCents:         source.price_cents,
      unit:               source.unit,
      stockQty:           cloneFrom ? 0 : source.stock_qty,
      stockMin:           source.stock_min,
      stockMax:           source.stock_max,
      location:           source.location ?? '',
      supplier:           source.supplier ?? '',
      imageUrls:          cloneFrom ? [] : (source.image_urls ?? []),
      description:        source.description ?? '',
      active:             cloneFrom ? false : source.active,
      // Campos fiscais
      ncm:                source.ncm      ?? '',
      cfop:               source.cfop     ?? '5102',
      cstCsosn:           source.cst_csosn ?? '102',
      origem:             source.origem   ?? '0',
      // Garantia (Fase 3 — comprovante)
      warrantyDays:       source.warranty_days ?? null,
    }
  }

  const [form, setForm]       = useState<ProductInput>(buildInitial)
  const [tab, setTab]         = useState<Tab>('Dados Básicos')
  const [error, setError]     = useState('')
  const [gtinError, setGtinError] = useState('')
  const [saving, startSave]   = useTransition()
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const isClone = !!cloneFrom
  const isNew   = !editing && !cloneFrom

  const set = <K extends keyof ProductInput>(k: K, v: ProductInput[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  function handleGtinChange(value: string) {
    set('gtin', value)
    setGtinError(validateGtin(value))
  }

  async function handleSave() {
    const gtinErr = validateGtin(form.gtin)
    if (gtinErr) { setGtinError(gtinErr); setTab('Características'); return }
    setError('')
    startSave(async () => {
      try {
        if (editing && !isClone) {
          const updated = await updateProduct(editing.id, form)
          onSaved(updated, false)
        } else {
          const created = await createProduct(form)
          onSaved(created, true)
        }
        if (form.brand)    onNewBrand(form.brand)
        if (form.category) onNewCategory(form.category)
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao salvar.')
      }
    })
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    if ((form.imageUrls.length + files.length) > 4) { setError('Máximo de 4 imagens.'); return }
    setUploading(true)
    const supabase = createClient()
    const urls: string[] = []
    for (const file of files) {
      const ext  = file.name.split('.').pop()
      const path = `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { error: upErr } = await supabase.storage.from('product-images').upload(path, file, { upsert: false })
      if (upErr) { setError('Erro no upload.'); setUploading(false); return }
      const { data: { publicUrl } } = supabase.storage.from('product-images').getPublicUrl(path)
      urls.push(publicUrl)
    }
    set('imageUrls', [...form.imageUrls, ...urls])
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const modalTitle = isClone ? 'Clonar Produto' : editing ? 'Editar Produto' : 'Novo Produto'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="relative w-full max-w-2xl rounded-2xl border my-8"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}>

        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: '#2A3650' }}>
          <div className="flex items-center gap-2">
            {isClone && <Copy className="h-4 w-4" style={{ color: '#10B981' }} />}
            <h2 className="text-base font-semibold text-text">{modalTitle}</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-text"><X className="h-5 w-5" /></button>
        </div>

        {/* Banner de clone */}
        {isClone && (
          <div className="border-b px-6 py-3 text-xs flex items-center gap-2"
            style={{ borderColor: '#2A3650', background: '#10B98110', color: '#10B981' }}>
            <Copy className="h-3.5 w-3.5 shrink-0" />
            Baseado em <span className="font-semibold mx-1">{cloneFrom!.name}</span>
            — SKU em branco, estoque zerado e produto inativo até você revisar.
          </div>
        )}

        {/* Dados fixos no topo */}
        <div className="border-b px-6 py-4 space-y-4" style={{ borderColor: '#2A3650' }}>
          {error && (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
              style={{ background: '#EF444418', color: '#EF4444', border: '1px solid #EF444440' }}>
              <AlertTriangle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}

          {/* Nome + SKU */}
          <div className="grid grid-cols-[1fr_180px] gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Nome do Produto *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)}
                placeholder="Ex: Tela iPhone 13 Original" className={INP} style={INP_S} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">
                Código / SKU{isClone && <span className="ml-1 text-[10px] text-muted">(deixe em branco ou defina um novo)</span>}
              </label>
              <input value={form.code} onChange={e => set('code', e.target.value)}
                placeholder={isClone ? 'Novo SKU…' : 'Ex: TELA-IP13'} className={INP} style={INP_S} />
            </div>
          </div>

          {/* Formato + Unidade + Preço venda */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Formato</label>
              <div className="relative">
                <select value={form.format} onChange={e => set('format', e.target.value as ProductFormat)}
                  className={INP} style={{ ...INP_S, appearance: 'none', paddingRight: '2rem', cursor: 'pointer' }}>
                  {FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Unidade</label>
              <div className="relative">
                <select value={form.unit} onChange={e => set('unit', e.target.value)}
                  className={INP} style={{ ...INP_S, appearance: 'none', paddingRight: '2rem', cursor: 'pointer' }}>
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
              </div>
            </div>
            <PriceInput label="Preço de Venda *" value={form.priceCents} onChange={v => set('priceCents', v)} />
          </div>
        </div>

        {/* Abas */}
        <div className="border-b flex" style={{ borderColor: '#2A3650' }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`relative px-5 py-3 text-sm font-medium transition-colors border-b-2 ${
                tab === t ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'
              }`}
              style={tab === t ? { borderColor: '#10B981', color: '#fff' } : {}}>
              {t}
              {/* Ponto de erro na aba Características quando GTIN inválido */}
              {t === 'Características' && gtinError && (
                <span className="absolute right-2 top-2.5 h-1.5 w-1.5 rounded-full bg-red-400" />
              )}
            </button>
          ))}
        </div>

        {/* Conteúdo da aba */}
        <div className="px-6 py-5 space-y-4 min-h-[240px]">

          {/* ── Dados Básicos ──────────────────────────────────────────── */}
          {tab === 'Dados Básicos' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <AutocompleteInput label="Marca" value={form.brand}
                  onChange={v => set('brand', v)} placeholder="Ex: Apple, Samsung…" suggestions={brands} />
                <AutocompleteInput label="Categoria" value={form.category}
                  onChange={v => set('category', v)} placeholder="Ex: Telas, Baterias…" suggestions={categories} />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <PriceInput label="Preço de Compra" value={form.purchasePriceCents}
                  onChange={v => set('purchasePriceCents', v)} />
                <PriceInput label="Preço de Custo" value={form.costCents}
                  onChange={v => set('costCents', v)} />
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Fornecedor</label>
                  <input value={form.supplier} onChange={e => set('supplier', e.target.value)}
                    placeholder="Ex: Distribuidora ABC" className={INP} style={INP_S} />
                </div>
              </div>

              {form.costCents > 0 && form.priceCents > 0 && (
                <div className="rounded-lg px-3 py-2 text-xs"
                  style={{ background: '#10B98110', border: '1px solid #10B98130', color: '#10B981' }}>
                  Margem: {(((form.priceCents - form.costCents) / form.priceCents) * 100).toFixed(1)}%
                  &nbsp;·&nbsp;
                  Lucro: {BRL(form.priceCents - form.costCents)}
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-medium text-muted">Descrição / Observações</label>
                <textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)}
                  placeholder="Informações adicionais…" className={INP} style={{ ...INP_S, resize: 'vertical' }} />
              </div>

              <div className="flex items-center justify-between rounded-lg border px-4 py-3"
                style={{ borderColor: '#2A3650' }}>
                <div>
                  <p className="text-sm font-medium text-text">Situação</p>
                  <p className="text-xs text-muted">Inativos não aparecem no Frente de Caixa</p>
                </div>
                <button type="button" onClick={() => set('active', !form.active)}>
                  {form.active
                    ? <ToggleRight className="h-8 w-8" style={{ color: '#10B981' }} />
                    : <ToggleLeft className="h-8 w-8 text-muted" />}
                </button>
              </div>
            </>
          )}

          {/* ── Características ────────────────────────────────────────── */}
          {tab === 'Características' && (
            <>
              {/* GTIN / EAN com validação */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    Código de Barras (GTIN / EAN)
                  </label>
                  <div className="relative">
                    <input
                      value={form.gtin}
                      onChange={e => handleGtinChange(e.target.value)}
                      placeholder="Ex: 7891234567890 (13 dígitos)"
                      className={INP}
                      style={{
                        ...INP_S,
                        ...(gtinError ? { borderColor: '#EF4444' } : form.gtin.trim() ? { borderColor: '#10B981' } : {}),
                      }}
                    />
                    {form.gtin.trim() && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium"
                        style={{ color: gtinError ? '#EF4444' : '#10B981' }}>
                        {gtinError ? '✗' : '✓'}
                      </span>
                    )}
                  </div>
                  {gtinError && (
                    <p className="mt-1 text-xs flex items-center gap-1" style={{ color: '#EF4444' }}>
                      <AlertTriangle className="h-3 w-3 shrink-0" />{gtinError}
                    </p>
                  )}
                  {!gtinError && form.gtin.trim() && (
                    <p className="mt-1 text-xs" style={{ color: '#10B981' }}>
                      GTIN-{form.gtin.trim().length} válido
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted">EAN-13, EAN-8, UPC-A (12) ou ITF-14</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Condição</label>
                  <div className="relative">
                    <select value={form.condition}
                      onChange={e => set('condition', e.target.value as ProductCondition)}
                      className={INP} style={{ ...INP_S, appearance: 'none', paddingRight: '2rem', cursor: 'pointer' }}>
                      {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
                  </div>
                </div>
              </div>

              {/* Pesos */}
              <div>
                <label className="mb-2 block text-xs font-medium text-muted uppercase tracking-wider">Peso</label>
                <div className="grid grid-cols-2 gap-3">
                  <NumberInput label="Peso Líquido" value={form.weightG}
                    onChange={v => set('weightG', v)} unit="g"
                    placeholder="Peso sem embalagem" />
                  <NumberInput label="Peso Bruto" value={form.grossWeightG}
                    onChange={v => set('grossWeightG', v)} unit="g"
                    placeholder="Peso com embalagem" />
                </div>
              </div>

              {/* Dimensões */}
              <div>
                <label className="mb-2 block text-xs font-medium text-muted uppercase tracking-wider">
                  Dimensões (embalagem)
                </label>
                <div className="grid grid-cols-3 gap-3">
                  <NumberInput label="Altura"       value={form.heightCm} onChange={v => set('heightCm', v)} unit="cm" />
                  <NumberInput label="Largura"      value={form.widthCm}  onChange={v => set('widthCm', v)}  unit="cm" />
                  <NumberInput label="Profundidade" value={form.depthCm}  onChange={v => set('depthCm', v)}  unit="cm" />
                </div>
              </div>
            </>
          )}

          {/* ── Imagens ────────────────────────────────────────────────── */}
          {tab === 'Imagens' && (
            <div>
              <p className="mb-3 text-xs text-muted">Até 4 imagens por produto</p>
              <div className="flex flex-wrap gap-3">
                {form.imageUrls.map((url, i) => (
                  <div key={i} className="relative h-24 w-24 rounded-lg overflow-hidden"
                    style={{ border: '1px solid #2A3650' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="h-full w-full object-cover" />
                    <button type="button"
                      onClick={() => set('imageUrls', form.imageUrls.filter(u => u !== url))}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-white"
                      style={{ background: 'rgba(0,0,0,0.7)' }}>
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {form.imageUrls.length < 4 && (
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                    className="flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed transition-colors hover:border-accent"
                    style={{ borderColor: '#2A3650', color: '#94A3B8' }}>
                    {uploading ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
                    <span className="text-xs">{uploading ? 'Enviando…' : 'Upload'}</span>
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
                onChange={handleImageUpload} />
            </div>
          )}

          {/* ── Estoque ────────────────────────────────────────────────── */}
          {tab === 'Estoque' && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Qtd. Atual</label>
                  <input type="number" min={0}
                    value={form.stockQty}
                    onChange={e => set('stockQty', parseInt(e.target.value) || 0)}
                    className={INP} style={INP_S} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Estoque Mínimo</label>
                  <input type="number" min={0}
                    value={form.stockMin}
                    onChange={e => set('stockMin', parseInt(e.target.value) || 0)}
                    className={INP} style={INP_S} />
                  <p className="mt-1 text-xs text-muted">Ponto de reposição</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Estoque Máximo</label>
                  <input type="number" min={0}
                    value={form.stockMax}
                    onChange={e => set('stockMax', parseInt(e.target.value) || 0)}
                    className={INP} style={INP_S} />
                  <p className="mt-1 text-xs text-muted">Limite de compra</p>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted">Localização / Prateleira</label>
                <input value={form.location} onChange={e => set('location', e.target.value)}
                  placeholder="Ex: A1-P3, Corredor 2, Galpão B…" className={INP} style={INP_S} />
              </div>

              {/* Alertas de estoque */}
              {form.stockMin > 0 && form.stockQty <= 0 && (
                <div className="rounded-lg px-3 py-2 text-xs flex items-center gap-2"
                  style={{ background: '#EF444418', color: '#EF4444', border: '1px solid #EF444440' }}>
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Sem estoque — produto indisponível para venda.
                </div>
              )}
              {form.stockMin > 0 && form.stockQty > 0 && form.stockQty <= form.stockMin && (
                <div className="rounded-lg px-3 py-2 text-xs flex items-center gap-2"
                  style={{ background: '#F59E0B18', color: '#F59E0B', border: '1px solid #F59E0B40' }}>
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Estoque abaixo do mínimo — repor a partir de {form.stockMin} unidades.
                </div>
              )}
              {form.stockMax > 0 && form.stockQty > form.stockMax && (
                <div className="rounded-lg px-3 py-2 text-xs flex items-center gap-2"
                  style={{ background: '#94A3B818', color: '#60A5FA', border: '1px solid #94A3B840' }}>
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Estoque acima do máximo configurado ({form.stockMax} unidades).
                </div>
              )}
            </>
          )}

          {/* ── Fiscal (NF-e/NFC-e) ────────────────────────────────────── */}
          {tab === 'Fiscal' && (
            <>
              <div className="rounded-lg p-3 mb-3 text-xs flex items-start gap-2"
                style={{ background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.3)', color: '#CBD5E1' }}>
                <span style={{ color: '#3B82F6', fontSize: '1rem' }}>ℹ</span>
                <span>
                  Esses campos são usados ao emitir NFC-e/NF-e. Se vazios, o sistema usa os
                  valores padrão da configuração fiscal do tenant. <strong>NCM é obrigatório
                  pra emissão real</strong> — você consulta no <a href="https://portalunico.siscomex.gov.br/classif/" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: '#3B82F6' }}>Siscomex</a>.
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">NCM <span style={{ color: '#F87171' }}>*</span></label>
                  <input value={form.ncm ?? ''} onChange={e => set('ncm', e.target.value.replace(/\D/g, '').slice(0, 8))}
                    placeholder="8 dígitos (ex: 85171231 = celular)"
                    className={INP} style={INP_S} maxLength={8} />
                  <p className="mt-1 text-xs text-muted">Código de classificação fiscal</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">CFOP</label>
                  <input value={form.cfop ?? ''} onChange={e => set('cfop', e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="5102" className={INP} style={INP_S} maxLength={4} />
                  <p className="mt-1 text-xs text-muted">5102 = venda merc. dentro do estado</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">CSOSN / CST</label>
                  <input value={form.cstCsosn ?? ''} onChange={e => set('cstCsosn', e.target.value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="102" className={INP} style={INP_S} maxLength={4} />
                  <p className="mt-1 text-xs text-muted">102 = Simples sem permissão de crédito</p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Origem</label>
                  <select value={form.origem ?? '0'} onChange={e => set('origem', e.target.value)}
                    className={INP} style={INP_S}>
                    <option value="0">0 — Nacional</option>
                    <option value="1">1 — Importação direta</option>
                    <option value="2">2 — Importação adquirida no mercado interno</option>
                    <option value="3">3 — Nacional com conteúdo importação 40-70%</option>
                    <option value="4">4 — Nacional com processo produtivo básico (PPB)</option>
                    <option value="5">5 — Nacional com conteúdo importação ≤40%</option>
                    <option value="6">6 — Importação direta (similar nacional)</option>
                    <option value="7">7 — Importação adquirida (similar nacional)</option>
                    <option value="8">8 — Nacional com conteúdo importação &gt;70%</option>
                  </select>
                </div>
              </div>

              <div className="mt-2 rounded-lg border p-3" style={{ borderColor: '#2A3650', background: 'rgba(168, 139, 250, 0.05)' }}>
                <label className="mb-1 block text-xs font-semibold" style={{ color: '#A78BFA' }}>
                  Garantia do produto (em dias)
                </label>
                <input
                  type="number"
                  min={0} max={3650}
                  value={form.warrantyDays ?? ''}
                  onChange={e => {
                    const v = e.target.value
                    set('warrantyDays', v === '' ? null : parseInt(v, 10) || 0)
                  }}
                  placeholder="Vazio = padrão do tenant"
                  className={INP} style={INP_S}
                />
                <p className="mt-1 text-xs text-muted">
                  Acessórios eletrônicos: <strong>90</strong> · Celular novo lacrado: <strong>365</strong> · Seminovo: <strong>90</strong>. Vazio usa o padrão configurado.
                </p>
              </div>
            </>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t px-6 py-4"
          style={{ borderColor: '#2A3650' }}>
          <button onClick={onClose}
            className="rounded-lg border px-4 py-2 text-sm text-muted hover:text-text transition-colors"
            style={{ borderColor: '#2A3650' }}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || !form.name.trim() || !!gtinError}
            className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold text-black disabled:opacity-50"
            style={{ background: '#10B981' }}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving
              ? 'Salvando…'
              : isClone
                ? 'Criar Cópia'
                : editing
                  ? 'Salvar Alterações'
                  : 'Cadastrar Produto'}
          </button>
        </div>

      </div>
    </div>
  )
}
