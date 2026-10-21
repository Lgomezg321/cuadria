import { createHmac } from "node:crypto";

/**
 * Signed receipt verdict (R-01). The server inspects the stored bytes and
 * signs what it found; public.confirm_receipt recomputes the same HMAC with
 * the secret kept in Supabase Vault, so a direct PostgREST call cannot mark
 * arbitrary bytes as verified. The message format must stay identical to
 * private.receipt_verdict_valid in 202610210004_integration_fixes.sql:
 * `<receipt uuid>|<detected mime or empty>|<size in bytes>|<user uuid>`.
 * Server only (imported by receipt-actions); it never reaches the browser.
 */
export type ReceiptVerdict = {
  receipt: string;
  detectedMime: string | null;
  size: number | bigint;
  user: string;
};

export function receiptVerdictMessage(v: ReceiptVerdict): string {
  return `${v.receipt.toLowerCase()}|${v.detectedMime ?? ""}|${v.size}|${v.user.toLowerCase()}`;
}

/** Lowercase hex HMAC-SHA256 of the verdict (64 characters). */
export function signReceiptVerdict(secret: string, v: ReceiptVerdict): string {
  return createHmac("sha256", secret)
    .update(receiptVerdictMessage(v), "utf8")
    .digest("hex");
}
