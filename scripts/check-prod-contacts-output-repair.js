#!/usr/bin/env node

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  validateCanonicalProdContactsOutput,
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
    const latestJsonPath = path.join(canonicalRoot, "Output", "prod-contacts", "salesforce-report-latest.json");
    const latestCsvPath = path.join(canonicalRoot, "Output", "prod-contacts", "salesforce-report-latest.csv");
    const canonicalPayload = {
      schema: "salesforce-duplicate-reviewer.dataset",
      schemaVersion: 1,
      objectType: "contact",
      fileName: "salesforce-report-latest.json",
      source: {
        system: "salesforce",
        name: "Latest Prod Contacts"
      },
      rows: [["003000000000001AAA", "Prod Contact"]]
    };

    const missingResult = await validateCanonicalProdContactsOutput({
      env: {
        DUPLICATE_REVIEWER_PROD_ROOT: canonicalRoot
      }
    });

    if (missingResult.validated || missingResult.reason !== "canonical-missing") {
      throw new Error(`Expected canonical validation to fail before the canonical files exist: ${JSON.stringify(missingResult)}`);
    }

    await fs.mkdir(path.dirname(latestJsonPath), { recursive: true });
    await fs.writeFile(latestJsonPath, `${JSON.stringify(canonicalPayload, null, 2)}\n`);
    await fs.writeFile(latestCsvPath, "Id,Name\n003000000000001AAA,Prod Contact\n");

    const result = await validateCanonicalProdContactsOutput({
      env: {
        DUPLICATE_REVIEWER_PROD_ROOT: canonicalRoot
      }
    });

    if (!result.validated) {
      throw new Error(`Expected canonical prod Contacts output to validate: ${JSON.stringify(result)}`);
    }

    const canonicalJson = JSON.parse(await fs.readFile(latestJsonPath, "utf8"));
    const canonicalCsv = await fs.readFile(latestCsvPath, "utf8");
    if (canonicalJson.fileName !== "salesforce-report-latest.json" || !canonicalCsv.includes("Prod Contact")) {
      throw new Error(`Canonical prod Contacts output was not validated correctly: ${JSON.stringify({ canonicalJson, canonicalCsv })}`);
    }

    const paths = resolveProdContactsPaths({
      DUPLICATE_REVIEWER_PROD_ROOT: canonicalRoot
    });
    if (
      paths.canonicalJsonPath !== latestJsonPath ||
      paths.canonicalCsvPath !== latestCsvPath
    ) {
      throw new Error(`Prod Contacts path resolution drifted: ${JSON.stringify(paths)}`);
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }

  console.log("Prod Contacts canonical output validation passed.");
}
