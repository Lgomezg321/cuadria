import { requireUser } from "@/lib/auth";
export async function Receipts({ movement }: { movement: string }) {
  const { supabase } = await requireUser();
  const { data, error } = await supabase
    .from("receipts")
    .select("id,original_name")
    .eq("movement_id", movement);
  if (error)
    return (
      <p className="text-sm text-red-800">
        No fue posible consultar los comprobantes.
      </p>
    );
  if (!data?.length)
    return <p className="text-xs text-amber-800">Sin comprobantes adjuntos.</p>;
  return (
    <ul className="space-y-2">
      {data.map((r) => (
        <li key={r.id}>
          <a
            href={`/comprobantes/${r.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-emerald-800 underline"
          >
            {r.original_name} ↗
          </a>
        </li>
      ))}
    </ul>
  );
}
