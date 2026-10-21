import "server-only";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { cache } from "react";
import {
  isAuthApiError,
  isAuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { describeError, logServer } from "@/lib/log";
import { canSetPasswordWithoutCurrent, RECOVERY_COOKIE } from "@/lib/auth-flow";

/** Auth could not be reached: shown as a temporary failure, not a logout. */
export class AuthUnavailableError extends Error {
  constructor() {
    super("AUTH_UNAVAILABLE");
    this.name = "AuthUnavailableError";
  }
}

export function isTransientAuthError(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return true;
  const status =
    error && typeof error === "object"
      ? (error as { status?: unknown }).status
      : undefined;
  return (
    typeof status === "number" &&
    (status === 0 || status === 429 || status >= 500)
  );
}

export const requireUser = cache(async () => {
  if (!supabaseConfig()) redirect("/configuracion");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error && isTransientAuthError(error)) {
    logServer("error", "auth.unavailable", describeError(error));
    throw new AuthUnavailableError();
  }
  if (
    error &&
    isAuthApiError(error) &&
    error.status !== 401 &&
    error.status !== 403
  )
    logServer("warn", "auth.session_rejected", describeError(error));
  if (error || !data.user) redirect("/login");
  return { supabase, user: data.user };
});

/** Optional session lookup (no redirect) used by the link confirmation page. */
export async function currentUserEmail(): Promise<string | null> {
  if (!supabaseConfig()) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ? (data.user.email ?? "otra cuenta") : null;
}

/**
 * True when the session was opened from a verified invitation/recovery link
 * in the last minutes (see canSetPasswordWithoutCurrent).
 */
export async function inRecoveryMode(
  supabase: SupabaseClient,
): Promise<boolean> {
  const store = await cookies();
  const marker = store.get(RECOVERY_COOKIE)?.value;
  if (!marker) return false;
  const { data, error } = await supabase.auth.getClaims();
  if (error) {
    logServer("warn", "auth.claims_failed", describeError(error));
    return false;
  }
  return canSetPasswordWithoutCurrent(data?.claims, marker);
}
