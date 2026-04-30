/**
 * Helpers de aniversário — parse de datas, formatação, substituição de
 * variáveis no template da mensagem.
 */

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

export const DEFAULT_BIRTHDAY_TEMPLATE =
`Olá {nome}, é a {LOJA}! 🎉🎂

Soubemos que é seu aniversário {QUANDO} e queremos te dar um presente especial:

🎁 {DESCONTO}% de desconto em qualquer produto da loja durante o mês de {MES}!

Cupom: {CUPOM}
Válido até: {ULTIMO_DIA}

Vem comemorar com a gente! 🎈`

export type BirthdayInfo = {
  /** Mês 1-12, dia 1-31 (do birth_date do cliente) */
  month:    number
  day:      number
  /** Idade em anos COMPLETOS na data do aniversário deste ano. NULL se não tem ano. */
  age:      number | null
  /** "Hoje" | "Amanhã" | "Em 3 dias" | "Em 12 dias" */
  whenLabel: string
  /** Dia em formato BR (ex: "15/03") */
  dateBR:   string
  /** True se o aniversário é hoje */
  isToday:   boolean
  /** Diferença em dias do aniversário em relação a hoje (positivo = futuro, sempre 0..365) */
  daysUntil: number
}

/**
 * Parse de birth_date (formato YYYY-MM-DD) e retorna metadata útil.
 * NULL se a data for inválida.
 */
export function parseBirthDate(birthDate: string | null | undefined, today = new Date()): BirthdayInfo | null {
  if (!birthDate) return null

  // Aceita YYYY-MM-DD ou YYYY-MM-DDTHH:mm:ss
  const m = birthDate.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null

  const year  = parseInt(m[1], 10)
  const month = parseInt(m[2], 10)
  const day   = parseInt(m[3], 10)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  // Calcula próxima ocorrência do aniversário
  const todayY = today.getFullYear()
  const todayM = today.getMonth() + 1
  const todayD = today.getDate()

  let nextAnnivYear = todayY
  // Se o aniversário deste ano já passou, conta o do ano que vem
  if (month < todayM || (month === todayM && day < todayD)) {
    nextAnnivYear = todayY + 1
  }
  const nextAnniv = new Date(nextAnnivYear, month - 1, day, 12, 0, 0)
  const todayMid  = new Date(todayY, todayM - 1, todayD, 12, 0, 0)
  const daysUntil = Math.round((nextAnniv.getTime() - todayMid.getTime()) / 86400000)

  // Idade
  let age: number | null = null
  if (year > 1900 && year <= todayY) {
    age = todayY - year
    // Se ainda não chegou o aniversário deste ano, idade não incrementou
    if (todayM < month || (todayM === month && todayD < day)) age = age - 1
  }

  const whenLabel =
    daysUntil === 0 ? 'Hoje' :
    daysUntil === 1 ? 'Amanhã' :
    daysUntil <= 7  ? `Em ${daysUntil} dias` :
                      `Dia ${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}`

  return {
    month, day, age,
    whenLabel,
    dateBR:    `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}`,
    isToday:   daysUntil === 0,
    daysUntil,
  }
}

/**
 * Renderiza o template substituindo variáveis pelos valores do cliente.
 *
 * Variáveis suportadas:
 *   {nome}        → primeiro nome do cliente
 *   {NOME_COMPLETO} → nome completo
 *   {QUANDO}      → "hoje" se aniversário é hoje, "em DD/MM" caso contrário
 *   {MES}         → nome do mês corrente (ex: "Outubro")
 *   {DESCONTO}    → percentual de desconto
 *   {CUPOM}       → código do cupom (ex: "ANIVER2026")
 *   {ANO}         → ano corrente
 *   {ULTIMO_DIA}  → último dia do mês corrente em formato DD/MM/YYYY
 *   {LOJA}        → nome da loja (tenant.name)
 *   {IDADE}       → idade que está fazendo (vazio se não souber)
 */
export function renderBirthdayMessage(input: {
  template:        string
  customerName:    string
  birthInfo:       BirthdayInfo
  discountPercent: number
  tenantName:      string
  today?:          Date
}): string {
  const today = input.today ?? new Date()
  const year  = today.getFullYear()
  const month = today.getMonth() + 1
  const lastDay = new Date(year, month, 0).getDate()

  const firstName = input.customerName.split(' ')[0] || input.customerName

  return input.template
    .replace(/\{nome\}/g,           firstName)
    .replace(/\{NOME_COMPLETO\}/g,  input.customerName)
    .replace(/\{QUANDO\}/g,         input.birthInfo.isToday ? 'hoje' : `em ${input.birthInfo.dateBR}`)
    .replace(/\{MES\}/g,            MESES[month - 1])
    .replace(/\{DESCONTO\}/g,       String(input.discountPercent))
    .replace(/\{CUPOM\}/g,          `ANIVER${year}`)
    .replace(/\{ANO\}/g,            String(year))
    .replace(/\{ULTIMO_DIA\}/g,     `${lastDay.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}`)
    .replace(/\{LOJA\}/g,           input.tenantName)
    .replace(/\{IDADE\}/g,          input.birthInfo.age != null ? String(input.birthInfo.age) : '')
}

export function birthdayCouponCode(year: number = new Date().getFullYear()): string {
  return `ANIVER${year}`
}

/** Extrai mês/dia de um birth_date pra comparação. NULL se inválido. */
export function birthMonthDay(birthDate: string | null | undefined): { month: number; day: number } | null {
  if (!birthDate) return null
  const m = birthDate.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  return { month: parseInt(m[2], 10), day: parseInt(m[3], 10) }
}
