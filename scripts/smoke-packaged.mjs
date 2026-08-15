import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron } from "playwright";

const executable = resolve(
  "dist",
  "win-unpacked",
  "osu-lazer-library-manager.exe",
);
const screenshots = {
  onboarding: resolve("dist", "smoke-onboarding.png"),
  dashboard: resolve("dist", "smoke-dashboard.png"),
  library: resolve("dist", "smoke-library.png"),
  deletionReview: resolve("dist", "smoke-deletion-review.png"),
  quarantine: resolve("dist", "smoke-quarantine.png"),
  lightSettings: resolve("dist", "smoke-light-settings.png"),
  darkSettings: resolve("dist", "smoke-dark-settings.png"),
  darkDashboard: resolve("dist", "smoke-dark-dashboard.png"),
};
const userData = await mkdtemp(join(tmpdir(), "osu-library-manager-smoke-"));
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const realmPath = environment.APPDATA
  ? join(environment.APPDATA, "osu", "client.realm")
  : null;
const realmBefore = realmPath ? await stat(realmPath).catch(() => null) : null;

let electronApp;
try {
  electronApp = await electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${userData}`],
    env: environment,
    timeout: 20_000,
  });
  const page = await electronApp.firstWindow({ timeout: 20_000 });
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.waitForLoadState("domcontentloaded");
  await page.locator(".onboarding-card").waitFor({ state: "visible" });
  await page.screenshot({ path: screenshots.onboarding, fullPage: true });
  const productFont = await page
    .locator(".product-wordmark-core")
    .evaluate((element) => globalThis.getComputedStyle(element).fontFamily);
  const productFontLoaded = await page.evaluate(async () => {
    await globalThis.document.fonts.ready;
    return Array.from(globalThis.document.fonts).some(
      (face) =>
        face.family.replaceAll('"', "") === "Righteous" &&
        face.status === "loaded",
    );
  });

  const detectedLibrary = page.getByRole("button", {
    name: "Use this library",
  });
  await detectedLibrary.waitFor({ state: "visible" });
  await detectedLibrary.click();
  await page.locator(".first-scan-banner").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Build library index" }).click();
  await page.locator(".first-scan-banner").waitFor({
    state: "hidden",
    timeout: 60_000,
  });
  await page.locator(".summary-grid").waitFor({ state: "visible" });
  await page.screenshot({ path: screenshots.dashboard, fullPage: true });

  await page.getByRole("button", { name: "All Beatmaps" }).click();
  await page.locator(".library-table").waitFor({ state: "visible" });
  await page
    .locator(".table-row:not(.skeleton-row)")
    .first()
    .waitFor({ state: "visible", timeout: 20_000 });
  await page.screenshot({ path: screenshots.library, fullPage: true });

  const firstRow = page.locator(".table-row:not(.skeleton-row)").first();
  await firstRow.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Review deletion" }).click();
  await page
    .getByRole("heading", { name: "Review whole-set deletion" })
    .waitFor({ state: "visible", timeout: 20_000 });
  await page
    .locator(".protected-delete-modal .preview-summary")
    .waitFor({ state: "visible", timeout: 20_000 });
  await page.screenshot({ path: screenshots.deletionReview, fullPage: true });
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Quarantine" }).first().click();
  await page
    .getByRole("heading", { name: "Quarantine & restore" })
    .waitFor({ state: "visible" });
  await page.screenshot({ path: screenshots.quarantine, fullPage: true });

  await page.getByRole("button", { name: "Settings" }).click();
  await page
    .getByRole("heading", { name: "Settings" })
    .waitFor({ state: "visible" });
  const lightOption = page.getByRole("radio", { name: "Light" });
  const initialTheme = await page.evaluate(() => ({
    resolved: globalThis.document.documentElement.dataset.theme,
    preference: globalThis.document.documentElement.dataset.themePreference,
  }));
  if (
    !(await lightOption.isChecked()) ||
    initialTheme.resolved !== "light" ||
    initialTheme.preference !== "light"
  ) {
    throw new Error(
      `Fresh profile did not start in Light: ${JSON.stringify(initialTheme)}`,
    );
  }
  await page.screenshot({ path: screenshots.lightSettings, fullPage: true });
  await page.getByRole("radio", { name: "System" }).check();
  await page.waitForFunction(
    () =>
      globalThis.document.documentElement.dataset.themePreference === "system",
  );
  await page.getByRole("radio", { name: "Dark" }).check();
  await page.waitForFunction(
    () => globalThis.document.documentElement.dataset.theme === "dark",
  );
  await page.screenshot({ path: screenshots.darkSettings, fullPage: true });

  // Reload the renderer to prove the preference is persisted by the main
  // process rather than held only in React state.
  await page.reload();
  await page.locator(".summary-grid").waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      globalThis.document.documentElement.dataset.theme === "dark" &&
      globalThis.document.documentElement.dataset.themePreference === "dark",
  );
  await page.screenshot({ path: screenshots.darkDashboard, fullPage: true });

  const realmAfter = realmPath ? await stat(realmPath).catch(() => null) : null;
  const sourceUnchanged =
    realmBefore === null ||
    realmAfter === null ||
    (realmBefore.size === realmAfter.size &&
      realmBefore.mtimeMs === realmAfter.mtimeMs);

  const result = {
    title: await page.title(),
    heading: await page.locator("h1").first().textContent(),
    theme: await page.evaluate(() => ({
      resolved: globalThis.document.documentElement.dataset.theme,
      preference: globalThis.document.documentElement.dataset.themePreference,
      bodyFont: globalThis.getComputedStyle(globalThis.document.body)
        .fontFamily,
    })),
    productFont,
    productFontLoaded,
    viewport: page.viewportSize(),
    screenshots,
    sourceRealm: realmPath,
    sourceUnchanged,
    pageErrors,
    consoleErrors,
  };
  if (!sourceUnchanged) {
    throw new Error(
      "The source client.realm metadata changed during the scan.",
    );
  }
  if (
    !/Helvetica/.test(result.theme.bodyFont) ||
    !/Arial/.test(result.theme.bodyFont)
  ) {
    throw new Error(
      `Unexpected interface font stack: ${result.theme.bodyFont}`,
    );
  }
  if (!/Righteous/.test(productFont) || !productFontLoaded) {
    throw new Error(
      `Bundled product font was not active: ${productFont} (loaded: ${productFontLoaded})`,
    );
  }
  if (pageErrors.length > 0 || consoleErrors.length > 0) {
    throw new Error(
      `Renderer errors: ${[...pageErrors, ...consoleErrors].join(" | ")}`,
    );
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await electronApp?.close();
  await rm(userData, { recursive: true, force: true });
}
