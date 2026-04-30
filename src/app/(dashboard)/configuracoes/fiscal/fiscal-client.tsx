'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, FileText, Upload, Check, AlertCircle, Loader2,
  ShieldCheck, AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  saveFiscalConfig, uploadFiscalCertificate, enableFiscalEmission,
  type FiscalConfig,
} from '@/actions/fiscal'

type Props = {
  initial: FiscalConfig | null
}

const REGIMES: { v: FiscalConfig['regime']; label: string }[] = [
  { v: 'simples_nacional',  label: 'Simples Nacional' },
  { v: 'simples_excesso',   label: 'Simples Nacional (excesso de sublimite)' },
  { v: 'normal',            label: 'Regime Normal' },
  { v: 'lucro_presumido',   label: 'Lucro Presumido' },
  { v: 'lucro_real',        label: 'Lucro Real' },
]

const UF_LIST = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']

export function FiscalClient({ initial }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  // Estado do formulário (controlado, com defaults sensatos)
  const [regime, setRegime]                           = useState<FiscalConfig['regime']>(initial?.regime ?? 'simples_nacional')
  const [inscricaoEstadual, setInscricaoEstadual]     = useState(initial?.inscricaoEstadual ?? '')
  const [ieIsenta, setIeIsenta]                       = useState(initial?.ieIsenta ?? false)
  const [inscricaoMunicipal, setInscricaoMunicipal]   = useState(initial?.inscricaoMunicipal ?? '')
  const [cnae, setCnae]                               = useState(initial?.cnae ?? '')
  const [cscId, setCscId]                             = useState(initial?.cscId ?? '')
  const [cscToken, setCscToken]                       = useState(initial?.cscToken ?? '')
  const [ambiente, setAmbiente]                       = useState<FiscalConfig['ambiente']>(initial?.ambiente ?? 'homologacao')
  const [cfopPadrao, setCfopPadrao]                   = useState(initial?.cfopPadrao ?? '5102')
  const [cstCsosnPadrao, setCstCsosnPadrao]           = useState(initial?.cstCsosnPadrao ?? '102')
  const [emissionMode, setEmissionMode]               = useState<FiscalConfig['emissionMode']>(initial?.emissionMode ?? 'manual')

  const [endLogradouro, setEndLogradouro]   = useState(initial?.enderecoLogradouro ?? '')
  const [endNumero, setEndNumero]           = useState(initial?.enderecoNumero ?? '')
  const [endComplemento, setEndComplemento] = useState(initial?.enderecoComplemento ?? '')
  const [endBairro, setEndBairro]           = useState(initial?.enderecoBairro ?? '')
  const [endCidade, setEndCidade]           = useState(initial?.enderecoCidade ?? '')
  const [endUf, setEndUf]                   = useState(initial?.enderecoUf ?? 'SE')
  const [endCep, setEndCep]                 = useState(initial?.enderecoCep ?? '')
  const [endCodMun, setEndCodMun]           = useState(initial?.enderecoCodigoMunicipio ?? '')

  // Certificado
  const [certPassword, setCertPassword]       = useState('')
  const [showCertPassword, setShowCertPassword] = useState(false)
  const [certUploading, setCertUploading]     = useState(false)
  const hasCertificate = !!initial?.certificatePath

  const enabled = !!initial?.enabled

  function handleSave() {
    startTransition(async () => {
      const res = await saveFiscalConfig({
        regime,
        inscricao_estadual:  inscricaoEstadual,
        ie_isenta:           ieIsenta,
        inscricao_municipal: inscricaoMunicipal,
        cnae,
        csc_id:              cscId,
        csc_token:           cscToken,
        ambiente,
        cfop_padrao:         cfopPadrao,
        cst_csosn_padrao:    cstCsosnPadrao,
        emission_mode:       emissionMode,
        endereco_logradouro: endLogradouro,
        endereco_numero:     endNumero,
        endereco_complemento: endComplemento,
        endereco_bairro:     endBairro,
        endereco_cidade:     endCidade,
        endereco_uf:         endUf,
        endereco_cep:        endCep,
        endereco_codigo_municipio: endCodMun,
      })
      if (!res.ok) { toast.error(res.error); return }
      toast.success('Configuração salva.')
      router.refresh()
    })
  }

  async function handleCertificateUpload(file: File) {
    if (!certPassword) {
      toast.error('Informe a senha do certificado primeiro.')
      return
    }
    if (!file.name.endsWith('.pfx') && !file.name.endsWith('.p12')) {
      toast.error('Envie arquivo .pfx ou .p12.')
      return
    }

    setCertUploading(true)
    try {
      const buffer = await file.arrayBuffer()
      const fileBase64 = Buffer.from(buffer).toString('base64')
      const res = await uploadFiscalCertificate({
        fileBase64,
        filename: file.name,
        password: certPassword,
      })
      if (!res.ok) { toast.error(res.error); return }
      toast.success('Certificado carregado!')
      setCertPassword('')
      router.refresh()
    } finally {
      setCertUploading(false)
    }
  }

  function handleEnable() {
    if (!confirm('Ao habilitar, o sistema cadastra sua empresa na Focus NFe e sobe o certificado. Continuar?')) return
    startTransition(async () => {
      const res = await enableFiscalEmission()
      if (!res.ok) { toast.error(res.error); return }
      toast.success('Emissão fiscal habilitada!')
      router.refresh()
    })
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <Link href="/configuracoes" className="inline-flex items-center gap-1.5 text-xs hover:underline mb-2"
          style={{ color: '#94A3B8' }}>
          <ArrowLeft className="h-3.5 w-3.5" /> Voltar pra Configurações
        </Link>
        <h1 className="page-title flex items-center gap-2">
          <FileText className="h-6 w-6" style={{ color: '#22C55E' }} />
          Configuração Fiscal
        </h1>
        <p className="page-subtitle">
          Configure regime tributário, certificado A1 e endereço fiscal pra emitir NF-e, NFC-e e NFS-e.
        </p>
      </div>

      {/* Status banner */}
      {enabled ? (
        <div className="rounded-xl border p-4 flex items-start gap-3"
          style={{ background: 'rgba(34,197,94,.08)', borderColor: 'rgba(34,197,94,.3)' }}>
          <ShieldCheck className="h-5 w-5 shrink-0" style={{ color: '#22C55E' }} />
          <div>
            <p className="text-sm font-bold" style={{ color: '#22C55E' }}>Emissão fiscal habilitada</p>
            <p className="text-xs mt-0.5" style={{ color: '#CBD5E1' }}>
              Ambiente: <strong>{ambiente === 'homologacao' ? 'HOMOLOGAÇÃO (testes)' : 'PRODUÇÃO (notas reais)'}</strong>
              {' · '}Modo: {emissionMode === 'manual' ? 'Manual' : emissionMode === 'automatic' ? 'Automático' : 'Lote (fim do dia)'}
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border p-4 flex items-start gap-3"
          style={{ background: 'rgba(251,191,36,.06)', borderColor: 'rgba(251,191,36,.3)' }}>
          <AlertTriangle className="h-5 w-5 shrink-0" style={{ color: '#FBBF24' }} />
          <div>
            <p className="text-sm font-bold" style={{ color: '#FBBF24' }}>Emissão fiscal desabilitada</p>
            <p className="text-xs mt-0.5" style={{ color: '#CBD5E1' }}>
              Preencha os dados abaixo, suba o certificado A1 e clique em &ldquo;Habilitar emissões&rdquo; pra começar a emitir.
            </p>
          </div>
        </div>
      )}

      {/* Bloco 1: Regime + Inscrições */}
      <Section title="Regime tributário e inscrições">
        <Field label="Regime tributário" required>
          <select value={regime} onChange={e => setRegime(e.target.value as FiscalConfig['regime'])}
            className="auth-input">
            {REGIMES.map(r => <option key={r.v} value={r.v}>{r.label}</option>)}
          </select>
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Inscrição Estadual">
            <input value={inscricaoEstadual} onChange={e => setInscricaoEstadual(e.target.value)}
              disabled={ieIsenta}
              placeholder={ieIsenta ? 'ISENTO' : 'Apenas dígitos'}
              className="auth-input" />
            <label className="flex items-center gap-2 mt-2 text-xs" style={{ color: '#CBD5E1' }}>
              <input type="checkbox" checked={ieIsenta} onChange={e => setIeIsenta(e.target.checked)} />
              IE isenta (não tem IE estadual)
            </label>
          </Field>

          <Field label="Inscrição Municipal">
            <input value={inscricaoMunicipal} onChange={e => setInscricaoMunicipal(e.target.value)}
              placeholder="Opcional (necessário pra NFS-e)"
              className="auth-input" />
          </Field>
        </div>

        <Field label="CNAE principal">
          <input value={cnae} onChange={e => setCnae(e.target.value)}
            placeholder="Ex: 4789-0/99"
            className="auth-input" />
        </Field>
      </Section>

      {/* Bloco 2: Endereço fiscal */}
      <Section title="Endereço fiscal">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <Field label="Logradouro" required>
              <input value={endLogradouro} onChange={e => setEndLogradouro(e.target.value)}
                placeholder="Ex: Rua das Flores" className="auth-input" />
            </Field>
          </div>
          <Field label="Número" required>
            <input value={endNumero} onChange={e => setEndNumero(e.target.value)}
              placeholder="123" className="auth-input" />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Complemento">
            <input value={endComplemento} onChange={e => setEndComplemento(e.target.value)}
              placeholder="Sala, andar, etc" className="auth-input" />
          </Field>
          <Field label="Bairro" required>
            <input value={endBairro} onChange={e => setEndBairro(e.target.value)}
              className="auth-input" />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <Field label="Cidade" required>
              <input value={endCidade} onChange={e => setEndCidade(e.target.value)}
                className="auth-input" />
            </Field>
          </div>
          <Field label="UF" required>
            <select value={endUf} onChange={e => setEndUf(e.target.value)} className="auth-input">
              {UF_LIST.map(uf => <option key={uf} value={uf}>{uf}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="CEP" required>
            <input value={endCep} onChange={e => setEndCep(e.target.value)}
              placeholder="49000-000" className="auth-input" />
          </Field>
          <Field label="Código IBGE do município">
            <input value={endCodMun} onChange={e => setEndCodMun(e.target.value)}
              placeholder="7 dígitos (ex: 2800308 = Aracaju/SE)" className="auth-input" />
          </Field>
        </div>
      </Section>

      {/* Bloco 3: CSC + Defaults */}
      <Section title="CSC (NFC-e) e defaults">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="ID do CSC" hint="Conseguido no portal SEFAZ">
            <input value={cscId} onChange={e => setCscId(e.target.value)}
              placeholder="Ex: 1" className="auth-input" />
          </Field>
          <Field label="Token CSC" hint="Código de segurança do contribuinte (sigiloso)">
            <input value={cscToken} onChange={e => setCscToken(e.target.value)}
              type="password" placeholder="••••••••" className="auth-input" />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="CFOP padrão" hint="5102 = venda merc. dentro do estado">
            <input value={cfopPadrao} onChange={e => setCfopPadrao(e.target.value)}
              maxLength={4} className="auth-input" />
          </Field>
          <Field label="CST/CSOSN padrão" hint="102 = Simples Nacional sem permissão de crédito">
            <input value={cstCsosnPadrao} onChange={e => setCstCsosnPadrao(e.target.value)}
              maxLength={4} className="auth-input" />
          </Field>
        </div>
      </Section>

      {/* Bloco 4: Modo de emissão + ambiente */}
      <Section title="Modo de emissão">
        <Field label="Quando emitir?" required>
          <div className="space-y-2">
            <RadioCard label="Manual" desc="Botão 'Emitir NFC-e' em cada venda — você decide" value="manual" current={emissionMode} onChange={setEmissionMode} />
            <RadioCard label="Automático" desc="Emite NFC-e automaticamente ao finalizar venda no POS" value="automatic" current={emissionMode} onChange={setEmissionMode} />
            <RadioCard label="Lote (fim do dia)" desc="Cron 22:00 emite todas as vendas do dia ainda não emitidas" value="batch" current={emissionMode} onChange={setEmissionMode} />
          </div>
        </Field>

        <Field label="Ambiente" required>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setAmbiente('homologacao')}
              className="rounded-lg border px-4 py-3 text-sm transition-all"
              style={ambiente === 'homologacao'
                ? { background: 'rgba(34,197,94,.15)', borderColor: '#22C55E', color: '#22C55E' }
                : { background: '#131C2A', borderColor: '#2A3650', color: '#CBD5E1' }
              }>
              <p className="font-bold">Homologação</p>
              <p className="text-[10px] mt-0.5" style={{ color: 'inherit', opacity: 0.7 }}>Testes — sem valor fiscal</p>
            </button>
            <button type="button" onClick={() => setAmbiente('producao')}
              className="rounded-lg border px-4 py-3 text-sm transition-all"
              style={ambiente === 'producao'
                ? { background: 'rgba(248,113,113,.15)', borderColor: '#F87171', color: '#F87171' }
                : { background: '#131C2A', borderColor: '#2A3650', color: '#CBD5E1' }
              }>
              <p className="font-bold">Produção</p>
              <p className="text-[10px] mt-0.5" style={{ color: 'inherit', opacity: 0.7 }}>Notas reais — valor fiscal</p>
            </button>
          </div>
          <p className="text-xs mt-2" style={{ color: '#94A3B8' }}>
            Comece em <strong>Homologação</strong> pra testar. Só mude pra Produção depois de validar.
          </p>
        </Field>
      </Section>

      {/* Bloco 5: Certificado A1 */}
      <Section title="Certificado Digital A1">
        {hasCertificate ? (
          <div className="rounded-lg border p-3 flex items-start gap-2.5"
            style={{ background: 'rgba(34,197,94,.06)', borderColor: 'rgba(34,197,94,.3)' }}>
            <Check className="h-4 w-4 shrink-0 mt-0.5" style={{ color: '#22C55E' }} />
            <div className="flex-1">
              <p className="text-sm font-bold" style={{ color: '#22C55E' }}>Certificado carregado</p>
              <p className="text-[11px] mt-0.5" style={{ color: '#CBD5E1' }}>
                {initial?.certificateExpiresAt
                  ? `Expira em ${new Date(initial.certificateExpiresAt).toLocaleDateString('pt-BR')}`
                  : 'Para substituir, suba um novo arquivo abaixo.'}
              </p>
            </div>
          </div>
        ) : null}

        <Field label="Senha do certificado" required>
          <input value={certPassword} onChange={e => setCertPassword(e.target.value)}
            type={showCertPassword ? 'text' : 'password'}
            placeholder="••••••••"
            className="auth-input" />
          <label className="flex items-center gap-2 mt-2 text-xs" style={{ color: '#CBD5E1' }}>
            <input type="checkbox" checked={showCertPassword} onChange={e => setShowCertPassword(e.target.checked)} />
            Mostrar senha
          </label>
        </Field>

        <Field label="Arquivo do certificado (.pfx ou .p12)" required>
          <label className="flex items-center justify-center gap-2 rounded-lg border border-dashed cursor-pointer hover:bg-white/[0.03] transition-colors p-6"
            style={{ borderColor: '#2A3650' }}>
            {certUploading
              ? <Loader2 className="h-5 w-5 animate-spin" style={{ color: '#22C55E' }} />
              : <Upload className="h-5 w-5" style={{ color: '#94A3B8' }} />
            }
            <span className="text-sm" style={{ color: '#CBD5E1' }}>
              {certUploading ? 'Enviando...' : 'Clique pra selecionar o .pfx'}
            </span>
            <input type="file" accept=".pfx,.p12" className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) handleCertificateUpload(file)
                e.target.value = ''
              }}
              disabled={certUploading || !certPassword} />
          </label>
          <p className="text-[10px] mt-1" style={{ color: '#94A3B8' }}>
            Arquivo e senha são criptografados e armazenados em storage privado. Apenas o servidor lê.
          </p>
        </Field>
      </Section>

      {/* Footer: salvar + habilitar */}
      <div className="flex items-center justify-between gap-3 pt-4 border-t" style={{ borderColor: '#2A3650' }}>
        <button type="button" onClick={handleSave} disabled={pending}
          className="auth-btn-secondary"
          style={{ flex: '0 0 auto', padding: '0.7rem 1.5rem' }}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Salvar configuração
        </button>

        {!enabled && (
          <button type="button" onClick={handleEnable} disabled={pending || !hasCertificate}
            className="auth-btn-primary"
            style={{ flex: '0 0 auto', margin: 0, padding: '0.7rem 1.5rem' }}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Habilitar emissões
          </button>
        )}
      </div>

      {!hasCertificate && (
        <p className="text-xs flex items-center gap-1.5" style={{ color: '#94A3B8' }}>
          <AlertCircle className="h-3.5 w-3.5" />
          Suba o certificado A1 antes de habilitar emissões.
        </p>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers de UI
// ──────────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="app-card p-5 space-y-4">
      <h2 className="text-sm font-bold uppercase tracking-widest" style={{ color: '#94A3B8' }}>
        {title}
      </h2>
      {children}
    </div>
  )
}

