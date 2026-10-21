import { expect, it } from "vitest";
import {
  csvAmount,
  csvText,
  detailRange,
  parseReportFilters,
  reportCSV,
  reportFilters,
  type FinancialReport,
} from "../src/lib/domain/reports";
it("neutraliza fórmulas CSV en campos de texto y conserva comillas", () => {
  expect(csvText('=IMPORTXML("x")')).toBe('"\'=IMPORTXML(""x"")"');
  expect(csvText("  +1")).toBe('"\'  +1"');
  expect(csvText("Oficina, Bogotá")).toBe('"Oficina, Bogotá"');
});
it("valida fechas y UUID de filtros", () => {
  expect(
    reportFilters.safeParse({ from: "2026-10-20", to: "2026-10-01" }).success,
  ).toBe(false);
  expect(
    reportFilters.safeParse({
      from: "2026-10-01",
      to: "2026-10-20",
      fund: "ajeno",
    }).success,
  ).toBe(false);
});
it("traduce filtros inválidos a un mensaje en español sin lanzar", () => {
  const base = { from: "2026-10-01", to: "2026-10-20" };
  const error = (raw: Record<string, string>) => {
    const r = parseReportFilters(raw);
    expect(r.ok).toBe(false);
    return r.ok ? "" : r.error;
  };
  expect(error({ ...base, from: "2026-13-01" })).toMatch(
    /fecha inicial no es válida.*AAAA-MM-DD/,
  );
  expect(error({ from: "2026-10-20", to: "2026-10-01" })).toMatch(
    /anterior o igual a la fecha de corte/,
  );
  expect(error({ from: "2025-01-01", to: "2026-10-20" })).toMatch(
    /como máximo 366 días/,
  );
  expect(error({ ...base, fund: "ajeno" })).toMatch(/fondo seleccionado/);
  expect(error({ ...base, kind: "robo" })).toMatch(/tipo de movimiento/);
  expect(error({ ...base, author: "ana" })).toMatch(/UUID/);
  expect(error({ ...base, offset: "-1" })).toMatch(/página/);
  for (const message of [
    error({ ...base, from: "" }),
    error({ ...base, review: "x" }),
  ]) {
    expect(message).toMatch(/Revisa los filtros/);
    expect(message).not.toMatch(/Invalid|expected|received/);
  }
});
it("acepta un año bisiesto completo (366 días) y la página por defecto", () => {
  const r = parseReportFilters({ from: "2028-01-01", to: "2029-01-01" });
  expect(r.ok).toBe(true);
  expect(r.ok && r.value.offset).toBe(0);
  expect(parseReportFilters({ from: "2026-01-01", to: "2027-01-03" }).ok).toBe(
    false,
  );
});
const sample: FinancialReport = {
  from: "2026-10-01",
  to: "2026-10-20",
  offset: 0,
  total_entries: 1,
  totals: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      name: "=Caja",
      company_name: "Empresa",
      opening_balance: "0",
      opening_funding: "0",
      income: "1800000000000000000",
      expenses: "900000000000000000",
      transfers_net: "-123456789012345",
      reversals_net: "0",
      closing_balance: "900000000000000000",
    },
  ],
  entries: [
    {
      entry_id: 1,
      movement_id: "00000000-0000-4000-8000-000000000002",
      fund_id: "00000000-0000-4000-8000-000000000001",
      fund_name: "=Caja",
      company_name: "Empresa",
      operation_date: "2026-10-20",
      kind: "expense",
      concept: "-cmd|' /C calc'!A0",
      review_status: "approved",
      financial_status: "reversed",
      created_by: "00000000-0000-4000-8000-000000000003",
      signed_amount: "-900000000000000000",
    },
  ],
};
it("exporta importes exactos: numéricos hasta 15 dígitos y texto sin fórmula por encima", () => {
  expect(csvAmount("-123456789012345")).toBe("-123456789012345");
  expect(csvAmount("0")).toBe("0");
  expect(csvAmount("1234567890123456")).toBe('"COP 1234567890123456"');
  expect(csvAmount("-900000000000000000")).toBe('"COP -900000000000000000"');
  expect(() => csvAmount("1e5")).toThrow();
  expect(() => csvAmount("=1+1")).toThrow();
});
it("el CSV incluye estado financiero, neutraliza fórmulas y conserva dígitos", () => {
  const csv = reportCSV(sample);
  const lines = csv.split("\r\n");
  expect(csv.startsWith("﻿")).toBe(true);
  expect(lines[3]).toBe(
    '"Empresa","\'=Caja",0,0,"COP 1800000000000000000","COP 900000000000000000",-123456789012345,0,"COP 900000000000000000"',
  );
  expect(lines[6]).toContain('"Estado financiero"');
  expect(lines[7]).toBe(
    '"2026-10-20","Empresa","\'=Caja","expense","\'-cmd|\' /C calc\'!A0","COP -900000000000000000","Reversado","approved","00000000-0000-4000-8000-000000000002"',
  );
  for (const line of lines.slice(1))
    for (const cell of line.match(/"(?:[^"]|"")*"|[^,]+/g) ?? [])
      expect(cell).not.toMatch(/^"?[=+@]/);
});
it("describe el rango del detalle sin rangos imposibles", () => {
  expect(detailRange(0, 0, 0)).toBe(
    "Sin asientos en el período con los filtros aplicados",
  );
  expect(detailRange(400, 0, 206)).toBe(
    "Sin asientos en esta página (desde la posición 401); 206 en total",
  );
  expect(detailRange(200, 6, 206)).toBe("Detalle 201 a 206 de 206");
  const csv = reportCSV({ ...sample, entries: [], total_entries: 0 });
  expect(csv).not.toContain("1 a 0");
  expect(csv).toContain("Sin asientos en el período");
});
