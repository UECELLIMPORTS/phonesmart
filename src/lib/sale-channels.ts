/**
 * Canais de venda e modalidades de entrega.
 *
 * Fonte única de verdade pra options, labels, cores e agrupamentos
 * (online/física) usados em POS, Financeiro e no dashboard de canais.
 */

export type SaleChannel =
  | 'whatsapp'
  | 'instagram_dm'
  | 'delivery_online'
  | 'fisica_balcao'
  | 'fisica_retirada'
  | 'outro'

export type DeliveryType = 'counter' | 'pickup' | 'shipping'

export type SaleChannelOption = {
  value: SaleChannel
  label: string
  group: 'online' | 'fisica' | 'outro'
  color: string
  deprecated?: boolean   // se true, mantém no enum mas não aparece nos selects
}

export const SALE_CHANNEL_OPTIONS: SaleChannelOption[] = [
  { value: 'whatsapp',        label: 'WhatsApp',           group: 'online',  color: '#25D366' },
  { value: 'instagram_dm',    label: 'Instagram DM',       group: 'online',  color: '#E4405F' },
  { value: 'delivery_online', label: 'Marketplace / Site', group: 'online',  color: '#00E5FF' },
  { value: 'fisica_balcao',   label: 'Loja Física',        group: 'fisica',  color: '#FFAA00' },
  // fisica_retirada: deprecated. Era um canal redundante (mesma info de
  // sale_channel='whatsapp' + delivery_type='pickup'). Mantemos no enum
  // por compatibilidade com dados antigos, mas agora ela é tratada como
  // ONLINE (porque a venda começou online — só a entrega foi física).
  { value: 'fisica_retirada', label: 'Retirada (legacy)',  group: 'online',  color: '#9B6DFF', deprecated: true },
  { value: 'outro',           label: 'Outro',              group: 'outro',   color: '#8AA8C8' },
]

// Opções pickable nos selects (POS, Financeiro, etc) — exclui deprecated.
export const SALE_CHANNEL_OPTIONS_PICKABLE: SaleChannelOption[] = SALE_CHANNEL_OPTIONS.filter(o => !o.deprecated)

export const DELIVERY_TYPE_OPTIONS: { value: DeliveryType; label: string }[] = [
  { value: 'counter',  label: 'Balcão (levou na hora)' },
  { value: 'pickup',   label: 'Retirou depois' },
  { value: 'shipping', label: 'Enviei (delivery)' },
]

export function channelLabel(channel: string | null): string {
  if (!channel) return 'Não informado'
  return SALE_CHANNEL_OPTIONS.find(o => o.value === channel)?.label ?? channel
}

export function channelGroup(channel: string | null): 'online' | 'fisica' | 'outro' {
  if (!channel) return 'outro'
  return SALE_CHANNEL_OPTIONS.find(o => o.value === channel)?.group ?? 'outro'
}

export function channelColor(channel: string | null): string {
  if (!channel) return '#5A7A9A'
  return SALE_CHANNEL_OPTIONS.find(o => o.value === channel)?.color ?? '#8AA8C8'
}

export function deliveryLabel(delivery: string | null): string {
  if (!delivery) return 'Não informado'
  return DELIVERY_TYPE_OPTIONS.find(o => o.value === delivery)?.label ?? delivery
}

export function isValidChannel(value: string | null): value is SaleChannel {
  if (!value) return false
  return SALE_CHANNEL_OPTIONS.some(o => o.value === value)
}

export function isValidDelivery(value: string | null): value is DeliveryType {
  if (!value) return false
  return DELIVERY_TYPE_OPTIONS.some(o => o.value === value)
}

/**
 * "Efeito sustento": quanto da categoria física é na verdade retirada
 * de venda online. Se 30% das vendas são "físicas" mas 18 p.p. são
 * retiradas, a física PURA (balcão) é só 12% — o online financia o resto.
 */
export function calculateSustentoEffect(
  fisicaBalcao: number,
  fisicaRetirada: number,
): { fisicaPura: number; retirada: number; pctRetiradaDaFisica: number } {
  const total = fisicaBalcao + fisicaRetirada
  const pctRetiradaDaFisica = total > 0 ? fisicaRetirada / total : 0
  return {
    fisicaPura:          fisicaBalcao,
    retirada:            fisicaRetirada,
    pctRetiradaDaFisica,
  }
}
