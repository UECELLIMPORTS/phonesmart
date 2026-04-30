'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  FileText, RefreshCw, X, Loader2, CheckCircle2, XCircle, Clock,
  AlertCircle, Eye, Settings, Download, Code,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  refreshEmissionStatus, cancelEmission,
  type EmissionListItem,
} from '@/actions/fiscal-emit'

type Props = {
  initial:        EmissionListItem[]
  configEnabled:  boolean
}

const BRL = (c: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100)

const fmtDate = (iso: string | null) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const STATUS_LABEL: Record<string, string> = {
  draft:        'Rascunho',
  processing:   'Processando',
  authorized:   'Autorizada',
  cancelled:    'Cancelada',
  rejected:     'Rejeitada',
  inutilizada:  'Inutilizada',
}

const STATUS_COLOR: Record<string, string> = {
  draft:        '#94A3B8',
  processing:   '#FBBF24',
  authorized:   '#22C55E',
  cancelled:    '#94A3B8',
  rejected:     '#F87171',
  inutilizada:  '#94A3B8',
}

const TYPE_LABEL: Record<string, string> = {
  nfce: 'NFC-e',
  nfe:  'NF-e',
  nfse: 'NFS-e',
}

export function NotasFiscaisClient({ initial, configEnabled }: Props) {
  const router = useRouter()
  const [emissions, setEmissions] = useState(initial)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter]     = useState<string>('all')
  const [refreshing, startRefresh]      = useTransition()
  const [cancelling, setCancelling]     = useState<{ emission: EmissionListItem; reason: string } | null>(null)
  const [cancelPending, startCancel]    = useTransition()

  const filtered = emissions.filter(e => {
    if (statusFilter !== 'all' && e.status !== statusFilter) return false
    if (typeFilter !== 'all' && e.type !== typeFilter) return false
    return true
  })

  function handleRefresh(emissionId: string) {
    startRefresh(async () => {
      const res = await refreshEmissionStatus(emissionId)
      if (!res.ok) { toast.error(res.error); return }
      toast.success(`Status: ${STATUS_LABEL[res.data?.status ?? ''] ?? res.data?.status}`)
      router.refresh()
    })
  }

  function handleCancelSubmit() {
    if (!cancelling) return
    startCancel(async () => {
      const res = await cancelEmission(cancelling.emission.id, cancelling.reason)
      if (!res.ok) { toast.error(res.error); return }
      toast.success('Nota cancelada.')
      setCancelling(null)
      router.refresh()
    })
  }

  // KPIs
  const totalAutorizadas = emissions.filter(e => e.status === 'authorized').length
  const totalProcessando = emissions.filter(e => e.status === 'processing').length
  const totalRejeitadas  = emissions.filter(e => e.status === 'rejected').length
  const valorAutorizado  = emissions
    .filter(e => e.status === 'authorized')
    .reduce((s, e) => s + e.totalCents, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <FileText className="h-6 w-6" style={{ color: '#3B82F6' }} />
          Notas Fiscais
        </h1>
        <p className="page-subtitle">
          Histórico de emissões NFC-e, NF-e e NFS-e. Status atualizado em tempo real.
        </p>
      </div>

      {!configEnabled && (
        <div className="rounded-xl border p-4 flex items-start gap-3"
          style={{ background: 'rgba(251,191,36,.06)', borderColor: 'rgba(251,191,36,.3)' }}>
          <AlertCircle className="h-5 w-5 shrink-0" style={{ color: '#FBBF24' }} />
          <div className="flex-1">
            <p className="text-sm font-bold" style={{ color: '#FBBF24' }}>Emissão fiscal não habilitada</p>
            <p className="text-xs mt-0.5" style={{ color: '#CBD5E1' }}>
              Você precisa configurar regime tributário, certificado A1 e habilitar emissões antes de emitir notas.
            </p>
            <Link href="/configuracoes/fiscal"
              className="inline-flex items-center gap-1 mt-2 text-xs font-bold underline"
              style={{ color: '#FBBF24' }}>
              <Settings className="h-3 w-3" /> Configurar agora
            </Link>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="Autorizadas" value={String(totalAutorizadas)} color="#22C55E" />
        <KPI label="Processando" value={String(totalProcessando)} color="#FBBF24" />
        <KPI label="Rejeitadas" value={String(totalRejeitadas)} color="#F87171" />
        <KPI label="Valor autorizado" value={BRL(valorAutorizado)} color="#3B82F6" />
      </div>

      {/* Filtros */}
      <div className="rounded-xl border p-4 grid grid-cols-1 sm:grid-cols-2 gap-3"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#94A3B8' }}>
            Status
          </label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="auth-input">
            <option value="all">Todos</option>
            <option value="authorized">Autorizadas</option>
            <option value="processing">Processando</option>
            <option value="rejected">Rejeitadas</option>
            <option value="cancelled">Canceladas</option>
            <option value="inutilizada">Inutilizadas</option>
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#94A3B8' }}>
            Tipo
          </label>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="auth-input">
            <option value="all">Todos</option>
            <option value="nfce">NFC-e</option>
            <option value="nfe">NF-e</option>
            <option value="nfse">NFS-e</option>
          </select>
        </div>
      </div>

      {/* Tabela */}
      <div className="rounded-xl border overflow-hidden"
        style={{ background: '#131C2A', borderColor: '#2A3650' }}>
        <div className="border-b px-4 py-3" style={{ borderColor: '#2A3650' }}>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#94A3B8' }}>
            {filtered.length} {filtered.length === 1 ? 'emissão' : 'emissões'}
          </p>
        </div>

        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <FileText className="mx-auto h-8 w-8 mb-3" style={{ color: '#64748B' }} />
            <p className="text-sm" style={{ color: '#94A3B8' }}>
              {emissions.length === 0
                ? 'Nenhuma emissão ainda. Vá em /financeiro pra emitir a primeira nota.'
                : 'Nenhuma emissão encontrada com esses filtros.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead style={{ background: '#1B2638' }}>
                <tr>
                  <Th>Tipo</Th>
                  <Th>Número</Th>
                  <Th>Status</Th>
                  <Th>Destinatário</Th>
                  <Th align="right">Valor</Th>
                  <Th>Ambiente</Th>
                  <Th>Emitida</Th>
                  <Th align="right">Ações</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr key={e.id} className="border-t hover:bg-white/[0.02] transition-colors"
                    style={{ borderColor: '#2A3650' }}>
                    <Td bold>{TYPE_LABEL[e.type] ?? e.type}</Td>
                    <Td mono>{e.numero ? `${e.numero}/${e.serie}` : '—'}</Td>
                    <Td>
                      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold"
                        style={{
                          background: `${STATUS_COLOR[e.status] ?? '#94A3B8'}18`,
                          color: STATUS_COLOR[e.status] ?? '#94A3B8',
                        }}>
                        <StatusIcon status={e.status} />
                        {STATUS_LABEL[e.status] ?? e.status}
                      </span>
                    </Td>
                    <Td>
                      {e.destinatarioNome ?? <span className="italic" style={{ color: '#64748B' }}>Consumidor</span>}
                    </Td>
                    <Td align="right" mono>{BRL(e.totalCents)}</Td>
                    <Td>
                      <span className="text-[10px] font-bold uppercase"
                        style={{ color: e.ambiente === 'producao' ? '#F87171' : '#94A3B8' }}>
                        {e.ambiente === 'producao' ? 'Prod' : 'Hom'}
                      </span>
                    </Td>
                    <Td>{fmtDate(e.emittedAt ?? e.createdAt)}</Td>
                    <Td align="right">
                      <div className="flex items-center justify-end gap-1">
                        {(e.status === 'authorized' || e.status === 'cancelled') && (
                          <>
                            <a
                              href={`/api/fiscal/danfe/${e.id}`}
                              target="_blank" rel="noopener noreferrer"
                              title="Baixar DANFE PDF"
                              className="flex h-7 w-7 items-center justify-center rounded-lg border transition-colors hover:bg-white/5"
                              style={{ borderColor: '#2A3650', color: '#3B82F6' }}>
                              <Download className="h-3 w-3" />
                            </a>
                            <a
                              href={`/api/fiscal/xml/${e.id}`}
                              target="_blank" rel="noopener noreferrer"
                              title="Baixar XML"
                              className="flex h-7 w-7 items-center justify-center rounded-lg border transition-colors hover:bg-white/5"
                              style={{ borderColor: '#2A3650', color: '#94A3B8' }}>
                              <Code className="h-3 w-3" />
                            </a>
                          </>
                        )}
                        {e.status === 'processing' && (
                          <button
                            type="button"
                            onClick={() => handleRefresh(e.id)}
                            disabled={refreshing}
                            title="Atualizar status"
                            className="flex h-7 w-7 items-center justify-center rounded-lg border transition-colors hover:bg-white/5"
                            style={{ borderColor: '#2A3650', color: '#FBBF24' }}>
                            {refreshing
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : <RefreshCw className="h-3 w-3" />}
                          </button>
                        )}
                        {e.status === 'authorized' && e.chaveAcesso && (
                          <button
                            type="button"
                            onClick={() => setCancelling({ emission: e, reason: '' })}
                            title="Cancelar nota"
                            className="flex h-7 w-7 items-center justify-center rounded-lg border transition-colors hover:bg-white/5"
                            style={{ borderColor: '#2A3650', color: '#F87171' }}>
                            <X className="h-3 w-3" />
                          </button>
                        )}
                        {e.rejectionMessage && (
                          <button
                            type="button"
                            onClick={() => alert(`Erro: ${e.rejectionMessage}`)}
                            title="Ver erro"
                            className="flex h-7 w-7 items-center justify-center rounded-lg border transition-colors hover:bg-white/5"
                            style={{ borderColor: '#2A3650', color: '#F87171' }}>
                            <Eye className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal cancelar */}
      {cancelling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.75)' }}
          onClick={() => setCancelling(null)}>
          <div className="w-full max-w-md rounded-2xl border p-6"
            style={{ background: '#131C2A', borderColor: '#2A3650' }}
            onClick={ev => ev.stopPropagation()}>
            <h2 className="text-lg font-bold mb-3" style={{ color: '#FFFFFF' }}>
              Cancelar nota fiscal
            </h2>
            <p className="text-xs mb-4" style={{ color: '#CBD5E1' }}>
              Você só pode cancelar nota até <strong>30 minutos</strong> após autorização (regra SEFAZ).
              Justifique com pelo menos 15 caracteres.
            </p>
            <textarea
              value={cancelling.reason}
              onChange={ev => setCancelling({ ...cancelling, reason: ev.target.value })}
              placeholder="Ex: Pedido cancelado pelo cliente após emissão"
              rows={3}
              className="auth-input"
              style={{ resize: 'none' }} />
            <p className="text-[10px] mt-1" style={{ color: '#94A3B8' }}>
              {cancelling.reason.trim().length}/15 caracteres mínimos
            </p>

            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => setCancelling(null)}
                disabled={cancelPending}
                className="auth-btn-secondary flex-1">
                Voltar
              </button>
              <button
                type="button"
                onClick={handleCancelSubmit}
                disabled={cancelPending || cancelling.reason.trim().length < 15}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold disabled:opacity-50"
                style={{ background: '#F87171', color: 'white' }}>
                {cancelPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                Confirmar cancelamento
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function KPI({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border p-4 relative overflow-hidden"
      style={{
        background: '#FFFFFF',
        borderTop: `3px solid ${color}`,
        boxShadow: '0 4px 12px rgba(0,0,0,.25)',
      }}>
      <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#64748B' }}>
        {label}
      </p>
      <p className="text-lg font-bold tracking-tight" style={{ color: '#0B1220' }}>{value}</p>
    </div>
  )
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'authorized') return <CheckCircle2 className="h-3 w-3" />
  if (status === 'processing') return <Clock className="h-3 w-3" />
  if (status === 'rejected')   return <XCircle className="h-3 w-3" />
  if (status === 'cancelled')  return <X className="h-3 w-3" />
  return null
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}
      style={{ color: '#94A3B8' }}>
      {children}
    </th>
  )
}

function Td({ children, align = 'left', mono, bold }: {
  children: React.ReactNode
  align?: 'left' | 'right'
  mono?: boolean
  bold?: boolean
}) {
  return (
    <td className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'} ${mono ? 'font-mono' : ''} ${bold ? 'font-bold' : ''}`}
      style={{ color: '#FFFFFF' }}>
      {children}
    </td>
  )
}
