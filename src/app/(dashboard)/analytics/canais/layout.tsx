import { requireModuleAccess } from '@/lib/permissions'

export default async function CanaisLayout({ children }: { children: React.ReactNode }) {
  await requireModuleAccess('analytics_canais')
  return <>{children}</>
}
