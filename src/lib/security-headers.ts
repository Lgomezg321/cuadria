export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
export const HSTS_VALUE = "max-age=63072000; includeSubDomains";

export type CspOptions = {
  nonce: string;
  supabaseUrl?: string | null;
  turnstile?: boolean;
  development?: boolean;
  upgradeInsecureRequests?: boolean;
};

function originOf(url?: string | null): string[] {
  if (!url) return [];
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? [parsed.origin]
      : [];
  } catch {
    return [];
  }
}

/** Random, unguessable nonce for a single response (base64, 128 bits). */
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Nonce-based Content Security Policy following the Next.js 16 guide.
 * Styles keep 'unsafe-inline' because React/next/image emit style attributes,
 * which nonces cannot authorise; scripts are nonce + 'strict-dynamic' only.
 */
export function buildContentSecurityPolicy(options: CspOptions): string {
  const supabase = originOf(options.supabaseUrl);
  const turnstile = options.turnstile ? [TURNSTILE_ORIGIN] : [];
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      [
        "'self'",
        `'nonce-${options.nonce}'`,
        "'strict-dynamic'",
        ...turnstile,
        ...(options.development ? ["'unsafe-eval'"] : []),
      ],
    ],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "blob:", "data:", ...supabase]],
    ["font-src", ["'self'"]],
    ["connect-src", ["'self'", ...supabase, ...turnstile]],
    ["frame-src", ["'self'", ...supabase, ...turnstile]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  const policy = directives.map(([name, values]) =>
    [name, ...values].join(" "),
  );
  if (options.upgradeInsecureRequests) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}
