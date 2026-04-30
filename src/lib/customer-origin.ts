// Opções de "Como nos conheceu?" — fonte única para PhoneSmart e CheckSmart.
// Os valores (slug) devem bater com a CHECK constraint da migração 007.

export const CUSTOMER_ORIGIN_OPTIONS = [
  { value: 'instagram_pago',     label: 'Instagram Anúncio Pago' },
  { value: 'instagram_organico', label: 'Instagram Orgânico'     },
  { value: 'indicacao',          label: 'Indicação de Amigo'     },
  { value: 'passou_na_porta',    label: 'Passou na Porta'        },
  { value: 'google',             label: 'Google'                 },
  { value: 'facebook',           label: 'Facebook'               },
  { value: 'outros',             label: 'Outros'                 },
] as const

export type CustomerOrigin = typeof CUSTOMER_ORIGIN_OPTIONS[number]['value']

const LABELS = Object.fromEntries(
  CUSTOMER_ORIGIN_OPTIONS.map(o => [o.value, o.label]),
) as Record<CustomerOrigin, string>

export function originLabel(value: string | null | undefined): string {
  if (!value) return 'Não informado'
  return LABELS[value as CustomerOrigin] ?? value
}

export function isValidOrigin(value: string | null | undefined): value is CustomerOrigin {
  return !!value && value in LABELS
}
