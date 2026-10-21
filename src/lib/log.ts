import "server-only";

/**
 * Minimal structured server logger. It never receives cookies, tokens,
 * passwords or form payloads; free text is truncated and scrubbed of e-mail
 * addresses, JWT-like strings, long secrets and amounts before printing.
 */
type Level = "info" | "warn" | "error";
type Detail = string | number | boolean | null | undefined;

const EMAIL = /[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+/g;
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]*/g;
const SECRET = /[A-Za-z0-9_+/=]{32,}/g;
const AMOUNT = /\d{1,3}(?:[.,]\d{3})+|\b\d{5,}\b/g;

export function scrub(text: string, max = 300): string {
  return text
    .replace(JWT, "[token]")
    .replace(EMAIL, "[correo]")
    .replace(SECRET, "[secreto]")
    .replace(AMOUNT, "[número]")
    .slice(0, max);
}

/** Safe, non-identifying summary of an error (Supabase, Auth or Error). */
export function describeError(error: unknown): Record<string, Detail> {
  if (!error || typeof error !== "object")
    return { message: scrub(String(error)) };
  const e = error as {
    name?: unknown;
    code?: unknown;
    status?: unknown;
    message?: unknown;
  };
  return {
    name: typeof e.name === "string" ? e.name : undefined,
    code: typeof e.code === "string" ? e.code : undefined,
    status: typeof e.status === "number" ? e.status : undefined,
    message: typeof e.message === "string" ? scrub(e.message) : undefined,
  };
}

export function logServer(
  level: Level,
  event: string,
  details: Record<string, Detail> = {},
): void {
  const clean: Record<string, Detail> = {};
  for (const [key, value] of Object.entries(details))
    if (value !== undefined)
      clean[key] = typeof value === "string" ? scrub(value) : value;
  const line = JSON.stringify({
    level,
    event,
    at: new Date().toISOString(),
    ...clean,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
