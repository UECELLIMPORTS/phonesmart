import { requireModuleAccess } from '@/lib/permissions'

export default async function ClientesLayout({ children }: { children: React.ReactNode }) {
  await requireModuleAccess('clientes')
  return <>{children}</>
}
