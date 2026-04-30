'use server'

/**
 * Server Actions do módulo fiscal — configuração, upload de certificado,
 * emissão (futuro) de NF-e/NFC-e/NFS-e via Focus NFe.
 *
 * Apenas owner pode configurar fiscal (mexe em valor sensível: certificado,
 * CSC, regime tributário). Manager/employee podem emitir notas se permission
 * `fiscal_emit` estiver liberada (futuro).
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAuth } from '@/lib/supabase/server'
import { getTenantId } from '@/lib/tenant'
import {
  createEmpresa, updateEmpresa, getEmpresa as getFocusEmpresa,
  uploadCertificado, mapRegimeToFocus, FocusNfeError,
} from '@/lib/focus-nfe'

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string }

// ──────────────────────────────────────────────────────────────────────────
// Tipos compartilhados
// ──────────────────────────────────────────────────────────────────────────

export type FiscalConfig = {
  tenantId:                string
  regime:                  'simples_nacional' | 'simples_excesso' | 'normal' | 'lucro_presumido' | 'lucro_real'
  inscricaoEstadual:       string | null
  ieIsenta:                boolean
  inscricaoMunicipal:      string | null
  cnae:                    string | null
  cscId:                   string | null
  cscToken:                string | null
  certificatePath:         string | null
  certificateExpiresAt:    string | null
  ambiente:                'homologacao' | 'producao'
  cfopPadrao:              string
  cstCsosnPadrao:          string
  emissionMode:            'manual' | 'automatic' | 'batch'
  enderecoLogradouro:      string | null
  enderecoNumero:          string | null
  enderecoComplemento:     string | null
  enderecoBairro:          string | null
  enderecoCidade:          string | null
  enderecoUf:              string | null
  enderecoCep:             string | null
  enderecoCodigoMunicipio: string | null
  monthlyQuota:            number
  enabled:                 boolean
}

// ──────────────────────────────────────────────────────────────────────────
// Schema de validação (server-side, sempre obrigatório)
// ──────────────────────────────────────────────────────────────────────────

const ConfigSchema = z.object({
  regime: z.enum(['simples_nacional', 'simples_excesso', 'normal', 'lucro_presumido', 'lucro_real']),
  inscricao_estadual:  z.string().optional().nullable(),
  ie_isenta:           z.boolean().default(false),
  inscricao_municipal: z.string().optional().nullable(),
  cnae:                z.string().optional().nullable(),
  csc_id:              z.string().optional().nullable(),
  csc_token:           z.string().optional().nullable(),
  ambiente:            z.enum(['homologacao', 'producao']).default('homologacao'),
  cfop_padrao:         z.string().min(4).max(4),
  cst_csosn_padrao:    z.string().min(2).max(4),
  emission_mode:       z.enum(['manual', 'automatic', 'batch']).default('manual'),
  endereco_logradouro: z.string().optional().nullable(),
  endereco_numero:     z.string().optional().nullable(),
  endereco_complemento: z.string().optional().nullable(),
  endereco_bairro:     z.string().optional().nullable(),
  endereco_cidade:     z.string().optional().nullable(),
  endereco_uf:         z.string().length(2).optional().nullable(),
  endereco_cep:        z.string().optional().nullable(),
  endereco_codigo_municipio: z.string().optional().nullable(),
})

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isOwner(user: { app_metadata?: any }): boolean {
  return user.app_metadata?.tenant_role === 'owner'
}

function onlyDigits(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}

// ──────────────────────────────────────────────────────────────────────────
// Get
// ──────────────────────────────────────────────────────────────────────────

export async function getFiscalConfig(): Promise<FiscalConfig | null> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any
  const { data } = await sb
    .from('fiscal_configs')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!data) return null
  return mapRow(data)
}

// ──────────────────────────────────────────────────────────────────────────
// Save (upsert)
// ──────────────────────────────────────────────────────────────────────────

export async function saveFiscalConfig(input: unknown): Promise<Result<{ tenantId: string }>> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)
  if (!isOwner(user)) return { ok: false, error: 'Apenas o dono pode editar configuração fiscal.' }

  const parsed = ConfigSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: 'Dados inválidos. Confira os campos.' }
  }
  const v = parsed.data

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  // Upsert por tenant_id (PK)
  const { error } = await sb
    .from('fiscal_configs')
    .upsert({
      tenant_id:                tenantId,
      regime:                   v.regime,
      inscricao_estadual:       v.ie_isenta ? null : (onlyDigits(v.inscricao_estadual) || null),
      ie_isenta:                v.ie_isenta,
      inscricao_municipal:      v.inscricao_municipal || null,
      cnae:                     v.cnae || null,
      csc_id:                   v.csc_id || null,
      csc_token:                v.csc_token || null,
      ambiente:                 v.ambiente,
      cfop_padrao:              v.cfop_padrao,
      cst_csosn_padrao:         v.cst_csosn_padrao,
      emission_mode:            v.emission_mode,
      endereco_logradouro:      v.endereco_logradouro || null,
      endereco_numero:          v.endereco_numero || null,
      endereco_complemento:     v.endereco_complemento || null,
      endereco_bairro:          v.endereco_bairro || null,
      endereco_cidade:          v.endereco_cidade || null,
      endereco_uf:              v.endereco_uf || null,
      endereco_cep:             onlyDigits(v.endereco_cep) || null,
      endereco_codigo_municipio: v.endereco_codigo_municipio || null,
      updated_at:               new Date().toISOString(),
    }, { onConflict: 'tenant_id' })

  if (error) return { ok: false, error: `Erro ao salvar: ${error.message}` }

  revalidatePath('/configuracoes/fiscal')
  return { ok: true, data: { tenantId } }
}

// ──────────────────────────────────────────────────────────────────────────
// Upload do certificado A1 — sobe pro Storage privado e atualiza config
// ──────────────────────────────────────────────────────────────────────────

export async function uploadFiscalCertificate(input: {
  fileBase64:  string         // .pfx em base64 (sem prefixo data:)
  filename:    string
  password:    string
  expiresAt?:  string         // ISO date — opcional (lê do .pfx no futuro)
}): Promise<Result<{ path: string }>> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)
  if (!isOwner(user)) return { ok: false, error: 'Apenas o dono pode subir o certificado.' }

  if (!input.fileBase64) return { ok: false, error: 'Arquivo vazio.' }
  if (!input.password)   return { ok: false, error: 'Senha do certificado é obrigatória.' }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  // Decodifica base64 e sobe pro bucket privado
  const buffer = Buffer.from(input.fileBase64, 'base64')
  if (buffer.length === 0) return { ok: false, error: 'Arquivo inválido.' }
  if (buffer.length > 5 * 1024 * 1024) return { ok: false, error: 'Arquivo > 5MB. Confira.' }

  const path = `${tenantId}/cert.pfx`
  const { error: upErr } = await sb.storage
    .from('fiscal-certificates')
    .upload(path, buffer, {
      contentType:    'application/x-pkcs12',
      upsert:         true,
      cacheControl:   '0',
    })

  if (upErr) return { ok: false, error: `Erro ao subir certificado: ${upErr.message}` }

  // Atualiza config com path + senha (TODO: criptografar via pgsodium)
  const { error: updErr } = await sb
    .from('fiscal_configs')
    .update({
      certificate_path:       path,
      certificate_password:   input.password,
      certificate_expires_at: input.expiresAt ?? null,
      updated_at:             new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)

  if (updErr) return { ok: false, error: `Erro ao salvar config: ${updErr.message}` }

  revalidatePath('/configuracoes/fiscal')
  return { ok: true, data: { path } }
}

// ──────────────────────────────────────────────────────────────────────────
// Habilitar emissões — cadastra empresa na Focus + sobe certificado pra lá
// ──────────────────────────────────────────────────────────────────────────

export async function enableFiscalEmission(): Promise<Result<{ enabled: boolean }>> {
  const { user } = await requireAuth()
  const tenantId = getTenantId(user)
  if (!isOwner(user)) return { ok: false, error: 'Apenas o dono pode habilitar emissões.' }

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = admin as any

  // Busca config + dados do tenant
  const { data: config } = await sb
    .from('fiscal_configs')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!config) return { ok: false, error: 'Configure os dados fiscais primeiro.' }

  const { data: tenant } = await sb
    .from('tenants')
    .select('name, cpf_cnpj')
    .eq('id', tenantId)
    .single()

  if (!tenant) return { ok: false, error: 'Tenant não encontrado.' }
  const cnpj = onlyDigits(tenant.cpf_cnpj)
  if (cnpj.length !== 14) {
    return { ok: false, error: 'CNPJ do tenant inválido. Atualize em Configurações > Empresa.' }
  }

  // Valida campos obrigatórios pra Focus
  const required = [
    config.endereco_logradouro, config.endereco_numero, config.endereco_bairro,
    config.endereco_cidade, config.endereco_uf, config.endereco_cep,
  ]
  if (required.some(v => !v)) {
    return { ok: false, error: 'Preencha endereço completo antes de habilitar.' }
  }
  if (!config.ie_isenta && !config.inscricao_estadual) {
    return { ok: false, error: 'Informe Inscrição Estadual ou marque "Isenta".' }
  }
  if (!config.certificate_path || !config.certificate_password) {
    return { ok: false, error: 'Suba o certificado A1 antes de habilitar.' }
  }

  // 1. Cadastra/atualiza empresa na Focus
  try {
    const exists = await getFocusEmpresa(cnpj)
    const focusInput = {
      nome:                tenant.name,
      cnpj,
      regime_tributario:   mapRegimeToFocus(config.regime),
      inscricao_estadual:  config.ie_isenta ? 'ISENTO' : config.inscricao_estadual,
      inscricao_municipal: config.inscricao_municipal ?? undefined,
      email:               user.email ?? '',
      logradouro:          config.endereco_logradouro,
      numero:              config.endereco_numero,
      complemento:         config.endereco_complemento ?? undefined,
      bairro:              config.endereco_bairro,
      municipio:           config.endereco_cidade,
      uf:                  config.endereco_uf,
      cep:                 config.endereco_cep,
      habilita_nfe:        true,
      habilita_nfce:       true,
      habilita_nfse:       true,
      csc:                 config.csc_token ?? undefined,
      csc_id:              config.csc_id ?? undefined,
    }
    if (exists) {
      await updateEmpresa(cnpj, focusInput)
    } else {
      await createEmpresa(focusInput)
    }
  } catch (e) {
    if (e instanceof FocusNfeError) {
      return { ok: false, error: `Focus NFe: ${e.message}` }
    }
    return { ok: false, error: 'Erro ao cadastrar empresa na Focus NFe.' }
  }

  // 2. Sobe certificado pra Focus
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb2 = admin as any
    const { data: certFile, error: dlErr } = await sb2.storage
      .from('fiscal-certificates')
      .download(config.certificate_path)

    if (dlErr || !certFile) {
      return { ok: false, error: 'Não consegui baixar certificado do storage.' }
    }
    const arrayBuffer = await certFile.arrayBuffer()
    const pfxBase64 = Buffer.from(arrayBuffer).toString('base64')

    await uploadCertificado(cnpj, pfxBase64, config.certificate_password)
  } catch (e) {
    if (e instanceof FocusNfeError) {
      return { ok: false, error: `Focus NFe (certificado): ${e.message}` }
    }
    return { ok: false, error: 'Erro ao subir certificado pra Focus NFe.' }
  }

  // 3. Marca enabled=true
  const { error: enErr } = await sb
    .from('fiscal_configs')
    .update({ enabled: true, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)

  if (enErr) return { ok: false, error: `Erro ao habilitar: ${enErr.message}` }

  revalidatePath('/configuracoes/fiscal')
  return { ok: true, data: { enabled: true } }
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers internos
// ──────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRow(row: any): FiscalConfig {
  return {
    tenantId:                row.tenant_id,
    regime:                  row.regime,
    inscricaoEstadual:       row.inscricao_estadual,
    ieIsenta:                row.ie_isenta,
    inscricaoMunicipal:      row.inscricao_municipal,
    cnae:                    row.cnae,
    cscId:                   row.csc_id,
    cscToken:                row.csc_token,
    certificatePath:         row.certificate_path,
    certificateExpiresAt:    row.certificate_expires_at,
    ambiente:                row.ambiente,
    cfopPadrao:              row.cfop_padrao,
    cstCsosnPadrao:          row.cst_csosn_padrao,
    emissionMode:            row.emission_mode,
    enderecoLogradouro:      row.endereco_logradouro,
    enderecoNumero:          row.endereco_numero,
    enderecoComplemento:     row.endereco_complemento,
    enderecoBairro:          row.endereco_bairro,
    enderecoCidade:          row.endereco_cidade,
    enderecoUf:              row.endereco_uf,
    enderecoCep:             row.endereco_cep,
    enderecoCodigoMunicipio: row.endereco_codigo_municipio,
    monthlyQuota:            row.monthly_quota,
    enabled:                 row.enabled,
  }
}
