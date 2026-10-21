import { z } from "zod";
const optionalUuid = z.union([z.uuid(), z.literal("")]).optional();
/** Longest period accepted by public.financial_report (p_to - p_from). */
export const MAX_REPORT_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;
function daysBetween(from: string, to: string): number {
  return (
    (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY_MS
  );
}
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
  .refine((v) => v.from <= v.to, {
    message: "La fecha inicial debe ser anterior o igual a la fecha de corte.",
    path: ["to"],
  })
  .refine((v) => !(daysBetween(v.from, v.to) > MAX_REPORT_DAYS), {
    message: `El período del reporte puede abarcar como máximo ${MAX_REPORT_DAYS} días.`,
    path: ["to"],
  });
export type ReportFilters = z.infer<typeof reportFilters>;

const filterProblems: Record<string, string> = {
  from: "La fecha inicial no es válida. Usa el formato AAAA-MM-DD.",
  to: "La fecha de corte no es válida. Usa el formato AAAA-MM-DD.",
  company: "La empresa seleccionada no es válida.",
  fund: "El fondo seleccionado no es válido.",
  kind: "El tipo de movimiento seleccionado no es válido.",
  review: "El estado de revisión seleccionado no es válido.",
  category: "La categoría seleccionada no es válida.",
  author: "El empleado debe indicarse con su identificador (UUID) completo.",
  offset: "La página solicitada del detalle no es válida.",
};

/**
 * Validates report filters coming from a URL. Invalid input never reaches the
 * database; the message is in Spanish and names the first problem found.
 */
export function parseReportFilters(
  raw: Record<string, string | undefined>,
): { ok: true; value: ReportFilters } | { ok: false; error: string } {
  const parsed = reportFilters.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issue = parsed.error.issues[0];
  const field = String(issue?.path[0] ?? "");
  const message =
    issue?.code === "custom"
      ? issue.message
      : (filterProblems[field] ?? "Los filtros del reporte no son válidos.");
  return {
    ok: false,
    error: `${message} Revisa los filtros e inténtalo de nuevo.`,
  };
}
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
