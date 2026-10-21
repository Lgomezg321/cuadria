import { describe, it, expect } from "vitest";
import {
  detectReceiptMime,
  inspectReceipt,
  isReceiptComplete,
  receiptRejectionMessage,
  sanitizeReceiptName,
  validateDeclaredReceipt,
  MAX_RECEIPT_SIZE,
} from "../src/lib/domain/receipt";

const ascii = (text: string) => new TextEncoder().encode(text);
const concat = (...parts: (Uint8Array | number[])[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};
const PNG_HEADER = [137, 80, 78, 71, 13, 10, 26, 10];
const IEND = [0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];
const png = (body = 32) =>
  concat(PNG_HEADER, new Uint8Array(body).fill(1), IEND);
const jpeg = (body = 32) =>
  concat([255, 216, 255, 224], new Uint8Array(body).fill(7), [255, 217]);
const pdf = (body = "1 0 obj\n<<>>\nendobj\n") =>
  ascii(`%PDF-1.7\n${body}trailer\n<<>>\n%%EOF\n`);

describe("firma de comprobantes", () => {
  it("rechaza un archivo HTML disfrazado de PDF", () =>
    expect(detectReceiptMime(ascii("<html>archivo</html>"))).toBeNull());
  it("detecta PDF, PNG y JPEG por firma", () => {
    expect(detectReceiptMime(ascii("%PDF-1.7"))).toBe("application/pdf");
    expect(detectReceiptMime(new Uint8Array(PNG_HEADER))).toBe("image/png");
    expect(detectReceiptMime(new Uint8Array([255, 216, 255]))).toBe(
      "image/jpeg",
    );
  });
});

describe("inspección del archivo almacenado", () => {
  it("acepta archivos completos cuyo tipo y tamaño coinciden con la reserva", () => {
    for (const [bytes, mime] of [
      [png(), "image/png"],
      [jpeg(), "image/jpeg"],
      [pdf(), "application/pdf"],
    ] as const)
      expect(inspectReceipt(bytes, { mime, size: bytes.length })).toEqual({
        ok: true,
        mime,
      });
  });
  it("rechaza un MIME declarado distinto de la firma", () => {
    const bytes = png();
    expect(
      inspectReceipt(bytes, { mime: "application/pdf", size: bytes.length }),
    ).toMatchObject({
      ok: false,
      problem: "mime_mismatch",
      detected: "image/png",
    });
  });
  it("rechaza contenido sin firma permitida", () => {
    const bytes = ascii("<svg onload=alert(1)>");
    expect(
      inspectReceipt(bytes, { mime: "image/png", size: bytes.length }),
    ).toMatchObject({ ok: false, problem: "signature" });
  });
  it("rechaza un tamaño real distinto del reservado", () => {
    const bytes = jpeg();
    expect(
      inspectReceipt(bytes, { mime: "image/jpeg", size: bytes.length + 1 }),
    ).toMatchObject({ ok: false, problem: "size_mismatch" });
  });
  it("detecta archivos truncados", () => {
    const cases = [
      [png().slice(0, -12), "image/png"],
      [jpeg().slice(0, -2), "image/jpeg"],
      [pdf().slice(0, -8), "application/pdf"],
    ] as const;
    for (const [bytes, mime] of cases) {
      expect(isReceiptComplete(bytes, mime)).toBe(false);
      expect(inspectReceipt(bytes, { mime, size: bytes.length })).toMatchObject(
        { ok: false, problem: "truncated" },
      );
    }
  });
  it("tolera datos posteriores al marcador final de JPEG y espacios tras %%EOF", () => {
    expect(
      isReceiptComplete(concat(jpeg(), ascii("MotionPhoto")), "image/jpeg"),
    ).toBe(true);
    expect(
      isReceiptComplete(concat(pdf(), ascii("\n\n  ")), "application/pdf"),
    ).toBe(true);
  });
  it("rechaza archivos vacíos y mayores de 10 MB", () => {
    expect(
      inspectReceipt(new Uint8Array(), { mime: "image/png", size: 0 }),
    ).toMatchObject({ ok: false, problem: "empty" });
    const big = concat(png(MAX_RECEIPT_SIZE));
    expect(
      inspectReceipt(big, { mime: "image/png", size: big.length }),
    ).toMatchObject({ ok: false, problem: "too_large" });
  });
});

describe("metadatos declarados antes de reservar", () => {
  it("acepta exactamente 10 MiB y rechaza un byte más", () => {
    expect(
      validateDeclaredReceipt({
        name: "factura.pdf",
        mime: "application/pdf",
        size: MAX_RECEIPT_SIZE,
      }).ok,
    ).toBe(true);
    expect(
      validateDeclaredReceipt({
        name: "factura.pdf",
        mime: "application/pdf",
        size: MAX_RECEIPT_SIZE + 1,
      }),
    ).toEqual({ ok: false, error: "El archivo debe pesar como máximo 10 MB." });
  });
  it("rechaza MIME no permitidos, tamaños vacíos o no enteros y nombres vacíos", () => {
    expect(
      validateDeclaredReceipt({ name: "a.html", mime: "text/html", size: 10 })
        .ok,
    ).toBe(false);
    expect(
      validateDeclaredReceipt({ name: "a.png", mime: "image/png", size: 0 }).ok,
    ).toBe(false);
    expect(
      validateDeclaredReceipt({ name: "a.png", mime: "image/png", size: 1.5 })
        .ok,
    ).toBe(false);
    expect(
      validateDeclaredReceipt({ name: "    ", mime: "image/png", size: 5 }).ok,
    ).toBe(false);
  });
  it("limpia separadores, caracteres de control y longitud del nombre", () => {
    expect(sanitizeReceiptName("../../etc/pass\u0007wd.pdf")).toBe(
      ".._.._etc_pass_wd.pdf",
    );
    expect(sanitizeReceiptName("a".repeat(400))).toHaveLength(180);
  });
  it("traduce los motivos de rechazo de la base de datos", () => {
    expect(receiptRejectionMessage("metadata_size")).toMatch(/tamaño/);
    expect(receiptRejectionMessage("content")).toMatch(/JPG, PNG o un PDF/);
  });
});
