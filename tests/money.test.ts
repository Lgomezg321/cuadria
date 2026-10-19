import { describe, it, expect } from "vitest";
import {
  moneySchema,
  positiveMoneySchema,
  sumCOP,
  formatCOP,
} from "../src/lib/domain/money";
describe("COP exacto", () => {
  it("conserva enteros por encima de la precisión de Number", () => {
    expect(sumCOP(["9007199254740993", "2"])).toBe("9007199254740995");
    expect(formatCOP("9007199254740993")).toContain("9.007.199.254.740.993");
  });
  it.each(["1.5", "1e3", "-1", "01", "1,000", "1000000000000000000", ""])(
    "rechaza %s",
    (v) => expect(moneySchema.safeParse(v).success).toBe(false),
  );
  it("permite cero para un arqueo y no para movimientos", () => {
    expect(moneySchema.parse("0")).toBe("0");
    expect(positiveMoneySchema.safeParse("0").success).toBe(false);
  });
});
