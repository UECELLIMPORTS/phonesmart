import type { User } from '@supabase/supabase-js'

export function getTenantId(user: User): string {
  return (user.app_metadata?.tenant_id as string | undefined) ?? user.id
}
