'use server'

/**
 * Signup público com criação automática de tenant.
 *
 * Fluxo:
 * 1. Cria user no Supabase Auth via admin (service_role)
 * 2. Chama RPC create_tenant_for_user (cria tenant + subscription com 7d trial)
 * 3. Seta `app_metadata.tenant_id` no user pra ele virar tenant-aware no JWT
 * 4. Retorna { ok, redirectTo } pra client redirecionar pro login (ou auto-login)
 *
 * Erros são tratados e retornados como string amigável (não joga exception).
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { sendWelcomeEmail } from '@/lib/email'
import { createNotification } from '@/lib/notifications'

export type SignupInput = {
  fullName:   string
  email:      string
  password:   string
  tenantName: string   // nome da empresa/loja
}

export type SignupResult =
  | { ok: true;  email: string }
  | { ok: false; error: string }

export async function signupTenant(input: SignupInput): Promise<SignupResult> {
  // ── 1. Validações básicas (frontend já valida, mas confiamos zero no client) ──
  const fullName   = input.fullName.trim()
  const email      = input.email.trim().toLowerCase()
  const password   = input.password
  const tenantName = input.tenantName.trim()

  if (fullName.length < 2)   return { ok: false, error: 'Informe seu nome completo.' }
  if (tenantName.length < 2) return { ok: false, error: 'Informe o nome da sua empresa.' }
  if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, error: 'E-mail inválido.' }
  if (password.length < 8)   return { ok: false, error: 'Senha precisa ter pelo menos 8 caracteres.' }

  let admin: ReturnType<typeof createAdminClient>
  try { admin = createAdminClient() } catch (e) {
    console.error('[signupTenant] admin client não pôde ser criado:', e)
    return { ok: false, error: 'Servidor mal configurado. Avise o suporte.' }
  }

  // ── 2. Cria o user (auth.users) ───────────────────────────────────────────
  // email_confirm:true porque ainda não temos email transacional pra link de
  // verificação (Nível 2 do roadmap). Em produção seria bom mandar email.

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })

  if (createErr || !created?.user) {
    if (createErr?.message?.includes('already')) {
      return { ok: false, error: 'Esse e-mail já está cadastrado. Tente fazer login.' }
    }
    console.error('[signupTenant] createUser falhou:', createErr)
    return { ok: false, error: 'Não foi possível criar a conta. Tente novamente.' }
  }

  const userId = created.user.id

  // ── 3. Cria tenant + subscription via RPC ────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tenantId, error: rpcErr } = await (admin as any).rpc('create_tenant_for_user', {
    p_user_id:     userId,
    p_tenant_name: tenantName,
  })

  if (rpcErr || !tenantId) {
    console.error('[signupTenant] RPC create_tenant_for_user falhou:', rpcErr)
    // Rollback: apaga o user pra não deixar órfão
    await admin.auth.admin.deleteUser(userId)
    return { ok: false, error: 'Erro ao criar a empresa. Tente novamente.' }
  }

  // ── 4. Seta app_metadata.tenant_id + tenant_role=owner no user ──────────
  // tenant_role é lido pela função SQL tenant_role() usada nas RLS policies
  // de INSERT/UPDATE/DELETE de várias tabelas. Sem isso o user não consegue
  // criar/editar nada (só ler).
  const { error: metaErr } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { tenant_id: tenantId, tenant_role: 'owner' },
  })

  if (metaErr) {
    console.error('[signupTenant] updateUserById (app_metadata) falhou:', metaErr)
    return { ok: false, error: 'Conta criada parcialmente. Contate o suporte.' }
  }

  // Email de boas-vindas (best-effort — não falha o signup se email não rolar)
  void sendWelcomeEmail({ to: email, fullName, tenantName })

  // Notificação in-app de boas-vindas (sino mostra na próxima sessão)
  void createNotification({
    userId:   userId,
    tenantId: tenantId,
    type:     'welcome',
    title:    `Bem-vindo, ${fullName.split(' ')[0]}!`,
    body:     `Sua conta da ${tenantName} está pronta. Você tem 7 dias de trial Premium pra explorar tudo.`,
    link:     '/',
  })

  return { ok: true, email }
}

/**
 * Faz login imediato após signup. Usa o cliente normal (não admin) pra
 * gravar o cookie de sessão. Chamado logo depois de signupTenant().
 *
 * IMPORTANTE: depois do signInWithPassword, força refreshSession pra
 * garantir que o JWT carrega o `app_metadata.tenant_id` que o signupTenant
 * acabou de setar via admin (sem isso o primeiro request pós-login dá
 * RLS error porque o JWT estava sem tenant_id).
 */
export async function loginAfterSignup(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    return { ok: false, error: 'Conta criada, mas falha ao logar. Vá em /login e entre manualmente.' }
  }
  // Força refresh — o app_metadata.tenant_id setado segundos atrás precisa
  // entrar no novo JWT pra RLS aceitar inserts/queries
  await supabase.auth.refreshSession()
  return { ok: true }
}
