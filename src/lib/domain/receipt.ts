// Pure receipt rules shared by the browser (early feedback) and the server
// (authoritative check before confirm_receipt). No I/O here.
export const MAX_RECEIPT_SIZE = 10 * 1024 * 1024;
export const MAX_RECEIPT_NAME = 180;
export const RECEIPT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "application/pdf",
] as const;
export type ReceiptMime = (typeof RECEIPT_MIME_TYPES)[number];
export type ReceiptStatus = "pending" | "verified" | "rejected" | "expired";

export function isReceiptMime(value: unknown): value is ReceiptMime {
  return (
    typeof value === "string" &&
    (RECEIPT_MIME_TYPES as readonly string[]).includes(value)
  );
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
export function detectReceiptMime(bytes: Uint8Array): ReceiptMime | null {
  if (bytes.length >= 8 && PNG_SIGNATURE.every((n, i) => bytes[i] === n))
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return "image/jpeg";
  if (
    bytes.length >= 5 &&
    String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-"
  )
    return "application/pdf";
  return null;
}

function lastIndexOf(
  bytes: Uint8Array,
  pattern: number[],
  from = bytes.length - pattern.length,
  limit = 0,
): number {
  for (let i = Math.min(from, bytes.length - pattern.length); i >= limit; i--)
    if (pattern.every((b, j) => bytes[i + j] === b)) return i;
  return -1;
}
const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
const TAIL_WINDOW = 1024;

// Detects files cut short during upload. Each format must keep its end marker:
// PNG an IEND chunk, JPEG an EOI marker after the start, PDF an %%EOF in the
// last kilobyte (the tolerance most readers apply).
export function isReceiptComplete(bytes: Uint8Array, mime: ReceiptMime) {
  const tailStart = Math.max(0, bytes.length - TAIL_WINDOW);
  if (mime === "image/png")
    return (
      bytes.length >= 8 + 12 + 12 &&
      lastIndexOf(bytes, ascii("IEND"), undefined, Math.max(8, tailStart)) >= 0
    );
  if (mime === "image/jpeg")
    return (
      bytes.length >= 4 && lastIndexOf(bytes, [255, 217], undefined, 2) >= 0
    );
  return lastIndexOf(bytes, ascii("%%EOF"), undefined, tailStart) >= 0;
}

export type ReceiptProblem =
  | "empty"
  | "too_large"
  | "signature"
  | "mime_mismatch"
  | "size_mismatch"
  | "truncated";
export type ReceiptInspection =
  | { ok: true; mime: ReceiptMime }
  | { ok: false; problem: ReceiptProblem; detected: ReceiptMime | null };

// Authoritative content check: real bytes against what was declared and reserved.
export function inspectReceipt(
  bytes: Uint8Array,
  declared: { mime: string; size: number },
): ReceiptInspection {
  const detected = detectReceiptMime(bytes);
  if (bytes.length === 0) return { ok: false, problem: "empty", detected };
  if (bytes.length > MAX_RECEIPT_SIZE)
    return { ok: false, problem: "too_large", detected };
  if (!detected) return { ok: false, problem: "signature", detected };
  if (detected !== declared.mime)
    return { ok: false, problem: "mime_mismatch", detected };
  if (bytes.length !== declared.size)
    return { ok: false, problem: "size_mismatch", detected };
  if (!isReceiptComplete(bytes, detected))
    return { ok: false, problem: "truncated", detected };
  return { ok: true, mime: detected };
}

// Display/download name: no control characters or path separators, bounded length.
export function sanitizeReceiptName(name: string): string {
  return name
    .replace(/[\u0000-\u001f\u007f/\\]/g, "_")
    .trim()
    .slice(0, MAX_RECEIPT_NAME)
    .trim();
}

export type DeclaredReceipt = { name: string; mime: ReceiptMime; size: number };
// Validates the metadata the browser declares before a reservation is created.
export function validateDeclaredReceipt(input: {
  name: string;
  mime: string;
  size: number;
}): { ok: true; value: DeclaredReceipt } | { ok: false; error: string } {
  const name = sanitizeReceiptName(input.name);
  if (!name) return { ok: false, error: "El archivo debe tener un nombre." };
  if (!Number.isSafeInteger(input.size) || input.size <= 0)
    return { ok: false, error: "El archivo está vacío." };
  if (input.size > MAX_RECEIPT_SIZE)
    return { ok: false, error: "El archivo debe pesar como máximo 10 MB." };
  if (!isReceiptMime(input.mime))
    return {
      ok: false,
      error: "El archivo debe ser una imagen JPG, PNG o un PDF.",
    };
  return { ok: true, value: { name, mime: input.mime, size: input.size } };
}

export const receiptProblemMessages: Record<ReceiptProblem, string> = {
  empty: "El archivo está vacío.",
  too_large: "El archivo debe pesar como máximo 10 MB.",
  signature: "El archivo debe ser una imagen JPG, PNG o un PDF válido.",
  mime_mismatch:
    "El contenido del archivo no corresponde a su tipo declarado (JPG, PNG o PDF).",
  size_mismatch:
    "El archivo almacenado no coincide con el tamaño declarado. Vuelve a cargarlo.",
  truncated:
    "El archivo parece incompleto o dañado. Vuelve a cargarlo desde el original.",
};

// Reasons recorded by confirm_receipt in public.receipts.status_reason.
export function receiptRejectionMessage(reason: string | null): string {
  switch (reason) {
    case "size":
    case "metadata_size":
      return receiptProblemMessages.size_mismatch;
    case "metadata_mime":
      return receiptProblemMessages.mime_mismatch;
    case "owner":
      return "El archivo almacenado no pertenece a tu reserva.";
    default:
      return receiptProblemMessages.signature;
  }
}
