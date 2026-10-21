import { NextRequest, NextResponse } from "next/server";
import { loadReport, reportErrorResponse } from "@/lib/reports";
import { reportCSV } from "@/lib/domain/reports";
export async function GET(request: NextRequest) {
  // loadReport authenticates before reading the filters.
  const result = await loadReport(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!result.ok) return reportErrorResponse(result);
  const { report } = result;
  return new NextResponse(reportCSV(report), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cuadria-${report.from}-${report.to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
