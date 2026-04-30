import { requireModuleAccess } from '@/lib/permissions'

export default async function PosLayout({ children }: { children: React.ReactNode }) {
  await requireModuleAccess('pos')
  return <>{children}</>
}
