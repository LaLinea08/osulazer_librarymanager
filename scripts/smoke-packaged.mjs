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

  const realmAfter = realmPath ? await stat(realmPath).catch(() => null) : null;
  const sourceUnchanged =
    realmBefore === null ||
    realmAfter === null ||
    (realmBefore.size === realmAfter.size &&
      realmBefore.mtimeMs === realmAfter.mtimeMs);

  const result = {
    title: await page.title(),
    heading: await page.locator("h1").first().textContent(),
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
