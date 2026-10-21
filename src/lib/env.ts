type Env = Record<string, string | undefined>;

export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) return null;
  } catch {
    return null;
  }
  return { url, key };
}

/** Vercel Preview and Production must never fall back to development defaults. */
export function isDeployedEnvironment(env: Env = process.env): boolean {
  return env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview";
}

/**
 * Exact public origin used in Auth e-mail redirects. In Preview/Production a
 * missing or non-HTTPS value is a configuration error, never a silent
 * fallback to localhost.
 */
export function appOrigin(env: Env = process.env): string {
  const raw = env.NEXT_PUBLIC_APP_URL?.trim();
  const deployed = isDeployedEnvironment(env);
  if (!raw) {
    if (deployed)
      throw new Error(
        "NEXT_PUBLIC_APP_URL es obligatoria en Preview y Production: define en Vercel el origen público exacto (https://…).",
      );
    return "http://localhost:3000";
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("NEXT_PUBLIC_APP_URL no es una URL válida.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("NEXT_PUBLIC_APP_URL debe usar http o https.");
  if (deployed && url.protocol !== "https:")
    throw new Error(
      "NEXT_PUBLIC_APP_URL debe usar https en Preview y Production.",
    );
  return url.origin;
}

/** Session cookies get `Secure` whenever the app is served over HTTPS. */
export function secureCookies(env: Env = process.env): boolean {
  if (isDeployedEnvironment(env)) return true;
  return env.NEXT_PUBLIC_APP_URL?.trim().startsWith("https://") ?? false;
}

/** HSTS only for production builds served over HTTPS (never Preview or localhost). */
export function hstsEnabled(env: Env = process.env): boolean {
  if (env.NODE_ENV !== "production") return false;
  if (env.VERCEL_ENV) return env.VERCEL_ENV === "production";
  return env.NEXT_PUBLIC_APP_URL?.trim().startsWith("https://") ?? false;
}

/** Optional Cloudflare Turnstile site key; without it CAPTCHA stays disabled. */
export function turnstileSiteKey(): string | null {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null;
}
