"use server";
// Receipts never travel through a Server Action body (H-07). The browser asks
// for a reservation, uploads the bytes straight to Supabase Storage with a
// signed upload token, and then asks the server to verify the stored object.
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { publicError } from "@/lib/errors";
import { receiptVerificationSecret } from "@/lib/env";
import { logServer } from "@/lib/log";
import { signReceiptVerdict } from "@/lib/receipt-signature";
import {
  inspectReceipt,
  receiptProblemMessages,
  receiptRejectionMessage,
  validateDeclaredReceipt,
  MAX_RECEIPT_SIZE,
  RECEIPT_MIME_TYPES,
  type ReceiptMime,
} from "@/lib/domain/receipt";

export type ReserveReceiptResult =
  | { error: string; renewKey?: boolean }
  | { receiptId: string; state: "verified" }
  | { receiptId: string; state: "uploaded" }
  | {
      receiptId: string;
      state: "upload";
      signedUrl: string;
      mime: ReceiptMime;
    };
export type ConfirmReceiptResult =
  { error: string; retry?: boolean } | { success: string };

const BUCKET = "receipts";
const reserveInput = z.object({
  movement: z.uuid(),
  key: z.uuid(),
  name: z.string().min(1).max(1000),
  mime: z.enum(RECEIPT_MIME_TYPES),
  size: z.number().int().min(1).max(MAX_RECEIPT_SIZE),
});
const reservation = z.object({
  id: z.uuid(),
  path: z.string().min(1),
  mime: z.enum(RECEIPT_MIME_TYPES),
  status: z.enum(["pending", "verified", "rejected", "expired"]),
  created_at: z.string(),
  replayed: z.boolean(),
});
const confirmation = z.object({
  status: z.enum(["pending", "verified", "rejected", "expired"]),
  reason: z.string().nullable().optional(),
});
// Signing is only allowed during the first hour of a reservation (see
// private.can_upload_receipt); leave a margin for clock skew.
const SIGNING_WINDOW_MS = 55 * 60 * 1000;
const NOT_CONFIGURED =
  "La verificación de comprobantes no está configurada en el servidor. El archivo queda pendiente; avisa al administrador.";
const UNAVAILABLE =
  "No fue posible preparar la carga. El movimiento sigue registrado; vuelve a intentarlo.";

export async function reserveReceiptUpload(
  input: unknown,
): Promise<ReserveReceiptResult> {
  const { supabase } = await requireUser();
  const parsed = reserveInput.safeParse(input);
  if (!parsed.success)
    return {
      error:
        "Selecciona el movimiento y un comprobante JPG, PNG o PDF de máximo 10 MB.",
    };
  const declared = validateDeclaredReceipt(parsed.data);
  if (!declared.ok) return { error: declared.error };
  const { data, error } = await supabase.rpc("reserve_receipt", {
    p_movement: parsed.data.movement,
    p_name: declared.value.name,
    p_mime: declared.value.mime,
    p_size: declared.value.size,
    p_key: parsed.data.key,
  });
  if (error) return { error: publicError(error) };
  const reserved = reservation.safeParse(data);
  if (!reserved.success) return { error: UNAVAILABLE };
  const r = reserved.data;
  if (r.status === "verified") return { receiptId: r.id, state: "verified" };
  if (r.status === "rejected")
    return {
      error:
        "Este archivo ya fue rechazado en un intento anterior. Revisa el original y vuelve a cargarlo.",
      renewKey: true,
    };
  if (r.status === "expired")
    return {
      error: "La reserva anterior venció. Vuelve a cargar el comprobante.",
      renewKey: true,
    };
  if (r.replayed) {
    // A retry may arrive after the bytes were already stored.
    try {
      const { data: stored } = await supabase.storage
        .from(BUCKET)
        .exists(r.path);
      if (stored) return { receiptId: r.id, state: "uploaded" };
    } catch {
      return { error: UNAVAILABLE };
    }
    if (Date.now() - Date.parse(r.created_at) > SIGNING_WINDOW_MS)
      return {
        error: "La reserva anterior venció. Vuelve a cargar el comprobante.",
        renewKey: true,
      };
  }
  // Signed with the user's session: Storage evaluates the INSERT policy
  // (private.can_upload_receipt) for this exact path before issuing a token.
  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(r.path);
  if (signError || !signed?.signedUrl) return { error: UNAVAILABLE };
  return {
    receiptId: r.id,
    state: "upload",
    signedUrl: signed.signedUrl,
    mime: r.mime,
  };
}

