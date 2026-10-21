import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { loadReport, reportErrorResponse } from "@/lib/reports";
import { formatCOP } from "@/lib/domain/money";
export async function GET(request: NextRequest) {
  // loadReport authenticates before reading the filters.
  const result = await loadReport(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!result.ok) return reportErrorResponse(result);
  const { report } = result;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let page = doc.addPage([595, 842]);
  let y = 790;
  const text = (value: string, size = 11) => {
    if (y < 55) {
      page = doc.addPage([595, 842]);
      y = 790;
    }
    const safe = [...value.replace(/[\r\t]/g, " ")]
      .map((c) => {
        try {
          font.encodeText(c);
          return c;
        } catch {
          return "?";
        }
      })
      .join("");
    const maxWidth = 505;
    // Wrap by glyph width, including unbroken names, so long names are preserved.
    let line = "";
    const drawLine = () => {
      if (y < 55) {
        page = doc.addPage([595, 842]);
        y = 790;
      }
      page.drawText(line, {
        x: 45,
        y,
        size,
        font,
        color: rgb(0.12, 0.2, 0.17),
      });
      y -= size + 11;
      line = "";
    };
    for (const char of safe) {
      if (char === "\n") {
        drawLine();
        continue;
      }
      if (font.widthOfTextAtSize(line + char, size) > maxWidth) drawLine();
      line += char;
    }
    if (line) drawLine();
  };
  text("CUADRIA · Resumen financiero", 20);
  text(`${report.from} a ${report.to} · COP`);
  text(
    "Totales de los fondos autorizados. Transferencias separadas de ingresos.",
    9,
  );
  y -= 15;
  for (const f of report.totals) {
    text(f.company_name + " · " + f.name, 13);
    for (const [label, value] of [
      ["Saldo inicial", f.opening_balance],
      ["Aperturas", f.opening_funding],
      ["Ingresos", f.income],
      ["Egresos", f.expenses],
      ["Transferencias netas", f.transfers_net],
      ["Reversiones netas", f.reversals_net],
      ["Saldo final", f.closing_balance],
    ])
      text(`${label}: ${formatCOP(value)}`);
    y -= 15;
  }
  const bytes = await doc.save();
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="cuadria-${report.from}-${report.to}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
