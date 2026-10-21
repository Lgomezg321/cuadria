import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  generateNonce,
  TURNSTILE_ORIGIN,
} from "../src/lib/security-headers";

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split("; ").map((part) => {
      const [name, ...values] = part.split(" ");
      return [name, values];
    }),
  );
}

describe("Content-Security-Policy", () => {
  const base = buildContentSecurityPolicy({
    nonce: "abc123==",
    supabaseUrl: "https://ref.supabase.co/",
  });
  const csp = directives(base);

  it("usa nonce y strict-dynamic sin unsafe-inline ni unsafe-eval en scripts", () => {
    expect(csp.get("script-src")).toEqual([
      "'self'",
      "'nonce-abc123=='",
      "'strict-dynamic'",
    ]);
  });

  it("incluye las directivas de endurecimiento", () => {
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("form-action")).toEqual(["'self'"]);
    expect(csp.has("upgrade-insecure-requests")).toBe(false);
  });

  it("permite el origen de Supabase para imágenes, iframes y conexiones", () => {
    for (const name of ["img-src", "frame-src", "connect-src"])
      expect(csp.get(name)).toContain("https://ref.supabase.co");
    expect(base).not.toContain(TURNSTILE_ORIGIN);
  });

  it("agrega Turnstile solo cuando está activo", () => {
    const withCaptcha = directives(
      buildContentSecurityPolicy({ nonce: "n", turnstile: true }),
    );
    expect(withCaptcha.get("script-src")).toContain(TURNSTILE_ORIGIN);
    expect(withCaptcha.get("frame-src")).toContain(TURNSTILE_ORIGIN);
  });

  it("ignora URLs de Supabase inválidas y solo permite unsafe-eval en desarrollo", () => {
    const dev = directives(
      buildContentSecurityPolicy({
        nonce: "n",
        supabaseUrl: "javascript:alert(1)",
        development: true,
        upgradeInsecureRequests: true,
      }),
    );
    expect(dev.get("img-src")).toEqual(["'self'", "blob:", "data:"]);
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(dev.has("upgrade-insecure-requests")).toBe(true);
  });

  it("genera nonces distintos de 128 bits", () => {
    const a = generateNonce();
    expect(atob(a)).toHaveLength(16);
    expect(generateNonce()).not.toBe(a);
  });
});
