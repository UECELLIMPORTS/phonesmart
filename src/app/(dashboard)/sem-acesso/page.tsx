import { Lock } from 'lucide-react'
import { requireAuth } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Sem acesso — Phone Smart' }

export default async function SemAcessoPage() {
  try { await requireAuth() } catch { redirect('/login') }

  return (
    <div className="max-w-2xl mx-auto mt-12">
      <div className="rounded-2xl border p-12 text-center"
        style={{ background: '#131C2A', borderColor: 'rgba(255,77,109,.3)' }}>
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border"
          style={{ background: 'rgba(255,77,109,.1)', borderColor: 'rgba(255,77,109,.3)' }}>
          <Lock className="h-7 w-7" style={{ color: '#EF4444' }} />
        </div>
        <h1 className="text-xl font-bold mb-2" style={{ color: '#F8FAFC' }}>
          Sem acesso a nenhum módulo
        </h1>
        <p className="text-sm" style={{ color: '#CBD5E1' }}>
          Você está logado, mas o dono da conta ainda não liberou nenhum módulo
          pra você. Peça que ele acesse <strong>Configurações → Equipe</strong>
          {' '}e marque pelo menos um módulo no seu acesso.
        </p>
      </div>
    </div>
  )
}
