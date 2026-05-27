const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (error) {
  console.error("Playwright is not installed. Run `npm install --no-save playwright` and `npx playwright install chromium`, then retry.");
  process.exit(2);
}

const baseUrl = process.env.DUPLICATE_REVIEWER_URL || "http://127.0.0.1:5180";
const outDir = process.env.PLAYWRIGHT_SMOKE_OUT_DIR || path.join(os.tmpdir(), "duplicate-reviewer-playwright");

async function run() {
  await fs.mkdir(outDir, { recursive: true });

  const browser = await chromium.launch();
  const messages = [];

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        messages.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => messages.push(`pageerror: ${error.message}`));

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(outDir, "desktop-empty.png"), fullPage: false });

    await page.getByRole("button", { name: "Demo Data" }).click();
    await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: 10000 });
    await page.locator(".group-item-main").first().click();
    await page.getByLabel("Duplicate review workspace").getByRole("button", { name: "Duplicate", exact: true }).click();
    await page.locator(".record-decision-badge.duplicate").first().waitFor({ state: "visible", timeout: 5000 });

    const duplicateBadges = await page.locator(".record-decision-badge.duplicate").count();
    await page.screenshot({ path: path.join(outDir, "desktop-duplicate.png"), fullPage: false });

    await page.getByRole("button", { name: "Shortcuts" }).click();
    await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor({ state: "visible", timeout: 5000 });
    const shortcutsVisible = await page.getByRole("dialog", { name: "Keyboard shortcuts" }).isVisible();
    await page.screenshot({ path: path.join(outDir, "desktop-shortcuts.png"), fullPage: false });
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".review-header").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(outDir, "mobile-review.png"), fullPage: false });

    const layout = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth
    }));

    if (!duplicateBadges) throw new Error("Expected at least one Duplicate decision badge.");
    if (!shortcutsVisible) throw new Error("Expected shortcuts modal to be visible.");
    if (layout.pageScrollWidth > layout.viewportWidth || layout.bodyScrollWidth > layout.viewportWidth) {
      throw new Error(`Unexpected horizontal overflow: ${JSON.stringify(layout)}`);
    }
    if (messages.length) throw new Error(`Browser console warnings/errors: ${messages.join(" | ")}`);

    console.log(JSON.stringify({ ok: true, baseUrl, duplicateBadges, shortcutsVisible, layout, screenshotsDir: outDir }, null, 2));
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
