import { expect, it } from "vitest";
import { csvText, reportFilters } from "../src/lib/domain/reports";
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
