import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Webhooks externos (Asaas, etc) não passam pelo auth do Supabase — o
  // auth deles é feito por token no header dentro do próprio route handler.
  // Sem essa exceção, requests de webhook são redirecionados pra /login (307)
  // e nunca chegam no handler. Causou bug onde Asaas marcava webhook como
  // "Penalização aplicada" (15 tentativas com 307) e parava de enviar.
  if (pathname.startsWith('/api/webhooks/') || pathname.startsWith('/api/cron/')) {
    return NextResponse.next({ request })
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll()      { return request.cookies.getAll() },
        setAll(toSet) {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Rotas públicas — redireciona usuário autenticado pro dashboard.
  // /reset-password e /aceitar-convite são exceções: precisam receber sessão
  // temporária do Supabase mesmo se já tem outro user logado.
  if (pathname === '/login' || pathname === '/signup' || pathname === '/forgot-password') {
    if (user) return NextResponse.redirect(new URL('/', request.url))
    return response
  }
  if (pathname === '/reset-password' || pathname.startsWith('/aceitar-convite')) {
    return response
  }

  // Rotas protegidas — redireciona não-autenticado pro login
  if (!user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
