'use client'

/**
 * Seção de Despesas Recorrentes (custos fixos detalhados).
 * Substitui o campo único "Custo fixo da loja física" por uma lista
 * com cadastrar/editar/remover por categoria.
 */

import { useState, useTransition } from 'react'
import {
  Plus, Trash2, Edit2, Check, X, Building2,
} from 'lucide-react'
import {
  createRecurringExpense, updateRecurringExpense, deleteRecurringExpense,
} from '@/actions/recurring-expenses'
import {
  EXPENSE_CATEGORIES, type RecurringExpense, type ExpenseCategory,
} from '@/lib/expense-categories'
import { toast } from 'sonner'

const BRL = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)

function parseBRLToCents(s: string): number {
  const cleaned = s.replace(/[^\d,]/g, '').replace(',', '.')
  const num = parseFloat(cleaned)
  if (!Number.isFinite(num) || num < 0) return 0
  return Math.round(num * 100)
}

type Props = { initial: RecurringExpense[] }

export function RecurringExpensesSection({ initial }: Props) {
  const [items, setItems] = useState(initial)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // Form state pra add/edit
  const [name, setName] = useState('')
  const [category, setCategory] = useState<ExpenseCategory>('aluguel')
  const [valueStr, setValueStr] = useState('')

  const total = items.filter(i => i.active).reduce((s, i) => s + i.valueCents, 0)

  function resetForm() {
    setName('')
    setCategory('aluguel')
    setValueStr('')
    setAdding(false)
    setEditingId(null)
  }

  function startEdit(item: RecurringExpense) {
    setEditingId(item.id)
    setName(item.name)
    setCategory(item.category)
    setValueStr((item.valueCents / 100).toFixed(2).replace('.', ','))
    setAdding(false)
  }

  async function handleSave() {
    const valueCents = parseBRLToCents(valueStr)
    if (!name.trim()) { toast.error('Nome obrigatório'); return }
    if (valueCents <= 0) { toast.error('Valor inválido'); return }

    startTransition(async () => {
      if (editingId) {
        const res = await updateRecurringExpense({ id: editingId, name, category, valueCents })
        if (!res.ok) { toast.error(res.error ?? 'Erro ao salvar'); return }
        setItems(arr => arr.map(i => i.id === editingId
          ? { ...i, name, category, valueCents }
          : i
        ))
        toast.success('Despesa atualizada')
      } else {
        const res = await createRecurringExpense({ name, category, valueCents })
        if (!res.ok) { toast.error(res.error); return }
        setItems(arr => [...arr, {
          id: res.id, name, category, valueCents, active: true,
          createdAt: new Date().toISOString(),
        }])
        toast.success('Despesa adicionada')
      }
      resetForm()
    })
  }

  async function handleDelete(id: string) {
    if (!confirm('Apagar essa despesa?')) return
    startTransition(async () => {
      const res = await deleteRecurringExpense(id)
      if (!res.ok) { toast.error(res.error ?? 'Erro'); return }
      setItems(arr => arr.filter(i => i.id !== id))
      toast.success('Despesa removida')
    })
  }

  async function handleToggleActive(item: RecurringExpense) {
    startTransition(async () => {
      const res = await updateRecurringExpense({ id: item.id, active: !item.active })
      if (!res.ok) { toast.error(res.error ?? 'Erro'); return }
      setItems(arr => arr.map(i => i.id === item.id ? { ...i, active: !i.active } : i))
    })
  }

  return (
    <div className="rounded-xl border p-5"
      style={{ background: '#131C2A', borderColor: '#2A3650' }}>
      <div className="flex items-start gap-3 mb-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'rgba(255,184,0,.15)', color: '#F59E0B' }}>
          <Building2 className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h3 className="text-base font-bold" style={{ color: '#F8FAFC' }}>
            Custos fixos mensais
          </h3>
          <p className="text-xs mt-0.5" style={{ color: '#CBD5E1' }}>
            Cadastre cada despesa recorrente separadamente. O total é usado pra calcular o break-even
            no dashboard de Canais.
          </p>
        </div>
      </div>

      {/* Lista de despesas */}
      {items.length > 0 && (
        <div className="space-y-2 mb-3">
          {items.map(item => {
            const cat = EXPENSE_CATEGORIES.find(c => c.value === item.category)
            const isEditing = editingId === item.id
            if (isEditing) {
              return (
                <ExpenseForm key={item.id}
                  name={name} setName={setName}
                  category={category} setCategory={setCategory}
                  valueStr={valueStr} setValueStr={setValueStr}
                  onSave={handleSave} onCancel={resetForm} pending={pending}
                />
              )
            }
            return (
              <div key={item.id}
                className="flex items-center gap-3 rounded-lg border p-3"
                style={{
                  background: item.active ? '#1B2638' : 'rgba(15,26,43,.5)',
                  borderColor: '#2A3650',
                  opacity: item.active ? 1 : 0.55,
                }}>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded shrink-0"
                  style={{ background: `${cat?.color ?? '#94A3B8'}18`, color: cat?.color ?? '#94A3B8' }}>
                  {cat?.label ?? item.category}
                </span>
                <p className="text-sm font-semibold flex-1 truncate" style={{ color: '#F8FAFC' }}>
                  {item.name}
                </p>
                <p className="text-sm font-bold font-mono shrink-0" style={{ color: item.active ? '#10B981' : '#94A3B8' }}>
                  {BRL(item.valueCents)}
                </p>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => handleToggleActive(item)} disabled={pending}
                    className="px-2 py-1 text-[10px] font-bold uppercase rounded hover:bg-white/5"
                    style={{ color: item.active ? '#F59E0B' : '#10B981' }}
                    title={item.active ? 'Desativar' : 'Ativar'}>
                    {item.active ? 'On' : 'Off'}
                  </button>
                  <button onClick={() => startEdit(item)} disabled={pending}
                    className="p-1.5 rounded hover:bg-white/5"
                    style={{ color: '#22C55E' }}>
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleDelete(item.id)} disabled={pending}
                    className="p-1.5 rounded hover:bg-white/5"
                    style={{ color: '#EF4444' }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Form de adicionar (inline) */}
      {adding && !editingId && (
        <ExpenseForm
          name={name} setName={setName}
          category={category} setCategory={setCategory}
          valueStr={valueStr} setValueStr={setValueStr}
          onSave={handleSave} onCancel={resetForm} pending={pending}
        />
      )}

      {/* Botão Adicionar */}
      {!adding && !editingId && (
        <button onClick={() => setAdding(true)}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg border-2 border-dashed py-3 text-xs font-bold transition-colors hover:bg-white/[0.02]"
          style={{ borderColor: '#3A4868', color: '#22C55E' }}>
          <Plus className="h-4 w-4" /> Adicionar despesa
        </button>
      )}

      {/* Total */}
      <div className="mt-4 pt-4 border-t flex justify-between items-baseline"
        style={{ borderColor: '#2A3650' }}>
        <span className="text-sm font-bold" style={{ color: '#F8FAFC' }}>
          Total mensal (despesas ativas)
        </span>
        <span className="text-2xl font-bold font-mono" style={{ color: '#10B981' }}>
          {BRL(total)}
        </span>
      </div>

      {items.length === 0 && (
        <p className="text-[11px] mt-3" style={{ color: '#CBD5E1' }}>
          💡 Sem despesas cadastradas? Você ainda pode usar o campo &quot;Custo fixo&quot; antigo
          — vai migrar pra cá quando adicionar a 1ª despesa aqui.
        </p>
      )}
    </div>
  )
}

// ── Form inline ─────────────────────────────────────────────────────────────

function ExpenseForm({
  name, setName, category, setCategory, valueStr, setValueStr,
  onSave, onCancel, pending,
}: {
  name: string; setName: (s: string) => void
  category: ExpenseCategory; setCategory: (c: ExpenseCategory) => void
  valueStr: string; setValueStr: (s: string) => void
  onSave: () => void; onCancel: () => void; pending: boolean
}) {
  return (
    <div className="rounded-lg border-2 p-3 space-y-2"
      style={{ background: '#1B2638', borderColor: '#22C55E' }}>
      <div className="flex gap-2">
        <select value={category} onChange={e => setCategory(e.target.value as ExpenseCategory)}
          className="rounded-lg border px-3 py-2 text-xs font-bold uppercase shrink-0 cursor-pointer"
          style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }}>
          {EXPENSE_CATEGORIES.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <input type="text" value={name} onChange={e => setName(e.target.value)}
          placeholder="Ex: Aluguel da loja"
          autoFocus
          className="flex-1 rounded-lg border px-3 py-2 text-sm"
          style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }} />
      </div>
      <div className="flex gap-2 items-center">
        <span className="text-xs shrink-0" style={{ color: '#CBD5E1' }}>R$</span>
        <input type="text" inputMode="decimal" value={valueStr}
          onChange={e => setValueStr(e.target.value)}
          placeholder="0,00"
          className="flex-1 rounded-lg border px-3 py-2 text-sm font-mono"
          style={{ background: '#131C2A', borderColor: '#2A3650', color: '#F8FAFC' }} />
        <button onClick={onSave} disabled={pending}
          className="rounded-lg px-3 py-2 text-xs font-bold flex items-center gap-1 shrink-0"
          style={{ background: '#10B981', color: '#131C2A' }}>
          <Check className="h-3.5 w-3.5" /> Salvar
        </button>
        <button onClick={onCancel} disabled={pending}
          className="rounded-lg p-2 hover:bg-white/5 shrink-0"
          style={{ color: '#94A3B8' }}>
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