function Field({ label, hint, required, children }: {
  label: string; hint?: string; required?: boolean; children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium uppercase tracking-wider flex items-center gap-1"
        style={{ color: '#94A3B8' }}>
        {label}
        {required && <span style={{ color: '#F87171' }}>*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px]" style={{ color: '#94A3B8' }}>{hint}</p>}
    </div>
  )
}

function RadioCard({ label, desc, value, current, onChange }: {
  label: string; desc: string
  value: FiscalConfig['emissionMode']; current: FiscalConfig['emissionMode']
  onChange: (v: FiscalConfig['emissionMode']) => void
}) {
  const active = current === value
  return (
    <button type="button" onClick={() => onChange(value)}
      className="w-full text-left rounded-lg border p-3 transition-all"
      style={active
        ? { background: 'rgba(34,197,94,.08)', borderColor: '#22C55E' }
        : { background: '#131C2A', borderColor: '#2A3650' }
      }>
      <div className="flex items-center gap-2.5">
        <div className="h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0"
          style={{ borderColor: active ? '#22C55E' : '#94A3B8' }}>
          {active && <div className="h-2 w-2 rounded-full" style={{ background: '#22C55E' }} />}
        </div>
        <div>
          <p className="text-sm font-semibold" style={{ color: '#FFFFFF' }}>{label}</p>
          <p className="text-[11px] mt-0.5" style={{ color: '#CBD5E1' }}>{desc}</p>
        </div>
      </div>
    </button>
  )
}