export async function confirmReceiptUpload(
  receipt: unknown,
): Promise<ConfirmReceiptResult> {
  const { supabase, user } = await requireUser();
  const id = z.uuid().safeParse(receipt);
  if (!id.success) return { error: "Comprobante no válido." };
  const { data: row, error } = await supabase
    .from("receipts")
    .select(
      "id,object_path,mime_type,size_bytes,status,status_reason,uploaded_by",
    )
    .eq("id", id.data)
    .maybeSingle();
  if (error || !row || row.uploaded_by !== user.id)
    return { error: "No encontramos la reserva de este comprobante." };
  if (row.status === "verified") return verified();
  if (row.status === "rejected")
    return { error: receiptRejectionMessage(row.status_reason) };
  if (row.status !== "pending")
    return {
      error: "La reserva venció. Vuelve a cargar el comprobante.",
    };
  // Fail closed: without the signing secret the verdict cannot be signed and
  // confirm_receipt would reject it (R-01).
  const secret = receiptVerificationSecret();
  if (!secret) {
    logServer("error", "receipt.verification_not_configured");
    return { error: NOT_CONFIGURED };
  }
  const signer = { secret, user: user.id };
  // Read the stored object with the user's session (author-only read policy
  // for unverified receipts) and check the real bytes.
  const { data: blob, error: downloadError } = await supabase.storage
    .from(BUCKET)
    .download(row.object_path);
  if (downloadError || !blob)
    return {
      error:
        "El archivo todavía no aparece en el almacenamiento privado. Vuelve a intentarlo en unos segundos.",
      retry: true,
    };
  if (blob.size > MAX_RECEIPT_SIZE)
    return finish(supabase, signer, row, null, blob.size, "too_large");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const inspection = inspectReceipt(bytes, {
    mime: row.mime_type,
    size: row.size_bytes,
  });
  return finish(
    supabase,
    signer,
    row,
    inspection.ok ? inspection.mime : null,
    bytes.length,
    inspection.ok ? null : inspection.problem,
  );
}

type Session = Awaited<ReturnType<typeof requireUser>>["supabase"];
async function finish(
  supabase: Session,
  signer: { secret: string; user: string },
  row: { id: string; object_path: string },
  detected: ReceiptMime | null,
  size: number,
  problem: keyof typeof receiptProblemMessages | null,
): Promise<ConfirmReceiptResult> {
  // The database only accepts a verdict signed by this server (R-01).
  const signature = signReceiptVerdict(signer.secret, {
    receipt: row.id,
    detectedMime: detected,
    size,
    user: signer.user,
  });
  const { data, error } = await supabase.rpc("confirm_receipt", {
    p_receipt: row.id,
    p_detected_mime: detected,
    p_size: size,
    p_signature: signature,
  });
  if (error) {
    if (error.message.includes("RECEIPT_NOT_UPLOADED"))
      return { error: publicError(error), retry: true };
    return { error: publicError(error) };
  }
  const outcome = confirmation.safeParse(data);
  if (!outcome.success)
    return { error: "No fue posible verificar el comprobante." };
  revalidatePath("/", "layout");
  if (outcome.data.status === "verified") return verified();
  if (outcome.data.status === "rejected") {
    // Best effort: the author may delete a rejected object (storage policy
    // receipt_object_discard). Even if this fails, nobody else can read it.
    await supabase.storage
      .from(BUCKET)
      .remove([row.object_path])
      .catch(() => undefined);
    return {
      error: problem
        ? receiptProblemMessages[problem]
        : receiptRejectionMessage(outcome.data.reason ?? null),
    };
  }
  return { error: "La reserva venció. Vuelve a cargar el comprobante." };
}

function verified(): ConfirmReceiptResult {
  return {
    success: "Comprobante verificado y guardado en almacenamiento privado.",
  };
}
