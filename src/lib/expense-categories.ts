/** Categorias de despesas recorrentes + tipo da despesa.
 *  Arquivo separado das server actions porque arquivos `'use server'`
 *  só podem exportar funções async. */

export type ExpenseCategory =
  | 'aluguel' | 'salario' | 'luz' | 'agua' | 'internet'
  | 'contabilidade' | 'marketing' | 'pro_labore' | 'outros'

export type RecurringExpense = {
  id:         string
  name:       string
  category:   ExpenseCategory
  valueCents: number
  active:     boolean
  createdAt:  string
}

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string; color: string }[] = [
  { value: 'aluguel',       label: 'Aluguel',         color: '#FFB800' },
  { value: 'salario',       label: 'Salário',         color: '#00E5FF' },
  { value: 'pro_labore',    label: 'Pró-labore',      color: '#9B6DFF' },
  { value: 'luz',           label: 'Luz',             color: '#FFAA00' },
  { value: 'agua',          label: 'Água',            color: '#00C2FF' },
  { value: 'internet',      label: 'Internet',        color: '#00E5FF' },
  { value: 'contabilidade', label: 'Contabilidade',   color: '#8AA8C8' },
  { value: 'marketing',     label: 'Marketing',       color: '#E4405F' },
  { value: 'outros',        label: 'Outros',          color: '#5A7A9A' },
]
