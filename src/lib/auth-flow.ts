/**
 * Pure helpers for the e-mail link flow (invitation / recovery).
 *
 * GET /auth/callback never consumes the token: it stores the validated link
 * parameters in a short-lived httpOnly cookie and redirects to /auth/confirm,
 * where the user confirms with a POST (Server Action) that calls verifyOtp or
 * exchangeCodeForSession. Link scanners therefore cannot burn the token.
 */
export const PENDING_COOKIE = "cuadria_auth_pending";
export const RECOVERY_COOKIE = "cuadria_recovery";
export const AUTH_COOKIE_PATH = "/auth";
export const PENDING_MAX_AGE = 15 * 60;
export const RECOVERY_WINDOW_SECONDS = 30 * 60;
export const PASSWORD_PATH = "/auth/password";

export type LinkType = "invite" | "recovery";
export type PendingAuth =
  | { kind: "otp"; tokenHash: string; type: LinkType }
  | { kind: "code"; code: string; next: typeof PASSWORD_PATH | "/panel" };

const TOKEN_HASH = /^[A-Za-z0-9_-]{16,512}$/;
const CODE = /^[A-Za-z0-9_-]{8,256}$/;

function isLinkType(value: unknown): value is LinkType {
  return value === "invite" || value === "recovery";
}

/** Validates the query string of /auth/callback without consuming anything. */
export function parseCallback(params: URLSearchParams): PendingAuth | null {
  if (params.get("error") || params.get("error_code")) return null;
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  if (tokenHash !== null) {
    if (!TOKEN_HASH.test(tokenHash) || !isLinkType(type)) return null;
    return { kind: "otp", tokenHash, type };
  }
  const code = params.get("code");
  if (code !== null && CODE.test(code))
    return {
      kind: "code",
      code,
      next: params.get("next") === PASSWORD_PATH ? PASSWORD_PATH : "/panel",
    };
  return null;
}

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
}

export function serializePending(pending: PendingAuth): string {
  return toBase64Url(JSON.stringify(pending));
}

/** Re-validates the cookie content: it is treated as untrusted input. */
export function parsePending(value: string | undefined): PendingAuth | null {
  if (!value || value.length > 2048) return null;
  try {
    const data = JSON.parse(fromBase64Url(value)) as Record<string, unknown>;
    if (
      data.kind === "otp" &&
      typeof data.tokenHash === "string" &&
      TOKEN_HASH.test(data.tokenHash) &&
      isLinkType(data.type)
    )
      return { kind: "otp", tokenHash: data.tokenHash, type: data.type };
    if (
      data.kind === "code" &&
      typeof data.code === "string" &&
      CODE.test(data.code) &&
      (data.next === PASSWORD_PATH || data.next === "/panel")
    )
      return { kind: "code", code: data.code, next: data.next };
  } catch {
    return null;
  }
  return null;
}

/** Only /auth/password or /panel are reachable after confirming a link. */
export function destinationAfterConfirm(
  pending: PendingAuth,
): typeof PASSWORD_PATH | "/panel" {
  return pending.kind === "otp" ? PASSWORD_PATH : pending.next;
}

/** Reads `session_id` from an access token Supabase just returned over TLS. */
export function sessionIdFromAccessToken(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(fromBase64Url(payload)) as {
      session_id?: unknown;
    };
    return typeof claims.session_id === "string" ? claims.session_id : null;
  } catch {
    return null;
  }
}

const EMAIL_LINK_METHODS = new Set(["recovery", "invite", "otp", "magiclink"]);

type Claims = { session_id?: unknown; amr?: unknown } | null | undefined;

/**
 * A password may be set without the current one only when BOTH hold:
 * - the httpOnly cookie issued after confirming the e-mail link is bound to
 *   this exact session, and
 * - the Supabase-signed access token proves the session was created from an
 *   e-mail link (amr recovery/invite/otp/magiclink) less than 30 minutes ago.
 * The cookie alone is never enough because a client can forge it.
 */
export function canSetPasswordWithoutCurrent(
  claims: Claims,
  recoveryCookie: string | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!claims || typeof claims.session_id !== "string") return false;
  if (!recoveryCookie || recoveryCookie !== claims.session_id) return false;
  if (!Array.isArray(claims.amr)) return false;
  return claims.amr.some((entry: unknown) => {
    if (!entry || typeof entry !== "object") return false;
    const { method, timestamp } = entry as {
      method?: unknown;
      timestamp?: unknown;
    };
    return (
      typeof method === "string" &&
      EMAIL_LINK_METHODS.has(method) &&
      typeof timestamp === "number" &&
      timestamp <= nowSeconds + 60 &&
      nowSeconds - timestamp <= RECOVERY_WINDOW_SECONDS
    );
  });
}
