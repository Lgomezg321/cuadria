import { NextRequest, NextResponse } from "next/server";
import { getReport } from "@/lib/reports";
import { reportCSV } from "@/lib/domain/reports";
export async function GET(request: NextRequest) {
  const report = await getReport(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  return new NextResponse(reportCSV(report), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cuadria-${report.from}-${report.to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
