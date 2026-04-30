import Link from 'next/link'
import { Zap, ShieldCheck, Sparkles, Lock } from 'lucide-react'

type Props = {
  children: React.ReactNode
}

/**
 * Shell light pras páginas de autenticação (login/signup/forgot/reset/invite).
 * Layout split: form à esquerda, branding lateral com gradient indigo à direita.
 *
 * Sistema interno (dashboard) continua dark — esse light é só pra reduzir
 * fricção visual no momento de entrada/cadastro.
 */
export function AuthShell({ children }: Props) {
  return (
    <div className="min-h-screen flex" style={{ background: '#131C2A', color: '#F8FAFC' }}>
      {/* Left: form area */}
      <div className="flex-1 flex flex-col">
        {/* Top bar with logo */}
        <div className="px-6 sm:px-10 py-6">
          <Link href="/" className="inline-flex items-center gap-2.5 font-bold">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg"
              style={{ background: 'linear-gradient(135deg, #22C55E, #22D3EE)' }}>
              <Zap className="h-5 w-5" style={{ color: 'white' }} />
            </div>
            <span style={{ color: '#F8FAFC' }}>
              Gestão <span style={{ color: '#22C55E' }}>Inteligente</span>
            </span>
          </Link>
        </div>

        {/* Form container — centered */}
        <div className="flex-1 flex items-center justify-center px-6 sm:px-10 py-10">
          <div className="w-full max-w-md">
            {children}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 sm:px-10 py-6 text-xs flex items-center justify-between"
          style={{ color: '#64748B' }}>
          <span>© {new Date().getFullYear()} Phone Smart</span>
          <div className="flex gap-4">
            <a href="https://gestaophonesmart.online/termos" className="hover:opacity-80 transition-opacity">Termos</a>
            <a href="https://gestaophonesmart.online/privacidade" className="hover:opacity-80 transition-opacity">Privacidade</a>
          </div>
        </div>
      </div>

      {/* Right: branding side — só em desktop */}
      <div className="hidden lg:flex flex-col flex-1 max-w-xl relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #22C55E 0%, #16A34A 50%, #94A3B8 100%)' }}>
        {/* Pattern decorativo sutil */}
        <div className="pointer-events-none absolute inset-0 opacity-10"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
            backgroundSize: '32px 32px',
          }} />

        <div className="relative flex-1 flex flex-col justify-center px-12 py-16">
          <div className="max-w-md">
            <p className="text-xs font-bold uppercase tracking-widest mb-4"
              style={{ color: 'rgba(255,255,255,.7)' }}>
              ERP completo · Multi-canal · Pra lojistas reais
            </p>
            <h2 className="text-3xl xl:text-4xl font-bold leading-tight mb-6 tracking-tight"
              style={{ color: 'white' }}>
              O sistema que cresce<br />junto com a sua loja.
            </h2>
            <p className="text-base leading-relaxed mb-10"
              style={{ color: 'rgba(255,255,255,.85)' }}>
              Frente de caixa, estoque, financeiro, CRM e Meta Ads num só painel.
              Saiba qual canal traz mais lucro e onde sua margem está vazando —
              com dados reais, não achismo.
            </p>

            <ul className="space-y-3 text-sm" style={{ color: 'rgba(255,255,255,.95)' }}>
              <FeatureLine icon={Sparkles}>POS, Estoque e Financeiro integrados</FeatureLine>
              <FeatureLine icon={ShieldCheck}>Sem fidelidade · Cancele quando quiser</FeatureLine>
              <FeatureLine icon={Lock}>Seus dados em servidores brasileiros</FeatureLine>
            </ul>
          </div>
        </div>

        <div className="relative px-12 py-8 border-t"
          style={{ borderColor: 'rgba(255,255,255,.15)' }}>
          <p className="text-xs italic mb-3" style={{ color: 'rgba(255,255,255,.85)' }}>
            &ldquo;Construímos cada feature resolvendo uma dor real do balcão.
            Se funciona pra mim com 12 mil clientes, funciona pra você.&rdquo;
          </p>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold"
              style={{ background: 'rgba(255,255,255,.95)', color: '#22C55E' }}>
              FF
            </div>
            <div className="text-xs">
              <p className="font-bold" style={{ color: 'white' }}>Felipe Ferreira</p>
              <p style={{ color: 'rgba(255,255,255,.7)' }}>Fundador · UÉ Cell Imports</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function FeatureLine({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <Icon className="h-4 w-4 shrink-0" style={{ color: 'rgba(255,255,255,.95)' }} />
      <span>{children}</span>
    </li>
  )
}
