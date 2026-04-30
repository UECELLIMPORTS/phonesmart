import { requireModuleAccess } from '@/lib/permissions'

export default async function MetaAdsLayout({ children }: { children: React.ReactNode }) {
  await requireModuleAccess('meta_ads')
  return <>{children}</>
}
