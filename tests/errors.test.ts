import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { publicError, passwordUpdateError, RATE_LIMIT_MESSAGE } =
  await import("../src/lib/errors");
const { describeError, scrub } = await import("../src/lib/log");

afterEach(() => vi.restoreAllMocks());

describe("publicError", () => {
  it("traduce códigos de negocio sin registrar ruido", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(publicError({ message: "INSUFFICIENT_FUNDS" })).toBe(
      "El fondo no tiene saldo suficiente.",
    );
    expect(publicError({ message: "x", code: "23505" })).toBe(
      "Ya existe un registro con estos datos.",
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("registra en el servidor los errores no mapeados sin datos sensibles", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      publicError({
        message: "fallo para ana@empresa.co por 1.250.000 con eyJa.eyJb.c",
        code: "XX000",
      }),
    ).toMatch(/No fue posible guardar la operación/);
    expect(warn).toHaveBeenCalledOnce();
    const line = String(warn.mock.calls[0][0]);
    expect(JSON.parse(line)).toMatchObject({
      level: "warn",
      event: "rpc.unmapped_error",
      code: "XX000",
    });
    expect(line).not.toContain("ana@empresa.co");
    expect(line).not.toContain("1.250.000");
    expect(line).not.toContain("eyJa");
  });
});

describe("publicError compara códigos completos (R-04)", () => {
  it("un código corto no captura uno más largo que lo contiene", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(publicError({ message: "INVALID_STATUS_TRANSITION" })).toBe(
      "El estado actual del movimiento no admite ese cambio.",
    );
    expect(publicError({ message: "INVALID_STATUS" })).toBe(
      "Selecciona un estado válido.",
    );
    expect(
      publicError({ message: "ERROR: PERIOD_CLOSED (P0001)", code: "P0001" }),
    ).toBe("La fecha pertenece a un período cerrado.");
    expect(publicError({ message: "RECEIPT_SIGNATURE_INVALID" })).toMatch(
      /verificación del comprobante/,
    );
    // Codes that are not exact tokens are not mapped.
    expect(publicError({ message: "XFORBIDDEN_Y" })).toMatch(
      /No fue posible guardar la operación/,
    );
    expect(warn).toHaveBeenCalledOnce();
  });
  it("conserva los fragmentos de PostgreSQL", () => {
    expect(
      publicError({
        message:
          'value for domain public.cop violates check constraint "cop_check"',
        code: "23514",
      }),
    ).toMatch(/18 dígitos/);
    expect(
      publicError({
        message: 'new row violates check constraint "x"',
        code: "23514",
      }),
    ).toMatch(/reglas de validación/);
  });
});

describe("errores de Auth", () => {
  it("traduce los errores de cambio de contraseña", () => {
    expect(passwordUpdateError({ code: "same_password" })).toMatch(/distinta/);
    expect(passwordUpdateError({ code: "weak_password" })).toMatch(/12/);
    expect(passwordUpdateError({ status: 429 })).toBe(RATE_LIMIT_MESSAGE);
    expect(passwordUpdateError({ code: "reauthentication_needed" })).toMatch(
      /confirmar tu identidad/,
    );
  });

  it("resume errores sin mensajes largos ni secretos", () => {
    expect(scrub("token " + "a".repeat(40))).toBe("token [secreto]");
    expect(
      describeError({
        name: "AuthApiError",
        status: 500,
        code: "x",
        message: "m",
      }),
    ).toEqual({ name: "AuthApiError", status: 500, code: "x", message: "m" });
    expect(describeError("texto")).toEqual({ message: "texto" });
  });
});
