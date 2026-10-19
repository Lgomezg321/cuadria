import "server-only";
import { requireUser } from "@/lib/auth";
import { reportFilters, reportSchema } from "@/lib/domain/reports";
export async function getReport(raw: Record<string, string | undefined>) {
  const v = reportFilters.parse(raw);
  const { supabase } = await requireUser();
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
  if (error)
    throw new Error(
      "No fue posible generar el reporte. Utiliza un período de hasta 366 días y verifica la conexión.",
    );
  return reportSchema.parse(data);
}
