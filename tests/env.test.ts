import { describe, expect, it } from "vitest";
import {
  appOrigin,
  hstsEnabled,
  isDeployedEnvironment,
  secureCookies,
} from "../src/lib/env";

describe("appOrigin", () => {
  it("usa localhost solo fuera de Vercel Preview/Production", () => {
    expect(appOrigin({})).toBe("http://localhost:3000");
    expect(appOrigin({ VERCEL_ENV: "development" })).toBe(
      "http://localhost:3000",
    );
  });

  it("falla con un error claro si falta la variable en Preview o Production", () => {
    for (const VERCEL_ENV of ["preview", "production"])
      expect(() => appOrigin({ VERCEL_ENV })).toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it("exige https en Preview y Production", () => {
    expect(() =>
      appOrigin({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_APP_URL: "http://cuadria.example",
      }),
    ).toThrow(/https/);
  });

  it("devuelve solo el origen y rechaza valores inválidos", () => {
    expect(
      appOrigin({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_APP_URL: "https://cuadria.example/ruta?x=1",
      }),
    ).toBe("https://cuadria.example");
    expect(() => appOrigin({ NEXT_PUBLIC_APP_URL: "no es url" })).toThrow();
    expect(() =>
      appOrigin({ NEXT_PUBLIC_APP_URL: "javascript:alert(1)" }),
    ).toThrow();
  });
});

describe("cookies y HSTS", () => {
  it("marca Secure en despliegues y con origen https, no en localhost http", () => {
    expect(secureCookies({ VERCEL_ENV: "preview" })).toBe(true);
    expect(
      secureCookies({ NEXT_PUBLIC_APP_URL: "https://cuadria.example" }),
    ).toBe(true);
    expect(
      secureCookies({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }),
    ).toBe(false);
    expect(secureCookies({ VERCEL_ENV: "development" })).toBe(false);
  });

  it("emite HSTS solo en producción", () => {
    expect(
      hstsEnabled({ NODE_ENV: "production", VERCEL_ENV: "production" }),
    ).toBe(true);
    expect(hstsEnabled({ NODE_ENV: "production", VERCEL_ENV: "preview" })).toBe(
      false,
    );
    expect(
      hstsEnabled({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100",
      }),
    ).toBe(false);
    expect(
      hstsEnabled({
        NODE_ENV: "development",
        NEXT_PUBLIC_APP_URL: "https://cuadria.example",
      }),
    ).toBe(false);
    expect(isDeployedEnvironment({ VERCEL_ENV: "production" })).toBe(true);
  });
});
