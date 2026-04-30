import { requireModuleAccess } from '@/lib/permissions'

export default async function NotasFiscaisLayout({ children }: { children: React.ReactNode }) {
  await requireModuleAccess('notas_fiscais')
  return <>{children}</>
}
