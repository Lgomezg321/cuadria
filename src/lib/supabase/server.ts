import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseConfig } from '@/lib/env';
export async function createClient() {
  const config = supabaseConfig();
  if (!config) throw new Error('SUPABASE_NOT_CONFIGURED');
  const store = await cookies();
  return createServerClient(config.url, config.key, { cookies: {
    getAll: () => store.getAll(),
    setAll: (items) => { try { items.forEach(({name, value, options}) => store.set(name, value, options)); } catch { /* Server Components cannot write; proxy refreshes cookies. */ } },
  } });
}
