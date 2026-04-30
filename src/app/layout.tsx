import type { Metadata } from 'next'
import { Inter, DM_Sans, JetBrains_Mono } from 'next/font/google'
import { Toaster } from 'sonner'
import './globals.css'

// Body: Inter (legibilidade impecável em telas)
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

// Display: DM Sans (geometric, premium, weight 600/700/800 pra hierarquia)
const dmSans = DM_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display',
  weight: ['500', '600', '700', '800'],
})

// Mono: JetBrains Mono pra números/códigos (mais autoridade que Geist Mono)
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: { default: 'Phone Smart', template: '%s — Phone Smart' },
  description: 'ERP especializado pra lojas de celular — vendas, estoque com IMEI, OS, fiscal e relatórios',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${dmSans.variable} ${jetbrains.variable} h-full`}>
      <body className={`${inter.className} h-full antialiased`}>
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: { background: '#131C2A', border: '1px solid #2A3650', color: '#F8FAFC' },
          }}
        />
      </body>
    </html>
  )
}
