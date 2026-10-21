import type { ReceiptStatus } from "@/lib/domain/receipt";
export type ReceiptListItem = {
  id: string;
  movement_id: string;
  original_name: string;
  status: ReceiptStatus;
};
const pendingLabels: Partial<Record<ReceiptStatus, string>> = {
  pending: "pendiente de verificación",
  rejected: "rechazado: no cuenta como comprobante",
};
// Presentational list. The page loads all receipts for the listed movements in
// a single query (no N+1). Only verified receipts are links and count as evidence.
export function Receipts({ items }: { items: ReceiptListItem[] }) {
  const visible = items.filter((r) => r.status !== "expired");
  if (!visible.length)
    return <p className="text-xs text-amber-800">Sin comprobantes adjuntos.</p>;
  return (
    <ul className="space-y-2">
      {!visible.some((r) => r.status === "verified") && (
        <li className="text-xs text-amber-800">
          Sin comprobantes verificados.
        </li>
      )}
      {visible.map((r) => (
        <li key={r.id} className="break-words text-sm">
          {r.status === "verified" ? (
            <a
              href={`/comprobantes/${r.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-800 underline"
            >
              {r.original_name} ↗
            </a>
          ) : (
            <span className="text-stone-500">
              {r.original_name} · {pendingLabels[r.status]}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
