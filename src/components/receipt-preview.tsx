import Image from "next/image";
import { requireUser } from "@/lib/auth";
export async function ReceiptPreview({ movement }: { movement: string }) {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("receipts")
    .select("id,original_name,mime_type,object_path")
    .eq("movement_id", movement)
    .order("created_at")
    .limit(20);
  if (error) return <p>No fue posible consultar los comprobantes.</p>;
  if (!data?.length)
    return (
      <p className="text-sm text-stone-500">
        Este movimiento no tiene comprobantes adjuntos.
      </p>
    );
  const files = await Promise.all(
    data.map(async (r) => {
      const { data: link } = await supabase.storage
        .from("receipts")
        .createSignedUrl(r.object_path, 60);
      return { ...r, url: link?.signedUrl };
    }),
  );
  return (
    <div className="space-y-6">
      <p className="text-xs leading-5 text-stone-500">
        Vista de hasta 20 documentos. Los enlaces son privados y vencen en 60
        segundos; vuelve a abrir el movimiento para renovarlos.
      </p>
      {files.map((r) => (
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
          {!r.url ? (
            <p className="p-5 text-sm text-amber-800">
              Archivo no disponible; la carga puede estar pendiente.
            </p>
          ) : r.mime_type === "application/pdf" ? (
            <iframe
              src={r.url}
              title={`Comprobante ${r.original_name}`}
              referrerPolicy="no-referrer"
              className="h-[600px] w-full"
            />
          ) : (
            <Image
              src={r.url}
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
