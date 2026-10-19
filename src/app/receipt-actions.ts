"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { publicError } from "@/lib/errors";
import { detectReceiptMime, MAX_RECEIPT_SIZE } from "@/lib/domain/receipt";
import type { ActionState } from "@/app/actions";
export async function uploadReceipt(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { supabase } = await requireUser();
  const movement = z.uuid().safeParse(form.get("movement"));
  const file = form.get("receipt");
  if (!movement.success || !(file instanceof File) || file.size === 0)
    return { error: "Selecciona el movimiento y un comprobante." };
  if (file.size > MAX_RECEIPT_SIZE)
    return { error: "El archivo debe pesar como máximo 10 MB." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = detectReceiptMime(bytes);
  if (!mime || mime !== file.type)
    return {
      error: "El archivo debe ser una imagen JPG, PNG o un PDF válido.",
    };
  const { data: path, error } = await supabase.rpc("reserve_receipt", {
    p_movement: movement.data,
    p_name: file.name.slice(0, 180),
    p_mime: mime,
    p_size: file.size,
  });
  if (error || typeof path !== "string")
    return {
      error: error ? publicError(error) : "No fue posible reservar el archivo.",
    };
  const { error: uploadError } = await supabase.storage
    .from("receipts")
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (uploadError)
    return {
      error:
        "El comprobante no se pudo cargar. El movimiento sigue registrado. Vuelve a intentar la carga.",
    };
  revalidatePath("/", "layout");
  return { success: "Comprobante guardado en almacenamiento privado." };
}
