import 'server-only'

/**
 * Wrapper minimalista da API Focus NFe (v2).
 *
 * Doc oficial: https://focusnfe.com.br/doc/
 *
 * Auth: Basic Auth com token como username + senha vazia.
 * Ambiente: definido por query param `?ambiente=homologacao|producao` ou
 * por header em algumas rotas (depende do endpoint).
 *
 * Cobre: cadastro de empresa, upload de certificado, emissão NFC-e/NF-e/NFS-e,
 * consulta de status, cancelamento, inutilização.
 */

const FOCUS_BASE = process.env.FOCUS_NFE_BASE_URL || 'https://api.focusnfe.com.br'
const FOCUS_TOKEN = process.env.FOCUS_NFE_TOKEN

if (!FOCUS_TOKEN && process.env.NODE_ENV === 'production') {
  // eslint-disable-next-line no-console
  console.warn('[focus-nfe] FOCUS_NFE_TOKEN não configurado. Emissões fiscais vão falhar.')
}

export type Ambiente = 'homologacao' | 'producao'

type RequestOptions = {
  method?:  'GET' | 'POST' | 'PUT' | 'DELETE'
  body?:    unknown
  query?:   Record<string, string | undefined>
  headers?: Record<string, string>
}

/**
 * Erro estruturado retornado pela API Focus.
 * Doc: https://focusnfe.com.br/doc/#erros
 */
export class FocusNfeError extends Error {
  constructor(
    public status:  number,
    public code:    string | null,
    public payload: unknown,
    message:        string,
  ) {
    super(message)
    this.name = 'FocusNfeError'
  }
}

