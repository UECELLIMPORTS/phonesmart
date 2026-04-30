import { requireModuleAccess } from '@/lib/permissions'

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  await requireModuleAccess('crm')
  return <>{children}</>
}
