import { formatCOP } from "@/lib/domain/money";
import type { Snapshot } from "@/lib/data";
export const kindLabels: Record<string, string> = {
  income: "Ingreso",
  expense: "Egreso",
  transfer: "Transferencia",
  opening: "Apertura",
  reversal: "Reversión",
};
export const reviewLabels: Record<string, string> = {
  pending: "Pendiente",
  approved: "Aprobado",
  observed: "Observado",
  rejected: "Rechazado",
};
export function Select({
  label,
  name,
  options,
  optional = false,
  defaultValue = "",
}: {
  label: string;
  name: string;
  options: { id: string; name: string }[];
  optional?: boolean;
  defaultValue?: string;
}) {
  return (
    <label className="field">
      {label}
      <select name={name} required={!optional} defaultValue={defaultValue}>
        <option value="">
          {optional ? "Sin seleccionar" : "Selecciona una opción"}
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
export function MovementTable({ data }: { data: Snapshot }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
      <table className="w-full whitespace-nowrap">
        <caption>Últimos movimientos · máximo 100 registros</caption>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Fondo / concepto</th>
            <th>Tipo</th>
            <th>Valor</th>
            <th>Contabilización</th>
            <th>Revisión</th>
          </tr>
        </thead>
        <tbody>
          {data.movements.map((m) => (
            <tr key={m.id}>
              <td>{m.operation_date}</td>
              <td>
                <p className="font-medium">
                  {data.funds.find((f) => f.id === m.fund_id)?.name ||
                    "Fondo de origen"}
                </p>
                <p className="mt-1 max-w-xs truncate text-xs text-stone-500">
                  {m.concept}
                </p>
              </td>
              <td>{kindLabels[m.kind]}</td>
              <td className="font-mono">{formatCOP(m.amount)}</td>
              <td>
                {m.financial_status === "reversed"
                  ? "Reversado"
                  : "Contabilizado"}
              </td>
              <td>
                <span className="rounded-full bg-stone-100 px-2 py-1 text-xs">
                  {reviewLabels[m.review_status]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
