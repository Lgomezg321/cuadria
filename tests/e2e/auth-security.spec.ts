import { test, expect } from "@playwright/test";

const tokenHash = "a".repeat(56);

test("CSP con nonce sin violaciones al hidratar", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text()))
      violations.push(message.text());
  });
  const response = await page.goto("/login");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(response?.headers()["strict-transport-security"]).toBeUndefined();
  // Browsers hide nonce attributes from selectors; the property keeps it.
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  expect(
    await page.evaluate(
      (expected) => [...document.scripts].some((s) => s.nonce === expected),
      nonce,
    ),
  ).toBe(true);
  await page.goto("/");
  await page.getByRole("link", { name: "Configurar mi espacio" }).click();
  await expect(
    page.getByRole("heading", { name: "Conecta tu espacio de trabajo" }),
  ).toBeVisible();
  expect(violations).toEqual([]);
});

test("el callback no consume el token y pide confirmación", async ({
  page,
  request,
  baseURL,
}) => {
  const response = await request.get(
    `/auth/callback?token_hash=${tokenHash}&type=invite&next=/auth/password`,
    { maxRedirects: 0 },
  );
  expect(response.status()).toBe(303);
  expect(response.headers()["location"]).toMatch(/\/auth\/confirm$/);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  const setCookie = response.headers()["set-cookie"] ?? "";
  expect(setCookie).toMatch(/cuadria_auth_pending=/);
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/Path=\/auth/);
  const value = /cuadria_auth_pending=([^;]+)/.exec(setCookie)?.[1] ?? "";
  await page
    .context()
    .addCookies([
      { name: "cuadria_auth_pending", value, url: `${baseURL}/auth` },
    ]);
  await page.goto("/auth/confirm");
  await expect(
    page.getByRole("heading", { name: "Aceptar invitación" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Continuar" })).toBeVisible();

  // A client from an older deployment: the server no longer knows the action.
  await page.route("**/auth/confirm", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 404,
          headers: { "x-nextjs-action-not-found": "1" },
          body: "",
        })
      : route.continue(),
  );
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(
    page.getByText(
      "CUADRIA se actualizó. Recarga la página; la operación no se registró.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Recargar la página" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Aceptar invitación" }),
  ).toBeVisible();
});

test("un enlace inválido vuelve al ingreso con un aviso", async ({
  page,
  request,
}) => {
  const response = await request.get(
    `/auth/callback?token_hash=${tokenHash}&type=signup`,
    { maxRedirects: 0 },
  );
  expect(response.headers()["location"]).toMatch(/\/login\?error=callback$/);
  await page.goto("/login?error=callback");
  await expect(
    page.getByText("El enlace de acceso no es válido"),
  ).toBeVisible();
  await page.goto("/auth/confirm");
  await expect(
    page.getByRole("heading", { name: "Enlace no disponible" }),
  ).toBeVisible();
});
