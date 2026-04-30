import { requireModuleAccess } from '@/lib/permissions'

export default async function RelatoriosLayout({ children }: { children: React.ReactNode }) {
  await requireModuleAccess('relatorios')
  return <>{children}</>
}
