import "server-only";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  parseReportFilters,
  reportSchema,
  type FinancialReport,
} from "@/lib/domain/reports";
import { describeError, logServer } from "@/lib/log";

export const REPORT_UNAVAILABLE_MESSAGE =
  "No fue posible generar el reporte en este momento. Vuelve a intentarlo en unos minutos.";

export type ReportResult =
  | { ok: true; report: FinancialReport }
  | { ok: false; status: 400 | 503; error: string };

/**
 * Authenticates first (requireUser redirects to /login without a session),
 * then validates the filters and runs the report with the user's session.
 * Invalid filters are an expected outcome (400 with a Spanish message), never
 * an exception that ends in the error screen or a 500.
 */
export async function loadReport(
  raw: Record<string, string | undefined>,
): Promise<ReportResult> {
  const { supabase } = await requireUser();
  const filters = parseReportFilters(raw);
  if (!filters.ok) return { ok: false, status: 400, error: filters.error };
  const v = filters.value;
  const { data, error } = await supabase.rpc("financial_report", {
    p_company: v.company || null,
    p_fund: v.fund || null,
    p_from: v.from,
    p_to: v.to,
    p_kind: v.kind || null,
    p_review: v.review || null,
    p_category: v.category || null,
    p_author: v.author || null,
    p_offset: v.offset,
  });
  if (error) {
    if (error.message.includes("INVALID_REPORT_RANGE"))
      return {
        ok: false,
        status: 400,
        error:
          "El período no es válido: usa un rango de hasta 366 días con la fecha inicial anterior o igual al corte.",
      };
    logServer("error", "report.failed", describeError(error));
    return { ok: false, status: 503, error: REPORT_UNAVAILABLE_MESSAGE };
  }
  const report = reportSchema.safeParse(data);
  if (!report.success) {
    logServer("error", "report.invalid_shape", {
      issues: report.error.issues.length,
    });
    return { ok: false, status: 503, error: REPORT_UNAVAILABLE_MESSAGE };
  }
  return { ok: true, report: report.data };
}

/** Plain-text error for the CSV/PDF downloads (never cached). */
export function reportErrorResponse(result: {
  status: number;
  error: string;
}): NextResponse {
  return new NextResponse(result.error, {
    status: result.status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}
