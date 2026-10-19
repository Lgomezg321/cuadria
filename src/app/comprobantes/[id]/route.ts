import { z } from "zod";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { supabase } = await requireUser();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new NextResponse("No encontrado", { status: 404 });
  const { data, error } = await supabase
    .from("receipts")
    .select("object_path")
    .eq("id", id.data)
    .maybeSingle();
  if (error || !data) return new NextResponse("No encontrado", { status: 404 });
  const { data: link, error: signError } = await supabase.storage
    .from("receipts")
    .createSignedUrl(data.object_path, 60);
  if (signError || !link)
    return new NextResponse(
      "Archivo no disponible. La carga puede estar pendiente.",
      { status: 404 },
    );
  return NextResponse.redirect(link.signedUrl, {
    status: 303,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
