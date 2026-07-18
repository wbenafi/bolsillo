import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

test("flujo principal de bolsillo", async ({ page }, testInfo) => {
  await setupClerkTestingToken({ page });
  await page.goto("/sign-up");

  const uniqueEmail = `bolsillo+clerk_test_${Date.now()}_${testInfo.project.name}@example.com`;
  await page.getByRole("textbox", { name: /email address/i }).fill(uniqueEmail);
  const firstName = page.locator('input[name="firstName"]');
  if (await firstName.isVisible()) await firstName.fill("Bolsillo");
  const lastName = page.locator('input[name="lastName"]');
  if (await lastName.isVisible()) await lastName.fill("Prueba");
  await page.getByRole("textbox", { name: /password/i }).fill("BolsilloTest!2026");
  await page.getByRole("button", { name: /continue/i }).click();

  const codeInput = page.getByRole("textbox", { name: /verification code/i });
  await expect(codeInput).toBeVisible({ timeout: 10_000 });
  await codeInput.fill("424242");

  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Bolsillos" })).toBeVisible();

  await page.getByRole("link", { name: /nuevo bolsillo/i }).click();
  await page.getByLabel("Nombre").fill("Construcción de la casa");
  await page.getByLabel(/descripción/i).fill("Control de gastos del proyecto");
  await page.getByRole("button", { name: "Crear bolsillo" }).click();
  await expect(page.getByRole("heading", { name: "Construcción de la casa" })).toBeVisible();

  await page.getByRole("link", { name: /agregar ingreso/i }).click();
  await page.getByLabel("Monto").fill("5000000");
  await page.getByLabel("Descripción").fill("Aporte inicial");
  await page.getByRole("button", { name: "Guardar movimiento" }).click();
  await expect(page.locator(".hero-balance strong")).toHaveText(/₡5.*000.*000/);

  await page.getByRole("link", { name: /agregar gasto/i }).click();
  await page.getByLabel("Monto").fill("185000");
  await page.getByLabel("Descripción").fill("Compra de cemento");
  await page.getByRole("button", { name: "Guardar movimiento" }).click();
  await expect(page.locator(".hero-balance strong")).toHaveText(/₡4.*815.*000/);

  await page.getByRole("link", { name: "Editar Compra de cemento" }).click();
  await page.getByLabel("Monto").fill("200000");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.locator(".hero-balance strong")).toHaveText(/₡4.*800.*000/);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Eliminar Aporte inicial" }).click();
  await expect(page.locator(".hero-balance strong")).toHaveText(/[-−]₡200.*000/);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(4_500);
  await page.screenshot({
    path: `output/playwright/${testInfo.project.name}-wallet-detail.png`,
    fullPage: false,
  });

  await page.getByRole("button", { name: "Opciones del bolsillo" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Archivar" }).click();
  await expect(page).toHaveURL("/");
  await page.getByRole("link", { name: /ver bolsillos archivados/i }).click();
  await page.getByRole("button", { name: "Restaurar" }).click();
  await expect(page.getByText("Bolsillo restaurado")).toBeVisible();
});
