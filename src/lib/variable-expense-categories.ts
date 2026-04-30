/**
 * Categorias de gastos variáveis — fonte única pra módulo /gastos.
 * Agrupadas por área pra UI mostrar de forma organizada nos selects.
 */

export const VARIABLE_EXPENSE_CATEGORIES = [
  // Logística
  { value: 'motoboy',         label: 'Moto boy / Entregador',  group: 'Logística', color: '#06B6D4' },
  { value: 'frete',           label: 'Frete / Envio',          group: 'Logística', color: '#0EA5E9' },
  { value: 'combustivel',     label: 'Combustível',            group: 'Logística', color: '#3B82F6' },

  // Operação
  { value: 'limpeza',         label: 'Produtos de limpeza',    group: 'Operação',  color: '#10B981' },
  { value: 'escritorio',      label: 'Material de escritório', group: 'Operação',  color: '#22C55E' },
  { value: 'manutencao',      label: 'Manutenção / Reparos',   group: 'Operação',  color: '#84CC16' },
  { value: 'utilidades',      label: 'Energia / Água (extra)', group: 'Operação',  color: '#65A30D' },

  // Marketing
  { value: 'anuncios',        label: 'Anúncios avulsos',       group: 'Marketing', color: '#E4405F' },
  { value: 'brindes',         label: 'Brindes / Promoções',    group: 'Marketing', color: '#EC4899' },
  { value: 'eventos',         label: 'Eventos / Feiras',       group: 'Marketing', color: '#D946EF' },

  // Estoque
  { value: 'compra_avulsa',   label: 'Compra avulsa',          group: 'Estoque',   color: '#F59E0B' },
  { value: 'reposicao_rapida',label: 'Reposição rápida',       group: 'Estoque',   color: '#EAB308' },

  // Pessoal
  { value: 'lanche',          label: 'Lanche / Alimentação',   group: 'Pessoal',   color: '#A78BFA' },
  { value: 'transporte',      label: 'Vale transporte',        group: 'Pessoal',   color: '#8B5CF6' },

  // Perdas
  { value: 'prejuizo',        label: 'Prejuízo / Quebra',      group: 'Perdas',    color: '#EF4444' },
  { value: 'multa',           label: 'Multa / Taxa',           group: 'Perdas',    color: '#DC2626' },

  // Outros
  { value: 'outros',          label: 'Outros',                 group: 'Outros',    color: '#94A3B8' },
] as const

export type VariableExpenseCategory = typeof VARIABLE_EXPENSE_CATEGORIES[number]['value']

const META = Object.fromEntries(
  VARIABLE_EXPENSE_CATEGORIES.map(c => [c.value, c]),
) as Record<VariableExpenseCategory, typeof VARIABLE_EXPENSE_CATEGORIES[number]>

export function categoryLabel(value: string | null | undefined): string {
  if (!value) return 'Sem categoria'
  return META[value as VariableExpenseCategory]?.label ?? value
}

export function categoryColor(value: string | null | undefined): string {
  if (!value) return '#94A3B8'
  return META[value as VariableExpenseCategory]?.color ?? '#94A3B8'
}

export function categoryGroup(value: string | null | undefined): string {
  if (!value) return 'Outros'
  return META[value as VariableExpenseCategory]?.group ?? 'Outros'
}

export function isValidCategory(value: string | null | undefined): value is VariableExpenseCategory {
  return !!value && value in META
}

// Agrupa pra <optgroup> nos selects
export function groupedCategories(): { group: string; items: typeof VARIABLE_EXPENSE_CATEGORIES[number][] }[] {
  const map = new Map<string, typeof VARIABLE_EXPENSE_CATEGORIES[number][]>()
  for (const c of VARIABLE_EXPENSE_CATEGORIES) {
    const arr = map.get(c.group) ?? []
    arr.push(c)
    map.set(c.group, arr)
  }
  return Array.from(map.entries()).map(([group, items]) => ({ group, items }))
}
