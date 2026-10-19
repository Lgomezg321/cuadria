import { test, expect } from "@playwright/test";
test("inicio sin cifras ficticias y navegación a configuración", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Cada peso, en su lugar." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Configurar mi espacio" }).click();
  await expect(
    page.getByRole("heading", { name: "Conecta tu espacio de trabajo" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("rutas de datos protegidas sin configuración", async ({ page }) => {
  for (const route of [
    "/panel",
    "/empresas",
    "/fondos",
    "/movimientos",
    "/auditoria",
  ]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/configuracion$/);
  }
});
test("login informa que falta conexión", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByText(
      "Este entorno necesita una conexión con Supabase antes de iniciar sesión.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ingresar", exact: true }),
  ).toHaveCount(0);
});