async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  if (!FOCUS_TOKEN) {
    throw new FocusNfeError(500, 'NO_TOKEN', null, 'FOCUS_NFE_TOKEN não configurado no servidor.')
  }

  const url = new URL(path, FOCUS_BASE)
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, v)
    }
  }

  // Focus usa Basic Auth com token como user, senha vazia
  const authHeader = 'Basic ' + Buffer.from(`${FOCUS_TOKEN}:`).toString('base64')

  const res = await fetch(url.toString(), {
    method:  opts.method ?? 'GET',
    headers: {
      'Authorization': authHeader,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      ...(opts.headers ?? {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  })

  const text = await res.text()
  let payload: unknown = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = text }

  if (!res.ok) {
    const errMsg =
      typeof payload === 'object' && payload !== null && 'mensagem' in payload
        ? String((payload as { mensagem: unknown }).mensagem)
        : `HTTP ${res.status}`
    const code =
      typeof payload === 'object' && payload !== null && 'codigo' in payload
        ? String((payload as { codigo: unknown }).codigo)
        : null
    throw new FocusNfeError(res.status, code, payload, errMsg)
  }

  return payload as T
}

// ──────────────────────────────────────────────────────────────────────────
// Empresas — cada CNPJ que vai emitir nota precisa ser cadastrado primeiro
// ──────────────────────────────────────────────────────────────────────────

export type FocusEmpresaInput = {
  nome:                   string
  nome_fantasia?:         string
  cnpj:                   string                // só dígitos
  inscricao_estadual?:    string                // só dígitos ou 'ISENTO'
  inscricao_municipal?:   string
  regime_tributario:      number                // 1=Simples Nacional, 2=Simples Excesso, 3=Normal
  regime_tributario_especial?: number
  email:                  string
  telefone?:              string
  // Endereço
  logradouro:             string
  numero:                 string
  complemento?:           string
  bairro:                 string
  municipio:              string
  uf:                     string                // 2 letras
  cep:                    string                // só dígitos
  // Habilitar emissões (focus controla por flag)
  habilita_nfe?:          boolean
  habilita_nfce?:         boolean
  habilita_nfse?:         boolean
  // CSC pra NFC-e (homologação tem default no Focus, produção precisa do CSC real do SEFAZ)
  csc?:                   string
  csc_id?:                string
}

export type FocusEmpresa = FocusEmpresaInput & {
  token_empresa?: string
}

export async function createEmpresa(input: FocusEmpresaInput): Promise<FocusEmpresa> {
  return request<FocusEmpresa>('/v2/empresas', {
    method: 'POST',
    body:   input,
  })
}

export async function updateEmpresa(cnpj: string, input: Partial<FocusEmpresaInput>): Promise<FocusEmpresa> {
  return request<FocusEmpresa>(`/v2/empresas/${cnpj}`, {
    method: 'PUT',
    body:   input,
  })
}

export async function getEmpresa(cnpj: string): Promise<FocusEmpresa | null> {
  try {
    return await request<FocusEmpresa>(`/v2/empresas/${cnpj}`)
  } catch (e) {
    if (e instanceof FocusNfeError && e.status === 404) return null
    throw e
  }
}

/**
 * Sobe certificado A1 (.pfx) pra empresa cadastrada na Focus.
 * O .pfx precisa ser enviado em base64.
 */
export async function uploadCertificado(
  cnpj:       string,
  pfxBase64:  string,
  password:   string,
): Promise<{ certificado_uploaded: boolean }> {
  return request(`/v2/empresas/${cnpj}/certificado`, {
    method: 'POST',
    body: {
      arquivo: pfxBase64,
      senha:   password,
    },
  })
}

// ──────────────────────────────────────────────────────────────────────────
// Emissão de NFC-e (varejo balcão)
// ──────────────────────────────────────────────────────────────────────────

export type FocusNfceItem = {
  numero_item:                  number
  codigo_produto:               string
  descricao:                    string
  cfop:                         string
  unidade_comercial:            string
  quantidade_comercial:         number
  valor_unitario_comercial:     number
  valor_bruto:                  number
  unidade_tributavel:           string
  quantidade_tributavel:        number
  valor_unitario_tributario:    number
  ncm:                          string
  origem_mercadoria?:           string
  // Tributos (depende do regime)
  icms_situacao_tributaria?:    string  // CSOSN pra Simples Nacional ou CST pra Normal
  icms_origem?:                 string
  pis_situacao_tributaria?:     string
  cofins_situacao_tributaria?:  string
}

export type FocusNfceInput = {
  cnpj_emitente:                string                 // só dígitos
  natureza_operacao:            string                 // ex: "Venda de mercadoria"
  data_emissao:                 string                 // ISO 8601
  presenca_comprador:           number                 // 1=presencial, 4=tele-atendimento
  modalidade_frete:             number                 // 9=sem frete (NFC-e padrão)
  local_destino:                number                 // 1=interna
  // Destinatário (consumidor final pode ser CPF)
  nome_destinatario?:           string
  cpf_destinatario?:            string                 // só dígitos
  cnpj_destinatario?:           string
  // Pagamentos
  formas_pagamento:             { forma_pagamento: string; valor_pagamento: number }[]
  items:                        FocusNfceItem[]
  // Valor total (calculado)
  valor_produtos:               number
  valor_total:                  number
}

/**
 * Emite NFC-e. `ref` é o identificador único nosso (idempotente).
 * Focus retorna 202 com status 'processando' inicialmente — depois temos que
 * consultar (`getEmissao`) ou receber via webhook.
 */
export async function emitirNfce(
  ref:        string,
  input:      FocusNfceInput,
  ambiente:   Ambiente,
): Promise<{ status: string; ref: string }> {
  return request(`/v2/nfce`, {
    method: 'POST',
    query:  { ref, ambiente },
    body:   input,
  })
}

// ──────────────────────────────────────────────────────────────────────────
// Consulta / cancelamento (genéricos pra NFC-e, NF-e e NFS-e)
// ──────────────────────────────────────────────────────────────────────────

export type EmissaoTipo = 'nfce' | 'nfe' | 'nfse'

export type FocusEmissaoStatus =
  | 'processando_autorizacao'
  | 'autorizado'
  | 'cancelado'
  | 'erro_autorizacao'
  | 'denegado'
  | 'inutilizado'

export type FocusEmissaoResponse = {
  status:           FocusEmissaoStatus
  ref:              string
  mensagem_sefaz?:  string
  status_sefaz?:    string
  numero?:          number
  serie?:           number
  chave_nfe?:       string         // 44 dígitos (NFe/NFCe)
  caminho_xml_nota_fiscal?:        string
  caminho_danfe?:                  string
  protocolo?:       string
  // Erros
  codigo_status?:   number
  mensagem_status?: string
}

export async function getEmissao(
  tipo:       EmissaoTipo,
  ref:        string,
  ambiente:   Ambiente,
): Promise<FocusEmissaoResponse> {
  return request<FocusEmissaoResponse>(`/v2/${tipo}/${ref}`, {
    query: { ambiente },
  })
}

/**
 * Cancela emissão. Só permitido até 30min após autorização (NFC-e/NF-e).
 * Pra NFS-e o prazo varia por município.
 */
export async function cancelarEmissao(
  tipo:       EmissaoTipo,
  ref:        string,
  ambiente:   Ambiente,
  justificativa: string,
): Promise<{ status: string }> {
  return request(`/v2/${tipo}/${ref}`, {
    method: 'DELETE',
    query:  { ambiente },
    body:   { justificativa },
  })
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Mapeia regime do nosso schema (string) pro código numérico do Focus.
 * 1 = Simples Nacional
 * 2 = Simples Nacional, excesso de sublimite de receita bruta
 * 3 = Regime Normal (Lucro Presumido / Real)
 */
export function mapRegimeToFocus(regime: string): number {
  switch (regime) {
    case 'simples_nacional':  return 1
    case 'simples_excesso':   return 2
    case 'normal':
    case 'lucro_presumido':
    case 'lucro_real':        return 3
    default:                  return 1
  }
}
