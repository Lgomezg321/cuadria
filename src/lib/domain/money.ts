import { z } from "zod";
export const moneySchema = z
  .string()
  .regex(
    /^(0|[1-9][0-9]{0,17})$/,
    "Usa pesos enteros, sin puntos ni comas (máximo 18 dígitos).",
  );
export const positiveMoneySchema = moneySchema.refine(
  // zod keeps running refinements after the regex fails: never BigInt("1.000").
  (v) => !/^(0|[1-9][0-9]{0,17})$/.test(v) || BigInt(v) > 0n,
  "El valor debe ser mayor que cero.",
);
export function formatCOP(value: string | bigint): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(BigInt(value));
}
export function sumCOP(values: string[]): string {
  return values.reduce((a, b) => a + BigInt(b), 0n).toString();
}
export function bogotaDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
