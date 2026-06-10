#!/usr/bin/env node

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { loadChromium } = require("../vendor/managed-app/scripts/smoke-test-harness");
const outPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, "..", "docs", "design-proposals", "merge-preview-confirmation", "hume-multi-group-merge-review.png");
const mockupPath = path.resolve(
  __dirname,
  "..",
  "docs",
  "design-proposals",
  "merge-preview-confirmation",
  "multi-group-review-mockup.html"
);

async function main() {
  const chromium = loadChromium();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });

  try {
    await page.goto(pathToFileURL(mockupPath).href, { waitUntil: "load", timeout: 15000 });
    await page.locator(".frame").waitFor({ state: "visible", timeout: 10000 });
    await page.screenshot({ path: outPath, fullPage: true });
    process.stdout.write(`${outPath}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
