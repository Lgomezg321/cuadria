import { it, expect } from "vitest";
import { detectReceiptMime } from "../src/lib/domain/receipt";
it("rechaza un archivo HTML disfrazado de PDF", () =>
  expect(
    detectReceiptMime(new TextEncoder().encode("<html>archivo</html>")),
  ).toBeNull());
it("detecta PDF, PNG y JPEG por firma", () => {
  expect(detectReceiptMime(new TextEncoder().encode("%PDF-1.7"))).toBe(
    "application/pdf",
  );
  expect(
    detectReceiptMime(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
  ).toBe("image/png");
  expect(detectReceiptMime(new Uint8Array([255, 216, 255]))).toBe("image/jpeg");
});
