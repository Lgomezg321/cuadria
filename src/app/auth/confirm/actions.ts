"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { secureCookies, supabaseConfig } from "@/lib/env";
import { isTransientAuthError } from "@/lib/auth";
import { AUTH_UNAVAILABLE_MESSAGE } from "@/lib/errors";
import { describeError, logServer } from "@/lib/log";
import {
  AUTH_COOKIE_PATH,
  destinationAfterConfirm,
  parsePending,
  PASSWORD_PATH,
  PENDING_COOKIE,
  RECOVERY_COOKIE,
  RECOVERY_WINDOW_SECONDS,
  sessionIdFromAccessToken,
} from "@/lib/auth-flow";
import type { ActionState } from "@/app/actions";

/**
 * POST step of the e-mail link flow: only here is the one-time token
 * consumed (verifyOtp / exchangeCodeForSession).
 */
export async function confirmAuthLink(): Promise<ActionState> {
  if (!supabaseConfig()) redirect("/configuracion");
  const store = await cookies();
  const pending = parsePending(store.get(PENDING_COOKIE)?.value);
  if (!pending) redirect("/login?error=callback");
  const supabase = await createClient();
  let result;
  if (pending.kind === "otp") {
    // The page already warned about an open session: close it before
    // switching accounts so it does not stay valid in the background.
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error)
      logServer("warn", "auth.previous_signout_failed", describeError(error));
    result = await supabase.auth.verifyOtp({
      token_hash: pending.tokenHash,
      type: pending.type,
    });
  } else {
    result = await supabase.auth.exchangeCodeForSession(pending.code);
  }
  const session = result.data.session;
  if (result.error || !session) {
    if (result.error && isTransientAuthError(result.error)) {
      // Keep the pending link so the user can retry once Auth answers.
      logServer("error", "auth.link_unavailable", describeError(result.error));
      return { error: AUTH_UNAVAILABLE_MESSAGE };
    }
    logServer("warn", "auth.link_rejected", {
      kind: pending.kind,
      ...describeError(result.error),
    });
    store.delete({ name: PENDING_COOKIE, path: AUTH_COOKIE_PATH });
    redirect("/login?error=callback");
  }
  store.delete({ name: PENDING_COOKIE, path: AUTH_COOKIE_PATH });
  const { error: inviteError } = await supabase.rpc("accept_invitations");
  if (inviteError)
    logServer(
      "warn",
      "auth.accept_invitations_failed",
      describeError(inviteError),
    );
  const destination = destinationAfterConfirm(pending);
  const sessionId = sessionIdFromAccessToken(session.access_token);
  if (destination === PASSWORD_PATH && sessionId)
    store.set(RECOVERY_COOKIE, sessionId, {
      httpOnly: true,
      secure: secureCookies(),
      sameSite: "lax",
      path: AUTH_COOKIE_PATH,
      maxAge: RECOVERY_WINDOW_SECONDS,
    });
  redirect(destination);
}
