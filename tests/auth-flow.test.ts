import { describe, expect, it } from "vitest";
import {
  canSetPasswordWithoutCurrent,
  destinationAfterConfirm,
  parseCallback,
  parsePending,
  RECOVERY_WINDOW_SECONDS,
  serializePending,
  sessionIdFromAccessToken,
} from "../src/lib/auth-flow";

const hash = "a".repeat(56);
const q = (s: string) => new URLSearchParams(s);

describe("callback de enlaces de correo", () => {
  it("acepta las plantillas existentes con token_hash, sin consumir el token", () => {
    expect(
      parseCallback(q(`token_hash=${hash}&type=invite&next=/auth/password`)),
    ).toEqual({ kind: "otp", tokenHash: hash, type: "invite" });
    expect(parseCallback(q(`token_hash=${hash}&type=recovery`))).toEqual({
      kind: "otp",
      tokenHash: hash,
      type: "recovery",
    });
  });

  it("solo admite invite o recovery", () => {
    for (const type of ["signup", "magiclink", "email_change", "email", ""])
      expect(parseCallback(q(`token_hash=${hash}&type=${type}`))).toBeNull();
  });

  it("rechaza tokens malformados, errores de Supabase y parámetros vacíos", () => {
    expect(parseCallback(q("token_hash=<script>&type=invite"))).toBeNull();
    expect(parseCallback(q("error=access_denied&code=abcdefgh1"))).toBeNull();
    expect(parseCallback(q(""))).toBeNull();
  });

  it("limita next a /auth/password o /panel", () => {
    const code = "8f1c1d2e-0000-4000-8000-000000000000";
    expect(parseCallback(q(`code=${code}&next=/auth/password`))).toMatchObject({
      kind: "code",
      next: "/auth/password",
    });
    for (const next of ["https://evil.example", "//evil.example", "/empresas"])
      expect(
        parseCallback(q(`code=${code}&next=${encodeURIComponent(next)}`)),
      ).toMatchObject({ next: "/panel" });
  });

  it("los enlaces de invitación o recuperación llevan a /auth/password", () => {
    expect(
      destinationAfterConfirm({ kind: "otp", tokenHash: hash, type: "invite" }),
    ).toBe("/auth/password");
    expect(
      destinationAfterConfirm({
        kind: "code",
        code: "abcdefgh",
        next: "/panel",
      }),
    ).toBe("/panel");
  });

  it("la cookie pendiente se vuelve a validar al leerla", () => {
    const pending = {
      kind: "otp",
      tokenHash: hash,
      type: "recovery",
    } as const;
    expect(parsePending(serializePending(pending))).toEqual(pending);
    expect(parsePending(undefined)).toBeNull();
    expect(parsePending("no-es-base64-json")).toBeNull();
    const forged = btoa(
      JSON.stringify({ kind: "otp", tokenHash: hash, type: "signup" }),
    );
    expect(parsePending(forged)).toBeNull();
    const redirect = btoa(
      JSON.stringify({ kind: "code", code: "abcdefgh", next: "//evil" }),
    );
    expect(parsePending(redirect)).toBeNull();
  });
});

describe("modo recuperación para cambiar la contraseña", () => {
  const now = 1_800_000_000;
  const claims = (amr: unknown, session_id = "sess-1") => ({ session_id, amr });

  it("se permite con cookie ligada a la sesión y amr reciente de enlace", () => {
    expect(
      canSetPasswordWithoutCurrent(
        claims([{ method: "recovery", timestamp: now - 60 }]),
        "sess-1",
        now,
      ),
    ).toBe(true);
    expect(
      canSetPasswordWithoutCurrent(
        claims([{ method: "invite", timestamp: now - 10 }]),
        "sess-1",
        now,
      ),
    ).toBe(true);
  });

  it("no basta con la cookie: exige amr firmado por Supabase", () => {
    expect(
      canSetPasswordWithoutCurrent(
        claims([{ method: "password", timestamp: now }]),
        "sess-1",
        now,
      ),
    ).toBe(false);
    expect(
      canSetPasswordWithoutCurrent(claims(["recovery"]), "sess-1", now),
    ).toBe(false);
  });

  it("rechaza cookies de otra sesión, ausentes o enlaces viejos", () => {
    const recent = claims([{ method: "recovery", timestamp: now }]);
    expect(canSetPasswordWithoutCurrent(recent, "otra", now)).toBe(false);
    expect(canSetPasswordWithoutCurrent(recent, undefined, now)).toBe(false);
    expect(canSetPasswordWithoutCurrent(null, "sess-1", now)).toBe(false);
    expect(
      canSetPasswordWithoutCurrent(
        claims([
          { method: "recovery", timestamp: now - RECOVERY_WINDOW_SECONDS - 1 },
        ]),
        "sess-1",
        now,
      ),
    ).toBe(false);
  });

  it("lee session_id del token de acceso", () => {
    const payload = btoa(JSON.stringify({ session_id: "sess-9" }))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    expect(sessionIdFromAccessToken(`h.${payload}.s`)).toBe("sess-9");
    expect(sessionIdFromAccessToken("invalido")).toBeNull();
  });
});
