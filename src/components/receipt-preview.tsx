import Image from "next/image";
import { requireUser } from "@/lib/auth";
// Viewer for reviewers. It never embeds pre-signed URLs (which expired before
// lazily loaded images were requested, H-33): each image points to
// /comprobantes/<id>, which re-authorizes and signs on demand. PDFs are not
// embedded; they open as a download (Content-Disposition: attachment).
export async function ReceiptPreview({ movement }: { movement: string }) {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("receipts")
    .select("id,original_name,mime_type")
    .eq("movement_id", movement)
    .eq("status", "verified")
    .order("created_at")
    .limit(20);
  if (error) return <p>No fue posible consultar los comprobantes.</p>;
  if (!data?.length)
    return (
      <p className="text-sm text-stone-500">
        Este movimiento no tiene comprobantes verificados.
      </p>
    );
  return (
    <div className="space-y-6">
      <p className="text-xs leading-5 text-stone-500">
        Vista de hasta 20 documentos verificados. Cada apertura se autoriza de
        nuevo con tu sesión; los PDF se descargan para abrirlos fuera del
        navegador de la aplicación.
      </p>
      {data.map((r) => (
        <figure
          key={r.id}
          className="overflow-hidden rounded-xl border border-stone-200 bg-stone-50"
        >
          <figcaption className="break-words border-b p-3 text-sm">
            <a
              href={`/comprobantes/${r.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-800 underline"
            >
              {r.original_name} ↗
            </a>
          </figcaption>
          {r.mime_type === "application/pdf" ? (
            <p className="p-5 text-sm text-stone-600">
              Documento PDF.{" "}
              <a
                href={`/comprobantes/${r.id}`}
                className="text-emerald-800 underline"
              >
                Descargar para revisarlo
              </a>
              .
            </p>
          ) : (
            <Image
              src={`/comprobantes/${r.id}`}
              alt={`Comprobante ${r.original_name}`}
              width={900}
              height={1200}
              unoptimized
              referrerPolicy="no-referrer"
              className="h-auto max-h-[800px] w-full object-contain"
            />
          )}
        </figure>
      ))}
    </div>
  );
}
