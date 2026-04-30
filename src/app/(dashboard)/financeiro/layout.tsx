import { requireModuleAccess } from '@/lib/permissions'

export default async function FinanceiroLayout({ children }: { children: React.ReactNode }) {
  await requireModuleAccess('financeiro')
  return <>{children}</>
}
