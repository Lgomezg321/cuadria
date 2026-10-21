import { z } from "zod";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { sanitizeReceiptName } from "@/lib/domain/receipt";
// Signs on demand after re-authorizing with the user's session. Only verified
// receipts are served. Images open inline; anything else (PDF) is served as an
// attachment so it is never rendered inside the application's browsing context.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { supabase } = await requireUser();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return notFound("No encontrado");
  const { data, error } = await supabase
    .from("receipts")
    .select("object_path,mime_type,original_name")
    .eq("id", id.data)
    .eq("status", "verified")
    .maybeSingle();
  if (error || !data) return notFound("No encontrado");
  const inline =
    data.mime_type === "image/jpeg" || data.mime_type === "image/png";
  const { data: link, error: signError } = await supabase.storage
    .from("receipts")
    .createSignedUrl(
      data.object_path,
      60,
      inline
        ? undefined
        : { download: sanitizeReceiptName(data.original_name) || true },
    );
  if (signError || !link)
    return notFound("Archivo no disponible en el almacenamiento privado.");
  return NextResponse.redirect(link.signedUrl, {
    status: 303,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
function notFound(message: string) {
  return new NextResponse(message, {
    status: 404,
    headers: { "Cache-Control": "private, no-store" },
  });
}
