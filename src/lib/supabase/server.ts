import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { secureCookies, supabaseConfig } from "@/lib/env";

/**
 * Session cookies are only read on the server (there is no browser client),
 * so they are HttpOnly, SameSite=Lax and Secure whenever served over HTTPS.
 */
export function sessionCookieOptions(): CookieOptions {
  return { path: "/", httpOnly: true, secure: secureCookies(), sameSite: "lax" };
}

export async function createClient() {
  const config = supabaseConfig();
  if (!config) throw new Error("SUPABASE_NOT_CONFIGURED");
  const store = await cookies();
  const hardened = sessionCookieOptions();
  return createServerClient(config.url, config.key, {
    cookieOptions: hardened,
    cookies: {
      getAll: () => store.getAll(),
      setAll: (items) => {
        try {
          items.forEach(({ name, value, options }) =>
            store.set(name, value, { ...options, ...hardened }),
          );
        } catch {
          /* Server Components cannot write; proxy refreshes cookies. */
        }
      },
    },
  });
}

/**
 * Client without cookie persistence: used to verify the current password in
 * isolation so the user's browser session is never replaced.
 */
export function createEphemeralClient() {
  const config = supabaseConfig();
  if (!config) throw new Error("SUPABASE_NOT_CONFIGURED");
  return createSupabaseClient(config.url, config.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
