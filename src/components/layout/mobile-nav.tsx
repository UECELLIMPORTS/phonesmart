'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X, Zap } from 'lucide-react'
import { filterNavByPermissions } from './sidebar'
import type { ModuleKey } from '@/lib/permissions-shared'

type Props = {
  hasFullAccess?: boolean
  allowedModules?: ModuleKey[]
  isOwner?:       boolean
}

/** Hamburger + drawer pra mobile. Só aparece em <lg. */
export function MobileNav({ hasFullAccess = true, allowedModules = [], isOwner = true }: Props) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const visibleNav = filterNavByPermissions(hasFullAccess, allowedModules, isOwner)

  // Fecha drawer ao navegar
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Trava scroll do body quando drawer aberto
  useEffect(() => {
    if (open) {
      const original = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = original }
    }
  }, [open])

  return (
    <>
      {/* Botão hamburger — só em mobile */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Abrir menu"
        className="flex h-9 w-9 items-center justify-center rounded-lg border transition-colors hover:bg-card lg:hidden"
        style={{ borderColor: '#2A3650', color: '#F8FAFC' }}
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Backdrop + drawer — só renderiza quando aberto */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Backdrop */}
          <div
            onClick={() => setOpen(false)}
            className="absolute inset-0 transition-opacity"
            style={{ background: 'rgba(0,0,0,0.6)' }}
          />

          {/* Drawer */}
          <aside
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r"
            style={{ background: '#131C2A', borderColor: '#2A3650' }}
          >
            {/* Header com logo + botão fechar */}
            <div className="flex h-16 items-center justify-between border-b px-5" style={{ borderColor: '#2A3650' }}>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg"
                  style={{ background: 'linear-gradient(135deg, #22C55E, #22D3EE)' }}>
                  <Zap className="h-5 w-5" style={{ color: 'white' }} />
                </div>
                <span className="text-base font-bold tracking-tight" style={{ color: '#F8FAFC' }}>
                  Smart<span style={{ color: '#22C55E' }}>ERP</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fechar menu"
                className="flex h-9 w-9 items-center justify-center rounded-lg border transition-colors hover:bg-card"
                style={{ borderColor: '#2A3650', color: '#94A3B8' }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Nav */}
            <nav className="flex-1 overflow-y-auto px-3 py-4">
              <ul className="space-y-0.5">
                {visibleNav.map(({ href, icon: Icon, label }) => {
                  const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
                  return (
                    <li key={href}>
                      <Link
                        href={href}
                        className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-all"
                        style={active
                          ? { background: '#22C55E15', color: '#22C55E', borderLeft: '2px solid #22C55E' }
                          : { color: '#94A3B8' }
                        }
                      >
                        <Icon className="h-5 w-5 flex-shrink-0" />
                        {label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </nav>

            {/* Footer */}
            <div className="border-t px-4 py-3" style={{ borderColor: '#2A3650' }}>
              <p className="text-center text-[10px]" style={{ color: '#64748B' }}>v1.0.0</p>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
