#!/usr/bin/env node

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  repairLegacyProdContactsOutput,
  resolveProdContactsPaths
} = require("./prod-contacts-output-repair");

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "duplicate-reviewer-prod-repair-"));
  try {
    const canonicalRoot = path.join(tempDir, "Salesforce Pulls", "Duplicate Reviewer", "prod");
    const legacyRoot = path.join(tempDir, "Salesforce Pulls", "Duplicate Reviewer", "download-prod-contacts-for-duplicate-review");
    const latestJsonPath = path.join(canonicalRoot, "Output", "prod-contacts", "salesforce-prod-contacts-latest.json");
    const latestCsvPath = path.join(canonicalRoot, "Output", "prod-contacts", "salesforce-prod-contacts-latest.csv");
    const legacyJsonPath = path.join(legacyRoot, "Output", "download-prod-contacts-for-duplicate-review", "salesforce-prod-contacts-latest.json");
    const legacyCsvPath = path.join(legacyRoot, "Output", "download-prod-contacts-for-duplicate-review", "salesforce-prod-contacts-latest.csv");
    const legacyPayload = {
      schema: "salesforce-duplicate-reviewer.dataset",
      schemaVersion: 1,
      objectType: "contact",
      fileName: "salesforce-prod-contacts-latest.json",
      source: {
        system: "salesforce",
        name: "Latest Prod Contacts"
      },
      rows: [["003000000000001AAA", "Prod Contact"]]
    };

    await fs.mkdir(path.dirname(legacyJsonPath), { recursive: true });
    await fs.writeFile(legacyJsonPath, `${JSON.stringify(legacyPayload, null, 2)}\n`);
    await fs.writeFile(legacyCsvPath, "Id,Name\n003000000000001AAA,Prod Contact\n");

    const result = await repairLegacyProdContactsOutput({
      env: {
        DUPLICATE_REVIEWER_PROD_ROOT: canonicalRoot,
        LEGACY_DUPLICATE_REVIEWER_PROD_ROOT: legacyRoot
      }
    });

    if (!result.repaired) {
      throw new Error(`Expected legacy prod Contacts output repair to run: ${JSON.stringify(result)}`);
    }

    const repairedJson = JSON.parse(await fs.readFile(latestJsonPath, "utf8"));
    const repairedCsv = await fs.readFile(latestCsvPath, "utf8");
    if (repairedJson.fileName !== "salesforce-prod-contacts-latest.json" || !repairedCsv.includes("Prod Contact")) {
      throw new Error(`Canonical prod Contacts output was not copied correctly: ${JSON.stringify({ repairedJson, repairedCsv })}`);
    }

    const paths = resolveProdContactsPaths({
      DUPLICATE_REVIEWER_PROD_ROOT: canonicalRoot,
      LEGACY_DUPLICATE_REVIEWER_PROD_ROOT: legacyRoot
    });
    if (
      paths.canonicalJsonPath !== latestJsonPath ||
      paths.canonicalCsvPath !== latestCsvPath ||
      paths.legacyJsonPath !== legacyJsonPath ||
      paths.legacyCsvPath !== legacyCsvPath
    ) {
      throw new Error(`Prod Contacts path resolution drifted: ${JSON.stringify(paths)}`);
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }

  console.log("Prod Contacts output repair regression passed.");
}
