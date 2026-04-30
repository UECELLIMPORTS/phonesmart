import { requireModuleAccess } from '@/lib/permissions'

export default async function ErpClientesLayout({ children }: { children: React.ReactNode }) {
  await requireModuleAccess('erp_clientes')
  return <>{children}</>
}
