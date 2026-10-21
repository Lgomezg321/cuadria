import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validationState } from "../src/lib/validation";
import {
  loginSchema,
  passwordChangeSchema,
  recoverySchema,
} from "../src/lib/auth-schemas";
import { positiveMoneySchema } from "../src/lib/domain/money";

function messages(schema: z.ZodType, input: unknown) {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("se esperaba un error");
  return validationState(result.error);
}

describe("mensajes de validación en español", () => {
  const movement = z.object({
    fund: z.uuid(),
    kind: z.enum(["income", "expense"]),
    amount: positiveMoneySchema,
    concept: z.string().trim().min(3).max(500),
    date: z.iso.date(),
  });

  it("devuelve un mensaje por campo y un resumen con la etiqueta", () => {
    const state = messages(movement, {
      fund: "",
      kind: "otro",
      amount: "1.000",
      concept: "a",
      date: "21/10/2026",
    });
    expect(state.fieldErrors).toEqual({
      fund: "Selecciona una opción válida.",
      kind: "Selecciona una opción válida.",
      amount: "Usa pesos enteros, sin puntos ni comas (máximo 18 dígitos).",
      concept: "Debe tener al menos 3 caracteres.",
      date: "Ingresa una fecha válida.",
    });
    expect(state.error).toBe(
      "Fondo: Selecciona una opción válida. Revisa también otros 4 campos.",
    );
  });

  it("indica campos obligatorios y longitudes máximas", () => {
    const state = messages(z.object({ note: z.string().max(5) }), {});
    expect(state.fieldErrors.note).toBe("Este campo es obligatorio.");
    expect(
      messages(z.object({ note: z.string().max(5) }), { note: "123456" })
        .fieldErrors.note,
    ).toBe("Debe tener como máximo 5 caracteres.");
    expect(
      messages(z.object({ amount: positiveMoneySchema }), { amount: "0" })
        .error,
    ).toBe("Valor: El valor debe ser mayor que cero.");
  });
});

describe("esquemas de autenticación", () => {
  it("valida correo y contraseña del ingreso", () => {
    const state = messages(loginSchema, { email: "x", password: "" });
    expect(state.fieldErrors).toEqual({
      email: "Ingresa un correo electrónico válido.",
      password: "Ingresa tu contraseña.",
    });
    expect(recoverySchema.safeParse({ email: "a@b.co" }).success).toBe(true);
  });

  it("exige la contraseña actual fuera del modo recuperación", () => {
    const input = { password: "x".repeat(12), confirmPassword: "x".repeat(12) };
    expect(passwordChangeSchema(true).safeParse(input).success).toBe(true);
    expect(
      messages(passwordChangeSchema(false), input).fieldErrors.currentPassword,
    ).toBe("Ingresa tu contraseña actual.");
  });

  it("exige 12 caracteres y que la confirmación coincida", () => {
    expect(
      messages(passwordChangeSchema(true), {
        password: "corta",
        confirmPassword: "corta",
      }).fieldErrors.password,
    ).toBe("Utiliza una contraseña de al menos 12 caracteres.");
    expect(
      messages(passwordChangeSchema(true), {
        password: "x".repeat(12),
        confirmPassword: "y".repeat(12),
      }).fieldErrors.confirmPassword,
    ).toBe("Las contraseñas no coinciden.");
  });
});
