/**
 * Formatadores determinísticos (sem depender de ICU do runtime).
 *
 * `Intl.NumberFormat` e `toLocaleString` podem gerar outputs diferentes em
 * Node (server) vs Browser (client), causando hydration mismatch em
 * Client Components renderizados via SSR. Estes helpers normalizam o
 * output → server e client produzem o mesmo HTML.
 */

const pad2 = (n: number) => String(n).padStart(2, '0')

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`
}

/**
 * Formata cents em BRL de forma determinística.
 *
 * `Intl.NumberFormat('pt-BR', 'currency')` insere espaço não-quebrável
 * entre "R$" e o número — e esse caractere varia entre Node e browser:
 *   - U+00A0 (non-breaking space) em ICU antigo
 *   - U+202F (narrow no-break space) em ICU recente
 *
 * Esta função normaliza pra espaço comum (U+0020) → elimina hydration mismatch.
 */
export function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
    .format(cents / 100)
    .replace(/ /g, ' ')   // non-breaking space (Node ICU antigo)
    .replace(/ /g, ' ')   // narrow no-break space (Node ICU recente / browser)
}
