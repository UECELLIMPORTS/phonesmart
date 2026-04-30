import { requireModuleAccess } from '@/lib/permissions'

export default async function EstoqueLayout({ children }: { children: React.ReactNode }) {
  await requireModuleAccess('estoque')
  return <>{children}</>
}
