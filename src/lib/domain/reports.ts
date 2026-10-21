import { z } from "zod";
const optionalUuid = z.union([z.uuid(), z.literal("")]).optional();
export const reportFilters = z
  .object({
    company: optionalUuid,
    fund: optionalUuid,
    from: z.iso.date(),
    to: z.iso.date(),
    kind: z
      .enum(["", "opening", "income", "expense", "transfer", "reversal"])
      .optional(),
    review: z
      .enum(["", "pending", "approved", "observed", "rejected"])
      .optional(),
    category: optionalUuid,
    author: optionalUuid,
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .refine((v) => v.from <= v.to, "El inicio debe ser anterior al corte.");
export const reportSchema = z.object({
  from: z.string(),
  to: z.string(),
  offset: z.number(),
  total_entries: z.number(),
  totals: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      company_name: z.string(),
      opening_balance: z.string(),
      opening_funding: z.string(),
      income: z.string(),
      expenses: z.string(),
      transfers_net: z.string(),
      reversals_net: z.string(),
      closing_balance: z.string(),
    }),
  ),
  entries: z.array(
    z.object({
      entry_id: z.number(),
      movement_id: z.uuid(),
      fund_id: z.uuid(),
      fund_name: z.string(),
      company_name: z.string(),
      operation_date: z.string(),
      kind: z.string(),
      concept: z.string(),
      review_status: z.string(),
      financial_status: z.string(),
      created_by: z.uuid(),
      signed_amount: z.string(),
    }),
  ),
});
export type FinancialReport = z.infer<typeof reportSchema>;
// Neutralize spreadsheet formulas in user-controlled fields, preserving numeric values.
export function csvText(value: string): string {
  const safe = /^[\s]*[=+\-@]/.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}
// Spreadsheets store numbers as IEEE doubles: integers beyond 15 significant
// digits lose precision when opened in Excel. Those amounts are exported as a
// text cell that starts with "COP " (not a number, not a formula trigger), so
// every digit survives; smaller amounts stay numeric for sums.
export const CSV_EXACT_DIGITS = 15;
export function csvAmount(value: string): string {
  if (!/^-?(0|[1-9][0-9]*)$/.test(value))
    throw new Error("Importe inválido en el reporte.");
  const digits = value.replace("-", "").length;
  return digits <= CSV_EXACT_DIGITS ? value : '"COP ' + value + '"';
}
export function detailRange(
  offset: number,
  shown: number,
  total: number,
): string {
  if (shown === 0)
    return total === 0
      ? "Sin asientos en el período con los filtros aplicados"
      : `Sin asientos en esta página (desde la posición ${offset + 1}); ${total} en total`;
  return `Detalle ${offset + 1} a ${offset + shown} de ${total}`;
}
const financialLabels: Record<string, string> = {
  posted: "Contabilizado",
  reversed: "Reversado",
};
export function reportCSV(report: FinancialReport): string {
  const rows = [
    ["CUADRIA · Reporte de fondos", report.from, report.to]
      .map(csvText)
      .join(","),
    csvText(
      `Importes en COP. Los valores de más de ${CSV_EXACT_DIGITS} dígitos se exportan como texto "COP <valor>" para que la hoja de cálculo no pierda precisión.`,
    ),
    [
      "Empresa",
      "Fondo",
      "Saldo inicial",
      "Aperturas",
      "Ingresos",
      "Egresos",
      "Transferencias netas",
      "Reversiones netas",
      "Saldo final",
    ]
      .map(csvText)
      .join(","),
  ];
  for (const f of report.totals)
    rows.push(
      [
        csvText(f.company_name),
        csvText(f.name),
        csvAmount(f.opening_balance),
        csvAmount(f.opening_funding),
        csvAmount(f.income),
        csvAmount(f.expenses),
        csvAmount(f.transfers_net),
        csvAmount(f.reversals_net),
        csvAmount(f.closing_balance),
      ].join(","),
    );
  rows.push(
    "",
    csvText(
      `${detailRange(report.offset, report.entries.length, report.total_entries)}; totales del período completo`,
    ),
    [
      "Fecha",
      "Empresa",
      "Fondo",
      "Tipo",
      "Concepto",
      "Valor neto COP",
      "Estado financiero",
      "Revisión",
      "Movimiento",
    ]
      .map(csvText)
      .join(","),
  );
  for (const e of report.entries)
    rows.push(
      [
        csvText(e.operation_date),
        csvText(e.company_name),
        csvText(e.fund_name),
        csvText(e.kind),
        csvText(e.concept),
        csvAmount(e.signed_amount),
        csvText(financialLabels[e.financial_status] ?? e.financial_status),
        csvText(e.review_status),
        csvText(e.movement_id),
      ].join(","),
    );
  return "\uFEFF" + rows.join("\r\n");
}
