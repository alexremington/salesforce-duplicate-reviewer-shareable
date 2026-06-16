const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  assertPerformanceBudget,
  loadChromium,
  visibleInteractiveReachability: sharedVisibleInteractiveReachability
} = require("../vendor/managed-app/scripts/smoke-test-harness");
const {
  probeHitTarget
} = require("../plugins/agentic-workflow-policy/scripts/playwright_hit_test_helpers");
const {
  accountCommentaryNormalizationSmokeCsv,
  accountSmokeCsv,
  contactDifferentCompanyConflictSmokeCsv,
  contactLastNameChangeSmokeCsv,
  contactMirrorRelationshipSmokeCsv,
  contactMissingIdSmokeCsv,
  contactSharedCompanyExactPhoneNameConflictSmokeCsv,
  contactSmokeCsv,
  largeContactSmokeCsv,
  largeContactSmokeJson
} = require("./fixtures/duplicate-reviewer-workflows");

let chromium;
try {
  chromium = loadChromium();
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const baseUrl = process.env.DUPLICATE_REVIEWER_URL || "http://127.0.0.1:5180";
const outDir = process.env.PLAYWRIGHT_SMOKE_OUT_DIR || path.join(os.tmpdir(), "duplicate-reviewer-playwright");
const REACHABILITY_OPTIONS = {
  intentionallyHiddenIds: ["csvInput", "workspaceImportInput", "trainingImportInput"],
  pointerEventsAllowedClassNames: ["threshold-slider", "threshold-slider-input"],
  sharedHitAncestorSelectors: [".threshold-slider"]
};
const PERFORMANCE_BUDGETS = {
  emptyImportContactsMs: 15000,
  latestContactsJsonMs: 30000,
  topbarImportContactsMs: 15000,
  largeContactCsvWorkerMs: 30000,
  largeContactCsvFilterApplyMs: 3000,
  largeContactCandidateAttempts: 500000,
  largeContactJsonDeferredMs: 60000
};
const GROUP_ITEM_VISIBLE_TIMEOUT_MS = 30000;
const ORG_PREFERENCES_STORAGE_KEY = "salesforce-duplicate-reviewer.org-preferences-v1";

async function run() {
  await fs.mkdir(outDir, { recursive: true });
  const csvPath = path.join(outDir, "contacts-smoke.csv");
  const missingContactIdCsvPath = path.join(outDir, "contacts-missing-ids.csv");
  const lastNameChangeCsvPath = path.join(outDir, "contacts-last-name-change.csv");
  const differentCompanyConflictCsvPath = path.join(outDir, "contacts-different-company-conflict.csv");
  const sharedCompanyExactPhoneNameConflictCsvPath = path.join(outDir, "contacts-shared-company-exact-phone-name-conflict.csv");
  const mirrorRelationshipCsvPath = path.join(outDir, "contacts-mirror-relationship.csv");
  const accountCsvPath = path.join(outDir, "accounts-smoke.csv");
  const accountCompanyNormalizationCsvPath = path.join(outDir, "accounts-company-normalization.csv");
  const accountCommentaryNormalizationCsvPath = path.join(outDir, "accounts-commentary-normalization.csv");
  const largeContactCsvPath = path.join(outDir, "contacts-large-smoke.csv");
  const largeContactJsonPath = path.join(outDir, "contacts-large-smoke.json");
  const datasetExportPath = path.join(outDir, "dataset-export.csv");
  const workspaceExportPath = path.join(outDir, "workspace-export.json");
  const contactCsv = contactSmokeCsv();
  const largeContactCsv = largeContactSmokeCsv();
  const largeContactJson = largeContactSmokeJson();
  const contactSmokeRowCount = csvDataRowCount(contactCsv);
  const largeContactSmokeRowCount = csvDataRowCount(largeContactCsv);
  await fs.writeFile(csvPath, contactCsv);
  await fs.writeFile(missingContactIdCsvPath, contactMissingIdSmokeCsv());
  await fs.writeFile(lastNameChangeCsvPath, contactLastNameChangeSmokeCsv());
  await fs.writeFile(differentCompanyConflictCsvPath, contactDifferentCompanyConflictSmokeCsv());
  await fs.writeFile(sharedCompanyExactPhoneNameConflictCsvPath, contactSharedCompanyExactPhoneNameConflictSmokeCsv());
  await fs.writeFile(mirrorRelationshipCsvPath, contactMirrorRelationshipSmokeCsv());
  await fs.writeFile(accountCsvPath, accountSmokeCsv());
  await fs.writeFile(accountCompanyNormalizationCsvPath, accountCompanyNormalizationSmokeCsv());
  await fs.writeFile(accountCommentaryNormalizationCsvPath, accountCommentaryNormalizationSmokeCsv());
  await fs.writeFile(largeContactCsvPath, largeContactCsv);
  await fs.writeFile(largeContactJsonPath, largeContactJson);

  const browser = await chromium.launch();
  const messages = [];
  const primaryOrg = {
    orgAlias: "qa-smoke-org",
    instanceUrl: "https://qa-smoke-org.example.invalid"
  };
  const secondaryOrg = {
    orgAlias: "qa-secondary-org",
    instanceUrl: "https://qa-secondary-org.example.invalid"
  };
  const longOrg = {
    orgAlias: "qa-smoke-org-with-an-extremely-long-name-that-should-truncate",
    instanceUrl: "https://qa-smoke-org-with-an-extremely-long-instance-url.example.invalid"
  };
  const smokeSalesforceOrgs = [
    primaryOrg,
    secondaryOrg,
    longOrg,
    {
      orgAlias: "qa-third-org",
      instanceUrl: "https://qa-third-org.example.invalid"
    },
    {
      orgAlias: "qa-fourth-org",
      instanceUrl: "https://qa-fourth-org.example.invalid"
    },
    {
      orgAlias: "qa-fifth-org",
      instanceUrl: "https://qa-fifth-org.example.invalid"
    },
    {
      orgAlias: "politico-staging",
      instanceUrl: "https://politico--staging.sandbox.my.salesforce.com"
    },
    {
      orgAlias: "staging",
      instanceUrl: "https://politico--staging.sandbox.my.salesforce.com"
    }
  ];
  let context = null;

  try {
    const fileModeRedirect = await assertFileModeRedirect(browser);
    const prodContactsAutoloadState = await assertProdContactsAutoload(browser);
    const emptyImportButtonState = await assertEmptyStateOmitsDuplicateImportAction(browser);
    const lastNameChangeCandidateState = await assertLastNameChangeCandidateMatch(browser, lastNameChangeCsvPath);
    const differentCompanyConflictState = await assertDifferentCompanyConflictSeparated(browser, differentCompanyConflictCsvPath);
    const sharedCompanyExactPhoneNameConflictState = await assertSharedCompanyExactPhoneNameConflictSeparated(browser, sharedCompanyExactPhoneNameConflictCsvPath);
    await assertMirrorRelationshipSeparated(browser, mirrorRelationshipCsvPath);
    const largeContactPerformance = await assertLargeContactCsvPerformance(browser, largeContactCsvPath);
    const largeContactJsonDeferredState = await assertLargeContactJsonDeferredIngest(browser, largeContactJsonPath);

    context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (isExpectedBrowserConsoleMessage(message)) return;
      if (["error", "warning"].includes(message.type())) {
        messages.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => messages.push(`pageerror: ${error.message}`));
    await page.route("**/api/salesforce/orgs", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ orgs: smokeSalesforceOrgs })
      });
    });

    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.evaluate(({ storageKey, selectedOrg }) => {
      localStorage.setItem(storageKey, JSON.stringify({ selectedOrg }));
    }, {
      storageKey: ORG_PREFERENCES_STORAGE_KEY,
      selectedOrg: primaryOrg
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => (document.querySelector("#orgRecentSelect")?.options?.length || 0) > 1, null, { timeout: 10000 });
    await page.waitForFunction(() => {
      const status = document.querySelector("#orgStatus")?.textContent || "";
      return status.includes("Auth ready") && status.includes("Runtime aligned");
    }, null, { timeout: 10000 });
    const latestRecentFiles = await assertLatestRecentFiles(page);
    const lightTheme = await themeColorState(page);
    const lightPaneSurfaces = await paneSurfaceState(page);
    const brandLogo = await brandLogoState(page);
    await page.screenshot({ path: path.join(outDir, "desktop-empty.png"), fullPage: false });
    const emptyInteractiveReachability = await visibleInteractiveReachability(page);
    const workspaceImportBox = await page.locator("#workspaceImportInput").boundingBox();
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(100);
    const darkTheme = await themeColorState(page);
    const darkPaneSurfaces = await paneSurfaceState(page);
    await page.screenshot({ path: path.join(outDir, "desktop-empty-dark.png"), fullPage: false });
    await page.emulateMedia({ colorScheme: "light" });

    const emptyDuplicateImportCount = await page.locator('[data-empty-action="choose-csv"]').count();
    const emptyDemoVisible = await page.locator('[data-empty-action="demo-data"]').isVisible();
    const filterFieldDisabledBeforeLoad = await page.locator(".filter-row .filter-field-select").first().isDisabled();
    const applyDisabledBeforeLoad = await page.locator("#applyControlsButton").isDisabled();
    const labelStatusDisabledBeforeLoad = await page.locator('[data-label-status-filter][value="unlabeled"]').isDisabled();
    const labelStatusInMatchGroups = await page.locator('#matchGroupsPanelBody [data-label-status-filter][value="unlabeled"]').count();
    const labelStatusInMatchControls = await page.locator("#matchControlsPanelBody [data-label-status-filter]").count();
    const hideLabeledRemoved = await page.locator("#hideLabeledGroups").count() === 0;
    const loadingProgressbar = await loadingProgressbarState(page);
    const loadingStatusSamples = await loadingStatusRotationState(page);
    const latestJsonLoadStartedAt = Date.now();
    await page.locator(".recent-file").filter({ hasText: "Latest Contacts" }).first().click();
    await page.locator("#loadingModal").waitFor({ state: "hidden", timeout: 10000 });
    await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: GROUP_ITEM_VISIBLE_TIMEOUT_MS });
    const latestJsonLoadElapsedMs = Date.now() - latestJsonLoadStartedAt;
    const latestJsonLoad = await datasetLoadState(page);
    const embeddedOrgState = await orgSelectorState(page);
    if (
      !embeddedOrgState.alias ||
      embeddedOrgState.alias !== latestJsonLoad.sourceOrgAlias ||
      embeddedOrgState.instanceUrl !== latestJsonLoad.sourceInstanceUrl
    ) {
      throw new Error(`Expected the embedded dataset org to populate the selector: ${JSON.stringify(embeddedOrgState)}`);
    }
    const expectedCatalogAliases = [...new Set(smokeSalesforceOrgs.map((org) => canonicalSalesforceOrgAlias(org.orgAlias, org.instanceUrl)))];
    const expectedOptionCount = expectedCatalogAliases.length;
    if (embeddedOrgState.aliasOptions.length !== expectedOptionCount) {
      throw new Error(`Expected every shared catalog entry to render in the dropdown: ${JSON.stringify(embeddedOrgState.aliasOptions)}`);
    }
    if (!expectedCatalogAliases.every((alias) => embeddedOrgState.aliasOptions.some((option) => option.alias === alias))) {
      throw new Error(`Expected the dropdown to include every canonical org alias: ${JSON.stringify({ expected: expectedCatalogAliases, actual: embeddedOrgState.aliasOptions })}`);
    }
    if (!embeddedOrgState.aliasOptions.every((option) => option.label === option.alias && !option.label.includes("·") && !option.label.includes("https://"))) {
      throw new Error(`Expected shared org catalog dropdown entries to show alias only: ${JSON.stringify(embeddedOrgState.aliasOptions)}`);
    }
    if (embeddedOrgState.aliasOptions.some((option) => option.alias === "staging")) {
      throw new Error(`Expected the legacy staging alias to be hidden from the dropdown: ${JSON.stringify(embeddedOrgState.aliasOptions)}`);
    }
    if (!embeddedOrgState.aliasOptions.some((option) => option.alias === "politico-staging")) {
      throw new Error(`Expected the canonical politico-staging alias to appear in the dropdown: ${JSON.stringify(embeddedOrgState.aliasOptions)}`);
    }
    if (embeddedOrgState.aliasInputPresent || embeddedOrgState.instanceUrlInputPresent) {
      throw new Error(`Expected the inline alias and URL inputs to be removed: ${JSON.stringify(embeddedOrgState)}`);
    }
    if (!embeddedOrgState.instanceUrlReadonly || embeddedOrgState.instanceUrlTagName !== "DIV") {
      throw new Error(`Expected the instance URL surface to render as read-only display content: ${JSON.stringify(embeddedOrgState)}`);
    }
    if (!embeddedOrgState.status.includes("Auth ready") || !embeddedOrgState.status.includes("Runtime aligned")) {
      throw new Error(`Expected the compact org status summary to report auth and runtime readiness: ${JSON.stringify(embeddedOrgState)}`);
    }
    await setSalesforceOrgSelection(page, secondaryOrg);
    const mismatchOrgState = await orgSelectorState(page);
    if (
      !mismatchOrgState.warningVisible ||
      !mismatchOrgState.warningText.includes(secondaryOrg.orgAlias) ||
      !mismatchOrgState.warningText.includes(latestJsonLoad.sourceOrgAlias)
    ) {
      throw new Error(`Expected a visible org mismatch warning after changing the target org: ${JSON.stringify(mismatchOrgState)}`);
    }
    const sourceRailReflowState = await assertSourceRailReflow(page, {
      longAlias: longOrg.orgAlias,
      longInstanceUrl: longOrg.instanceUrl,
      restoreOrg: primaryOrg
    });
    if (!sourceRailReflowState.ok) {
      throw new Error(`Expected the Source rail to stay contained, scroll, and keep toggles reachable: ${JSON.stringify(sourceRailReflowState)}`);
    }
    const latestReportSummary = await reportSummaryState(page);
    const leftPaneSmallListLayout = await assertLeftPaneSmallListLayout(page);
    const humeRegionLayout = await assertHumeRegionLayout(page);
    const loadedInteractiveReachability = await visibleInteractiveReachability(page);
    await page.locator("#chooseCsvButton").click();
    await page.getByRole("menuitem", { name: "Contacts" }).waitFor({ state: "visible", timeout: 5000 });
    await page.keyboard.press("Escape");
    const csvMenuClosed = await page.locator("#csvObjectMenu").isHidden();
    await page.locator("#exportMenuButton").click();
    await page.getByRole("menuitem", { name: "Workspace" }).waitFor({ state: "visible", timeout: 5000 });
    await page.getByRole("menuitem", { name: "Decisions" }).waitFor({ state: "visible", timeout: 5000 });
    const exportMenuState = await exportMenuStateForSmoke(page);
    const datasetExportIndex = exportMenuState.options.indexOf("Dataset + Scores");
    const workspaceExportIndex = exportMenuState.options.indexOf("Workspace");
    if (datasetExportIndex < 0) {
      throw new Error(`Expected export menu to include Dataset + Scores export: ${JSON.stringify(exportMenuState)}`);
    }
    if (workspaceExportIndex < 0) {
      throw new Error(`Expected export menu to include Workspace export: ${JSON.stringify(exportMenuState)}`);
    }
    if (exportMenuState.disabled[datasetExportIndex]) {
      throw new Error(`Expected Dataset + Scores export to be enabled after loading a dataset: ${JSON.stringify(exportMenuState)}`);
    }
    if (exportMenuState.disabled[workspaceExportIndex]) {
      throw new Error(`Expected Workspace export to be enabled after loading a dataset: ${JSON.stringify(exportMenuState)}`);
    }
    const datasetExportState = await captureDatasetExport(page, datasetExportPath);
    if (
      !datasetExportState.buttonVisible ||
      !datasetExportState.downloaded ||
      datasetExportState.headerRow[datasetExportState.headerRow.length - 2] !== "group" ||
      datasetExportState.headerRow[datasetExportState.headerRow.length - 1] !== "score" ||
      datasetExportState.csvRowCount !== latestJsonLoad.rowCount + 1
    ) {
      throw new Error(`Expected dataset export with group and score columns: ${JSON.stringify(datasetExportState)}`);
    }
    await page.keyboard.press("Escape");
    const exportMenuClosed = await page.locator("#exportMenu").isHidden();
    await page.locator("#demoButton").click();
    await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: GROUP_ITEM_VISIBLE_TIMEOUT_MS });

    const topbarImportState = await importContactsThroughMenu(page, csvPath);
    await page.locator("#loadingModal").waitFor({ state: "hidden", timeout: 10000 });
    await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: GROUP_ITEM_VISIBLE_TIMEOUT_MS });
    const fallbackOrgState = await orgSelectorState(page);
    if (
      fallbackOrgState.alias !== primaryOrg.orgAlias ||
      fallbackOrgState.instanceUrl !== primaryOrg.instanceUrl ||
      fallbackOrgState.warningVisible
    ) {
      throw new Error(`Expected manual upload to retain the most recently selected org: ${JSON.stringify(fallbackOrgState)}`);
    }
    await page.locator(".group-item-main").first().click();
    const matchControlsButton = page.getByRole("button", { name: /Match Controls/ });
    if (await matchControlsButton.getAttribute("aria-expanded") !== "true") {
      await matchControlsButton.click();
    }
    const matchControlsExpanded = await matchControlsButton.getAttribute("aria-expanded");
    await setRangeValue(page, "#threshold", "80");
    await setRangeValue(page, "#maxThreshold", "100");
    const thresholdReadout = await page.locator("#thresholdValue").textContent();
    const thresholdControl = await thresholdControlState(page);
    const thresholdSliderRightHit = await probeHitTarget(page, "#thresholdSlider", "right");
    if (thresholdSliderRightHit.id === "thresholdMaxNumber") {
      throw new Error(`Expected threshold slider right edge to stay on the slider surface, not the numeric input: ${JSON.stringify(thresholdSliderRightHit)}`);
    }
    await setNumberValue(page, "#thresholdMinNumber", "105");
    const thresholdClampState = await thresholdControlState(page);
    await setNumberValue(page, "#thresholdMinNumber", "80");
    const thresholdTypedState = await thresholdControlState(page);
    const fastestSearchDefaultUnchecked = !(await page.locator("#highRecallMode").isChecked());
    const labelStatusEnabledAfterLoad = await page.locator('[data-label-status-filter][value="unlabeled"]').isEnabled();
    await page.locator("#applyControlsButton").click();
    await page.locator("#loadingModal").waitFor({ state: "hidden", timeout: 10000 });
    await waitForFirstGroup(page, "Threshold-filtered Contact load");
    const thresholdFilteredScores = await visibleGroupScores(page);
    await setRangeValue(page, "#maxThreshold", "100");
    await page.locator("#applyControlsButton").click();
    await waitForFirstGroup(page, "Cached threshold-filtered Contact load");
    const cachedThresholdRebuildState = await page.locator("#sourcePill").getAttribute("data-last-processing-mode");
    if (cachedThresholdRebuildState !== "cache") {
      throw new Error(`Expected cached threshold rebuild to reuse prepared records and cached pair scores: ${cachedThresholdRebuildState}`);
    }
    const customFilterState = await exerciseCustomFilters(page);
    await page.locator("#groupList").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await page.waitForTimeout(100);
    await page.locator("#groupSortToggle").click();
    const sortPressed = await page.locator("#groupSortToggle").getAttribute("aria-pressed");
    await page.waitForFunction(() => {
      const list = document.querySelector("#groupList");
      const firstGroup = document.querySelector(".group-item");
      return list && firstGroup && list.scrollTop <= 1 && firstGroup.classList.contains("is-selected");
    }, null, { timeout: 5000 });
    const sortTopState = await groupListTopState(page);
    await page.locator(".group-item-main").first().click();

    await page.locator('[data-record-action="separate"]').first().click();
    await page.locator(".record-separation-badge").first().waitFor({ state: "visible", timeout: 5000 });
    const separatedBadgeVisible = await page.locator(".record-separation-badge").first().isVisible();
    await page.locator('[data-record-action="restore"]').first().click();
    await page.locator(".record-separation-badge").first().waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});

    const fieldResolutionSelects = await page.locator(".field-resolution-select").count();
    let fieldResolutionSelectable = true;
    if (fieldResolutionSelects) {
      const firstResolution = page.locator(".field-resolution-select").first();
      const optionCount = await firstResolution.locator("option").count();
      if (optionCount > 1) {
        await firstResolution.selectOption({ index: 1 });
      }
      fieldResolutionSelectable = optionCount > 0;
    }

    const trainingLabelRerenderState = await exerciseTrainingLabelRerender(page);
    await page.locator(".group-item.is-label-full .label-status-indicator.full").first().waitFor({ state: "visible", timeout: 5000 });
    const fullLabelIndicators = await page.locator(".group-item.is-label-full .label-status-indicator.full").count();
    const trainingExportEnabled = await page.locator("#trainingExportButton").isEnabled();
    const labelStatusFilterState = await exerciseLabelStatusFilter(page);

    await page.getByLabel("Duplicate review workspace").getByRole("button", { name: "Duplicate", exact: true }).click();
    await page.locator(".record-decision-badge.duplicate").first().waitFor({ state: "visible", timeout: 5000 });

    const duplicateBadges = await page.locator(".record-decision-badge.duplicate").count();
    const workspaceExportState = await captureWorkspaceExport(page, workspaceExportPath);
    if (workspaceExportState.kind !== "workspace" || workspaceExportState.workspaceVersion !== 1) {
      throw new Error(`Expected workspace export metadata to mark the file as a workspace record: ${JSON.stringify(workspaceExportState)}`);
    }
    if (
      workspaceExportState.sourceDataset?.orgAlias !== primaryOrg.orgAlias ||
      workspaceExportState.sourceDataset?.instanceUrl !== primaryOrg.instanceUrl
    ) {
      throw new Error(`Expected workspace export to preserve the selected Salesforce org metadata: ${JSON.stringify(workspaceExportState)}`);
    }
    if (!Array.isArray(workspaceExportState.trainingLabels) || !workspaceExportState.trainingLabels.length) {
      throw new Error(`Expected workspace export to include saved training labels: ${JSON.stringify(workspaceExportState)}`);
    }
    if (!Array.isArray(workspaceExportState.decisions) || !workspaceExportState.decisions.length) {
      throw new Error(`Expected workspace export to include saved decisions: ${JSON.stringify(workspaceExportState)}`);
    }
    const workspaceRoundTripState = await assertWorkspaceExportRoundTrip(browser, workspaceExportPath, csvPath);
    if (workspaceRoundTripState.decisionCount < 1 || workspaceRoundTripState.trainingLabelCount < 1) {
      throw new Error(`Expected workspace import to restore decisions and labels in a fresh context: ${JSON.stringify(workspaceRoundTripState)}`);
    }
    await page.screenshot({ path: path.join(outDir, "desktop-duplicate.png"), fullPage: false });

    await page.getByLabel("Duplicate review workspace").getByRole("button", { name: "Not Duplicate", exact: true }).click();
    await page.locator(".record-decision-badge.not-duplicate").first().waitFor({ state: "visible", timeout: 5000 });
    const notDuplicateBadges = await page.locator(".record-decision-badge.not-duplicate").count();
    await page.screenshot({ path: path.join(outDir, "desktop-not-duplicate.png"), fullPage: false });

    await page.getByLabel("Duplicate review workspace").getByRole("button", { name: "Duplicate", exact: true }).click();
    await page.locator('[data-review-mode="merge"]').click();
    await page.locator(".merge-master-choice").first().waitFor({ state: "visible", timeout: 5000 });
    const mergeMasterRadios = await page.locator(".merge-master-radio").count();
    const mergeFieldRadios = await page.locator(".merge-field-radio").count();
    if (mergeMasterRadios > 1) {
      await page.locator(".merge-master-radio").nth(1).check();
    }
    const mergeMasterCanChange = mergeMasterRadios < 2 || await page.locator(".merge-master-radio").nth(1).isChecked();
    const leadSourceRule = await mergeLeadSourceRuleState(page);
    const mergeFieldSelection = await page.evaluate(() => {
      const radios = [...document.querySelectorAll(".merge-field-radio:not(:disabled)")];
      const candidate = radios.find((radio) => {
        if (radio.checked) return false;
        const siblings = radios.filter((sibling) => sibling.name === radio.name);
        const checkedSibling = siblings.find((sibling) => sibling.checked);
        return checkedSibling && checkedSibling.value !== radio.value;
      });
      if (!candidate) return { attempted: false };
      candidate.click();
      return { attempted: true, name: candidate.name, value: candidate.value };
    });
    let mergeFieldCanChange = true;
    if (mergeFieldSelection.attempted) {
      await page.waitForTimeout(100);
      mergeFieldCanChange = await page.evaluate(({ name, value }) => {
        return [...document.querySelectorAll(".merge-field-radio")]
          .some((radio) => radio.name === name && radio.value === value && radio.checked);
      }, mergeFieldSelection);
    }
    const staleRefreshState = await captureStaleRefreshFlow(page);
    const staleFailureCardRefreshState = await captureStaleFailureCardRefreshFlow(page);
    const missingContactIdRefreshState = await captureMissingContactIdRefreshFlow(page, missingContactIdCsvPath, contactSmokeCsv());
    const missingContactIdFallbackRefreshState = await captureMissingContactIdFallbackRefreshFlow(page, missingContactIdCsvPath, contactSmokeCsv());
    if (
      !staleRefreshState.refreshCalled ||
      !staleRefreshState.datasetContractVersion ||
      staleRefreshState.datasetContractVersion !== "salesforce-contact-rollback-v1" ||
      staleRefreshState.datasetRollbackInventoryCount < 1 ||
      staleRefreshState.sourceFormat !== "json" ||
      staleRefreshState.refreshEndpoint !== "/api/smoke/stale-refresh/latest.json"
    ) {
      throw new Error(`Expected stale Contacts refresh to preserve the rollback-capable JSON contract: ${JSON.stringify(staleRefreshState)}`);
    }
    if (
      !staleFailureCardRefreshState.refreshCalled ||
      !staleFailureCardRefreshState.datasetContractVersion ||
      staleFailureCardRefreshState.datasetContractVersion !== "salesforce-contact-rollback-v1" ||
      staleFailureCardRefreshState.datasetRollbackInventoryCount < 1 ||
      staleFailureCardRefreshState.sourceFormat !== "json" ||
      staleFailureCardRefreshState.refreshEndpoint !== "/api/smoke/stale-failure-card-refresh/latest.json"
    ) {
      throw new Error(`Expected stale failure-card refresh to preserve the rollback-capable JSON contract: ${JSON.stringify(staleFailureCardRefreshState)}`);
    }
    await page.locator(".group-item-main").first().click();
    await page.getByLabel("Duplicate review workspace").getByRole("button", { name: "Duplicate", exact: true }).click();
    await page.locator('[data-review-mode="merge"]').click();
    await page.evaluate(() => {
      if (typeof endFileLoad === "function") endFileLoad();
      if (typeof renderDetail === "function") renderDetail();
    });
    try {
      await page.locator(".merge-submit-button").first().waitFor({ state: "visible", timeout: 5000 });
    } catch (error) {
      const debugState = await duplicateReviewerDebugState(page);
      const detailHtml = await page.evaluate(() => document.querySelector(".detail-surface")?.innerHTML || "");
      throw new Error(`Main merge view did not open: ${JSON.stringify({ debugState, detailHtml })}`);
    }
    await page.setViewportSize({ width: 1280, height: 560 });
    const workspaceColumnScroll = await assertVerticalScrollAvailable(page, ".workspace-column", "workspace column");
    const rightPaneScrollModel = await assertRightPaneSingleScrollModel(page);
    const mergePayload = await captureMergePayload(page, csvPath);
    const mergeReportDownloadState = await captureMergeReportDownload(page);
    const rootScrollPolicy = await assertRootScrollPolicy(page);
    const scrollTrapState = await assertNoPrimaryScrollTraps(page);
    const interactiveReachability = await visibleInteractiveReachability(page);
    await page.screenshot({ path: path.join(outDir, "desktop-merge.png"), fullPage: false });

    await page.locator("#chooseCsvButton").click();
    await page.getByRole("menuitem", { name: "Accounts" }).click();
    await page.locator("#csvInput").setInputFiles(accountCsvPath);
    await page.locator("#loadingModal").waitFor({ state: "hidden", timeout: 10000 });
    await waitForFirstGroup(page, "Account CSV load");
    const accountDebugState = await duplicateReviewerDebugState(page);
    if (accountDebugState.groupCount !== 1) {
      throw new Error(`Expected the account scorer to keep the near-exact name-only pair out of the duplicate set: ${JSON.stringify(accountDebugState)}`);
    }
    const accountMergeDisabled = await page.locator('[data-review-mode="merge"]').isDisabled();
    await page.screenshot({ path: path.join(outDir, "desktop-account-evaluate.png"), fullPage: false });

    await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
    await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor({ state: "visible", timeout: 5000 });
    const shortcutsVisible = await page.getByRole("dialog", { name: "Keyboard shortcuts" }).isVisible();
    await page.screenshot({ path: path.join(outDir, "desktop-shortcuts.png"), fullPage: false });
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".review-header").scrollIntoViewIfNeeded();
    const mobileScroll = await assertWindowScrollAvailable(page);
    const mobileInteractiveReachability = await visibleInteractiveReachability(page);
    await page.screenshot({ path: path.join(outDir, "mobile-review.png"), fullPage: false });

    const layout = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth
    }));

    if (emptyDuplicateImportCount !== 0) {
      throw new Error(`Expected the empty-state Import button to be removed because the header Import menu already owns object selection: ${emptyDuplicateImportCount}`);
    }
    if (!emptyDemoVisible) throw new Error("Expected empty-state Load Demo action to be visible.");
    if (largeContactPerformance.rowCount !== largeContactSmokeRowCount || !largeContactPerformance.groupCount || largeContactPerformance.processingMode !== "worker") {
      throw new Error(`Expected large Contact CSV fixture to load through worker-backed matching: ${JSON.stringify(largeContactPerformance)}`);
    }
    if (!largeContactPerformance.matchingStats || largeContactPerformance.matchingStats.candidateAttempts > PERFORMANCE_BUDGETS.largeContactCandidateAttempts) {
      throw new Error(`Large Contact CSV candidate attempts exceeded budget: ${JSON.stringify(largeContactPerformance.matchingStats)}`);
    }
    if (
      !largeContactPerformance.groupListScrollLockState ||
      largeContactPerformance.groupListScrollLockState.after.afterScrollTop <= largeContactPerformance.groupListScrollLockState.before.scrollTop ||
      largeContactPerformance.groupListScrollLockState.after.selectedVisible
    ) {
      throw new Error(`Expected Match Groups to keep scrolling after the selected item is pinned at the top: ${JSON.stringify(largeContactPerformance.groupListScrollLockState)}`);
    }
    if (
      largeContactJsonDeferredState.rowCount !== 2 ||
      largeContactJsonDeferredState.groupCount !== 1 ||
      largeContactJsonDeferredState.matchingDeferred !== true ||
      largeContactJsonDeferredState.applyButtonText !== "Match now" ||
      largeContactJsonDeferredState.sourcePillText !== "Parsed" ||
      !largeContactJsonDeferredState.reviewStateStatus.includes("Matching deferred")
    ) {
      throw new Error(`Expected large JSON ingest to defer matching until the explicit follow-up action: ${JSON.stringify(largeContactJsonDeferredState)}`);
    }
    assertPerformanceBudget(
      "large Contact JSON deferred ingest",
      largeContactJsonDeferredState.loadElapsedMs,
      PERFORMANCE_BUDGETS.largeContactJsonDeferredMs
    );
    if (
      lastNameChangeCandidateState.groupCount !== 1 ||
      lastNameChangeCandidateState.firstGroupScore < 86 ||
      !lastNameChangeCandidateState.matchingStats?.candidatePairs
    ) {
      throw new Error(`Expected last-name-change Contact pair to survive candidate pruning: ${JSON.stringify(lastNameChangeCandidateState)}`);
    }
    if (differentCompanyConflictState.groupCount !== 0) {
      throw new Error(`Expected different-company Contact pair to stay below the duplicate threshold: ${JSON.stringify(differentCompanyConflictState)}`);
    }
    if (
      sharedCompanyExactPhoneNameConflictState.groupCount !== 0 ||
      sharedCompanyExactPhoneNameConflictState.runtimeScore >= 86 ||
      !sharedCompanyExactPhoneNameConflictState.reasons.includes("Shared company and exact phone with conflicting names")
    ) {
      throw new Error(`Expected shared-company exact-phone Contact pair to stay below the duplicate threshold with the new name-conflict cap: ${JSON.stringify(sharedCompanyExactPhoneNameConflictState)}`);
    }
    assertPerformanceBudget("large Contact CSV worker import", largeContactPerformance.elapsedMs, PERFORMANCE_BUDGETS.largeContactCsvWorkerMs);
    if (!lightTheme.colorScheme.includes("light") || !darkTheme.colorScheme.includes("dark") || lightTheme.bodyBg === darkTheme.bodyBg) {
      throw new Error(`Expected the UI theme to follow system light/dark mode: ${JSON.stringify({ lightTheme, darkTheme })}`);
    }
    if (!lightTheme.secondaryAccent || !darkTheme.secondaryAccent || lightTheme.secondaryAccent === lightTheme.accent || darkTheme.secondaryAccent === darkTheme.accent) {
      throw new Error(`Expected a complementary secondary accent in the shared theme: ${JSON.stringify({ lightTheme, darkTheme })}`);
    }
    if (!brandLogo.visible || brandLogo.alt !== "POLITICO" || !brandLogo.src.endsWith("/vendor/managed-app/assets/politico-logo.svg")) {
      throw new Error(`Expected POLITICO logo in the top-left header: ${JSON.stringify(brandLogo)}`);
    }
    if (!brandLogo.supportContact || brandLogo.supportHref !== "mailto:aremington@politico.com" || !brandLogo.supportRightAligned) {
      throw new Error(`Expected support contact at the right side of the header: ${JSON.stringify(brandLogo)}`);
    }
    if (
      brandLogo.titleFontSize !== "28px" ||
      brandLogo.titleFontFamily.includes("Iowan Old Style") ||
      !zeroLetterSpacing(brandLogo.titleLetterSpacing) ||
      brandLogo.subtitleText !== "Salesforce Account and Contact Matching" ||
      brandLogo.subtitleFontSize !== "14px" ||
      fontWeightNumber(brandLogo.subtitleFontWeight) < 600 ||
      !zeroLetterSpacing(brandLogo.subtitleLetterSpacing)
    ) {
      throw new Error(`Expected Duplicate Reviewer to use shared managed header typography: ${JSON.stringify(brandLogo)}`);
    }
    if (!brandLogo.actionsCentered || !brandLogo.actionRowsBalanced || !brandLogo.actionsComfortable) {
      throw new Error(`Expected Duplicate Reviewer header buttons to be centered in balanced, legible rows: ${JSON.stringify(brandLogo)}`);
    }
    if (!workspaceImportBox || workspaceImportBox.width > 4 || workspaceImportBox.height > 4) {
      throw new Error(`Expected the workspace import file input to stay tiny and out of the header flow: ${JSON.stringify(workspaceImportBox)}`);
    }
    if (brandLogo.actionTexts.join("|") !== "Import|Export >|?|Send to Codex|Demo Data") {
      throw new Error(`Expected Duplicate Reviewer header actions to be simplified and ordered: ${JSON.stringify(brandLogo)}`);
    }
    if (brandLogo.copyCenterDelta > 4 || brandLogo.copyGap < 10 || brandLogo.copyGap > 18) {
      throw new Error(`Expected POLITICO logo to align vertically with the brand text and keep even brand spacing: ${JSON.stringify(brandLogo)}`);
    }
    if (!lightPaneSurfaces.standardized || !darkPaneSurfaces.standardized) {
      throw new Error(`Expected layout panes to share one canvas background: ${JSON.stringify({ lightPaneSurfaces, darkPaneSurfaces })}`);
    }
    if (!filterFieldDisabledBeforeLoad || !applyDisabledBeforeLoad || !labelStatusDisabledBeforeLoad) {
      throw new Error("Expected match filters and Apply to be disabled before a dataset is loaded.");
    }
    if (!labelStatusInMatchGroups || labelStatusInMatchControls || !hideLabeledRemoved) {
      throw new Error("Expected Label status in Match Groups and Hide labeled removed.");
    }
    if (!loadingProgressbar.exists || loadingProgressbar.min !== "0" || loadingProgressbar.max !== "100") {
      throw new Error(`Expected the loading modal to include a determinate progress bar: ${JSON.stringify(loadingProgressbar)}`);
    }
    const statusFamilies = new Set(loadingStatusSamples.map((status) => status.split(":")[0]));
    if (statusFamilies.size < 7) {
      throw new Error(`Expected the loading bar to cycle across several progress areas: ${JSON.stringify(loadingStatusSamples)}`);
    }
    if (loadingStatusSamples.some((status) => /\bstage 0\//.test(status))) {
      throw new Error(`Expected loading status stages to use 1-based numbering: ${JSON.stringify(loadingStatusSamples)}`);
    }
    if (!loadingStatusSamples.some((status) => /^Reticulating splines: [\d,]+\/[\d,]+ - sector [\d,]+$/.test(status))) {
      throw new Error(`Expected Reticulating splines to remain in the loading status mix: ${JSON.stringify(loadingStatusSamples)}`);
    }
    ["Preparing records", "Building candidate buckets", "Finding candidate pairs", "Scoring candidate pairs", "Rendering duplicate groups"].forEach((family) => {
      if (!statusFamilies.has(family)) {
        throw new Error(`Expected ${family} in the loading status rotation: ${JSON.stringify(loadingStatusSamples)}`);
      }
    });
    if (!loadingProgressbar.splineText) {
      throw new Error(`Expected the loading modal to keep a readable progress-bar status: ${JSON.stringify(loadingProgressbar)}`);
    }
    if (loadingProgressbar.splineColor !== loadingProgressbar.secondaryAccentStrong) {
      throw new Error(`Expected the spline status to use the secondary accent: ${JSON.stringify(loadingProgressbar)}`);
    }
    if (latestJsonLoad.fileName !== "salesforce-report-latest.json" || latestJsonLoad.rowCount !== 2 || latestJsonLoad.groupCount !== 1 || latestJsonLoad.processingMode !== "worker") {
      throw new Error(`Expected latest JSON dataset to load through Recent files: ${JSON.stringify(latestJsonLoad)}`);
    }
    assertPerformanceBudget("Latest Contacts JSON load", latestJsonLoadElapsedMs, PERFORMANCE_BUDGETS.latestContactsJsonMs);
    if (latestReportSummary.labels.join("|") !== "Total Records|Match Groups|Reviewed" || latestReportSummary.values.records !== "2" || latestReportSummary.values.groups !== "1" || latestReportSummary.values.reviewed !== "0%" || /Exact|Near/.test(latestReportSummary.text)) {
      throw new Error(`Expected compact Hume report summary with records, groups, and reviewed progress: ${JSON.stringify(latestReportSummary)}`);
    }
    if (latestReportSummary.typography.valueSize < 22 || latestReportSummary.typography.titleSize < 20 || fontWeightNumber(latestReportSummary.typography.titleWeight) < 700 || fontWeightNumber(latestReportSummary.typography.valueWeight) < 700) {
      throw new Error(`Expected Hume summary and group title hierarchy to be readable and strong: ${JSON.stringify(latestReportSummary.typography)}`);
    }
    if (latestReportSummary.surface.summaryBackground === latestReportSummary.surface.canvasBackground || latestReportSummary.surface.reviewHeaderBackground === latestReportSummary.surface.canvasBackground) {
      throw new Error(`Expected summary and group title to sit on a distinct readable surface: ${JSON.stringify(latestReportSummary.surface)}`);
    }
    if (!leftPaneSmallListLayout.ok) {
      throw new Error(`Expected compact left-pane layout without small-list scroll trap: ${JSON.stringify(leftPaneSmallListLayout)}`);
    }
    if (!humeRegionLayout.ok) {
      throw new Error(`Expected Hume layout regions to avoid overlap and preserve a clear gutter: ${JSON.stringify(humeRegionLayout)}`);
    }
    if (!latestRecentFiles.contacts || !latestRecentFiles.accounts) {
      throw new Error(`Expected latest Contact and Account exports in Recent files: ${JSON.stringify(latestRecentFiles)}`);
    }
    if (!csvMenuClosed) throw new Error("Expected Import menu to close with Escape.");
    if (!exportMenuClosed || !exportMenuState.options.includes("Decisions") || !exportMenuState.options.includes("Labels")) {
      throw new Error(`Expected Export menu to include Decisions and Labels and close with Escape: ${JSON.stringify({ exportMenuClosed, exportMenuState })}`);
    }
    if (!topbarImportState.fileChooserOpened || topbarImportState.rowCount !== contactSmokeRowCount || !topbarImportState.groupCount) {
      throw new Error(`Expected topbar Import > Contacts to open a file picker and load a dataset: ${JSON.stringify(topbarImportState)}`);
    }
    if (topbarImportState.processingMode !== "worker") {
      throw new Error(`Expected topbar Contact import to use worker-backed matching: ${JSON.stringify(topbarImportState)}`);
    }
    assertPerformanceBudget("topbar Contact import", topbarImportState.elapsedMs, PERFORMANCE_BUDGETS.topbarImportContactsMs);
    if (matchControlsExpanded !== "true") throw new Error("Expected Match Controls panel to expand.");
    if (thresholdReadout !== "80-100") throw new Error(`Expected threshold readout to update to 80-100, got ${thresholdReadout}.`);
    if (thresholdControl.minRange !== "80" || thresholdControl.maxRange !== "100" || thresholdControl.minNumber !== "80" || thresholdControl.maxNumber !== "100") {
      throw new Error(`Expected dual threshold control to sync sliders and number inputs: ${JSON.stringify(thresholdControl)}`);
    }
    if (thresholdClampState.minRange !== "100" || thresholdClampState.maxRange !== "100") {
      throw new Error(`Expected min threshold typing to stop at the max handle: ${JSON.stringify(thresholdClampState)}`);
    }
    if (thresholdTypedState.minRange !== "80" || thresholdTypedState.maxRange !== "100") {
      throw new Error(`Expected typed min threshold to update the slider: ${JSON.stringify(thresholdTypedState)}`);
    }
    if (!fastestSearchDefaultUnchecked) {
      throw new Error("Expected fastest search to be opt-in so broader candidate search is the default.");
    }
    if (!labelStatusEnabledAfterLoad) throw new Error("Expected label status filters to enable after loading a dataset.");
    if (!thresholdFilteredScores.length || thresholdFilteredScores.some((score) => score < 80 || score > 100)) {
      throw new Error(`Expected max threshold to limit visible scores to 80-100: ${JSON.stringify(thresholdFilteredScores)}`);
    }
    if (customFilterState.defaultLogicMode !== "and" || customFilterState.logicMode !== "custom") {
      throw new Error(`Expected filter logic to default to AND and expose custom logic by choice: ${JSON.stringify(customFilterState)}`);
    }
    if (JSON.stringify(customFilterState.logicOptions.map((option) => option.value)) !== JSON.stringify(["and", "custom"])) {
      throw new Error(`Expected filter logic dropdown to include only AND and custom options: ${JSON.stringify(customFilterState.logicOptions)}`);
    }
    if (customFilterState.singleFilterIndexCount !== 0 || customFilterState.multipleFilterIndexCount < 2) {
      throw new Error(`Expected filter row numbers only when there is more than one filter: ${JSON.stringify(customFilterState)}`);
    }
    if (!customFilterState.singleFilterLayout.stacked || !customFilterState.singleFilterLayout.withinPanel || customFilterState.singleFilterLayout.horizontalOverflow) {
      throw new Error(`Expected left-rail filter controls to stack cleanly inside the Match Controls card: ${JSON.stringify(customFilterState.singleFilterLayout)}`);
    }
    if (customFilterState.filteredCount !== 2 || customFilterState.logicValue !== "1 OR 2") {
      throw new Error(`Expected custom boolean filters to narrow the group list: ${JSON.stringify(customFilterState)}`);
    }
    if (customFilterState.fieldOptions.some((label) => ["Label Status", "Review Status", "Match Score", "Match Type"].includes(label))) {
      throw new Error(`Expected custom filter fields to be record fields only: ${JSON.stringify(customFilterState.fieldOptions)}`);
    }
    if (!customFilterState.fieldOptions.includes("Email")) {
      throw new Error(`Expected record field filters to include Email: ${JSON.stringify(customFilterState.fieldOptions)}`);
    }
    if (!customFilterState.dateOperators.includes("relative date")) {
      throw new Error(`Expected date filters to expose Salesforce-compatible relative dates: ${JSON.stringify(customFilterState)}`);
    }
    if (sortPressed !== "true") throw new Error("Expected group sort toggle to respond.");
    if (!sortTopState.firstSelected || sortTopState.scrollTop > 1 || !sortTopState.scoresAscending) {
      throw new Error(`Expected sorting ascending to keep the first visible group selected at the top: ${JSON.stringify(sortTopState)}`);
    }
    if (!separatedBadgeVisible) throw new Error("Expected Separate action to show a separated-record badge.");
    if (!fieldResolutionSelectable) throw new Error("Expected visible field-resolution selects to contain options.");
    if (
      !trainingLabelRerenderState.matchActiveAfterMatch ||
      !trainingLabelRerenderState.notMatchActiveAfterRelabel ||
      trainingLabelRerenderState.matchActiveAfterRelabel ||
      trainingLabelRerenderState.notMatchPressedAfterRelabel !== "true"
    ) {
      throw new Error(`Expected training label buttons to rerender after relabeling the same pair: ${JSON.stringify(trainingLabelRerenderState)}`);
    }
    if (!trainingExportEnabled) throw new Error("Expected training label action to enable label export.");
    if (!fullLabelIndicators) throw new Error("Expected fully labeled groups to show a green label indicator.");
    if (labelStatusFilterState.countBeforeApply !== labelStatusFilterState.startingCount || !labelStatusFilterState.applyEnabledAfterChange) {
      throw new Error(`Expected label status checkboxes to stage changes until Apply is clicked: ${JSON.stringify(labelStatusFilterState)}`);
    }
    if (!labelStatusFilterState.filteredCount || !labelStatusFilterState.visibleFullCount) {
      throw new Error(`Expected label status checkboxes to filter fully labeled groups: ${JSON.stringify(labelStatusFilterState)}`);
    }
    if (!labelStatusFilterState.applyDisabledAfterApply) {
      throw new Error(`Expected label status Apply to disable after applying staged changes: ${JSON.stringify(labelStatusFilterState)}`);
    }
    if (!duplicateBadges) throw new Error("Expected at least one Duplicate decision badge.");
    if (!notDuplicateBadges) throw new Error("Expected at least one Not Duplicate decision badge.");
    if (!mergeMasterRadios) throw new Error("Expected Contact merge master radios.");
    if (!mergeFieldRadios) throw new Error("Expected Contact merge field radios.");
    if (!mergeMasterCanChange) throw new Error("Expected Contact merge master radio selection to change.");
    if (!leadSourceRule.found || leadSourceRule.status !== "Oldest record rule" || !leadSourceRule.checkedValues.includes("Web")) {
      throw new Error(`Expected Lead Source to be locked to the oldest-created Contact: ${JSON.stringify(leadSourceRule)}`);
    }
    if (leadSourceRule.disabledCount !== leadSourceRule.radioCount || !leadSourceRule.hasHardRuleClass) {
      throw new Error(`Expected Lead Source hard-rule radios to be disabled and visually marked: ${JSON.stringify(leadSourceRule)}`);
    }
    if (!mergeFieldCanChange) throw new Error("Expected Contact merge field radio selection to change.");
    if (
      !staleRefreshState.preMergeCalled ||
      !staleRefreshState.refreshCalled ||
      staleRefreshState.mergeCalled ||
      !staleRefreshState.dialogMessage.includes("Refresh Latest Contacts")
    ) {
      throw new Error(`Expected stale pre-merge data to prompt and refresh without merging: ${JSON.stringify(staleRefreshState)}`);
    }
    if (
      !staleFailureCardRefreshState.preMergeCalled ||
      !staleFailureCardRefreshState.cardVisible ||
      !staleFailureCardRefreshState.refreshButtonVisible ||
      !staleFailureCardRefreshState.refreshCalled ||
      staleFailureCardRefreshState.mergeCalled ||
      !staleFailureCardRefreshState.dismissedDialogMessage.includes("Refresh Latest Contacts") ||
      !staleFailureCardRefreshState.buttonDialogMessage.includes("Refresh Latest Contacts")
    ) {
      throw new Error(`Expected stale pre-merge failure card to offer a Contacts refresh: ${JSON.stringify(staleFailureCardRefreshState)}`);
    }
    if (
      !missingContactIdRefreshState.noticeVisible ||
      !missingContactIdRefreshState.refreshButtonVisible ||
      !missingContactIdRefreshState.refreshCalled ||
      missingContactIdRefreshState.preMergeCalled ||
      missingContactIdRefreshState.mergeCalled ||
      !missingContactIdRefreshState.dialogMessage.includes("Contact IDs are required")
    ) {
      throw new Error(`Expected missing Contact IDs to block merge and offer a Contacts refresh: ${JSON.stringify(missingContactIdRefreshState)}`);
    }
    if (
      !missingContactIdFallbackRefreshState.noticeVisible ||
      !missingContactIdFallbackRefreshState.refreshButtonVisible ||
      missingContactIdFallbackRefreshState.refreshButtonText !== "Load Latest Contacts" ||
      !missingContactIdFallbackRefreshState.refreshCalled ||
      missingContactIdFallbackRefreshState.preMergeCalled ||
      missingContactIdFallbackRefreshState.mergeCalled ||
      !missingContactIdFallbackRefreshState.dialogMessage.includes("Load Latest Contacts")
    ) {
      throw new Error(`Expected local Contacts without IDs to offer loading Latest Contacts: ${JSON.stringify(missingContactIdFallbackRefreshState)}`);
    }
    if (
      mergePayload.preMergePayload?.orgAlias !== primaryOrg.orgAlias ||
      mergePayload.preMergePayload?.instanceUrl !== primaryOrg.instanceUrl ||
      mergePayload.orgAlias !== primaryOrg.orgAlias ||
      mergePayload.instanceUrl !== primaryOrg.instanceUrl
    ) {
      throw new Error(`Expected Salesforce merge requests to honor the selected org: ${JSON.stringify({ preMergePayload: mergePayload.preMergePayload, mergePayload })}`);
    }
    if (mergePayload.masterFields?.LeadSource !== "Web") {
      throw new Error(`Expected Salesforce merge payload to preserve oldest Lead Source: ${JSON.stringify(mergePayload)}`);
    }
    if (!mergePayload.preMergePayload?.records?.length) {
      throw new Error(`Expected Salesforce pre-merge freshness check to include loaded records: ${JSON.stringify(mergePayload)}`);
    }
    if (!mergePayload.records?.length) {
      throw new Error(`Expected Salesforce merge payload to include loaded freshness records: ${JSON.stringify(mergePayload)}`);
    }
    if (
      mergePayload.preMergePayload.masterId !== mergePayload.masterId ||
      JSON.stringify(mergePayload.preMergePayload.mergeIds || []) !== JSON.stringify(mergePayload.mergeIds || [])
    ) {
      throw new Error(`Expected pre-merge check and merge payload to target the same records: ${JSON.stringify(mergePayload)}`);
    }
    if (
      !mergePayload.reviewVisible ||
      !mergePayload.confirmVisible ||
      !mergePayload.cancelVisible ||
      mergePayload.mergeSentBeforeConfirm ||
      !mergePayload.previewClearedAfterCancel ||
      mergePayload.mergeSentAfterCancel ||
      !mergePayload.successPanelVisible ||
      mergePayload.mergeSubmitCountAfterSuccess !== 0 ||
      !mergePayload.nextAdvanced ||
      !mergePayload.leftRailNavigationWorked ||
      !mergePayload.payloadsAligned ||
      mergePayload.dialogMessages.length
    ) {
      throw new Error(`Expected the queued merge review flow to render, navigate, cancel, and confirm correctly: ${JSON.stringify(mergePayload)}`);
    }
    if (
      !mergeReportDownloadState.buttonVisible ||
      !mergeReportDownloadState.downloaded ||
      !mergeReportDownloadState.csv.includes("Salesforce ID") ||
      !mergeReportDownloadState.csv.includes(mergePayload.masterId || "") ||
      !mergeReportDownloadState.csv.includes((mergePayload.mergeIds || [])[0] || "") ||
      !mergeReportDownloadState.csv.includes(mergePayload.records?.[0]?.name || "") ||
      !mergeReportDownloadState.csv.includes(mergePayload.records?.[0]?.fields?.firstName || "") ||
      !mergeReportDownloadState.csv.includes(mergePayload.records?.[0]?.fields?.lastName || "") ||
      !mergeReportDownloadState.csv.includes("Retained as master") ||
      !mergeReportDownloadState.csv.includes("Merged into master")
    ) {
      throw new Error(`Expected merge result to expose a downloadable CSV status report: ${JSON.stringify(mergeReportDownloadState)}`);
    }
    if (!accountMergeDisabled) throw new Error("Expected Account merge mode to be disabled.");
    if (!shortcutsVisible) throw new Error("Expected shortcuts modal to be visible.");
    if (!rootScrollPolicy.ok) throw new Error(`Root scrolling is suppressed: ${JSON.stringify(rootScrollPolicy)}`);
    if (!scrollTrapState.ok) {
      throw new Error(`Primary content extends below a non-scrollable container: ${JSON.stringify(scrollTrapState)}`);
    }
    if (workspaceColumnScroll.hasOverflow && !workspaceColumnScroll.scrolled) {
      throw new Error(`Workspace column has clipped content but did not scroll: ${JSON.stringify(workspaceColumnScroll)}`);
    }
    if (!rightPaneScrollModel.ok) {
      throw new Error(`Expected the right pane to use one continuous vertical scroll path: ${JSON.stringify(rightPaneScrollModel)}`);
    }
    if (mobileScroll.hasOverflow && !mobileScroll.scrolled) {
      throw new Error(`Mobile page has clipped content but did not scroll: ${JSON.stringify(mobileScroll)}`);
    }
    [
      ["empty state", emptyInteractiveReachability],
      ["loaded review", loadedInteractiveReachability],
      ["merge bottom", interactiveReachability],
      ["mobile", mobileInteractiveReachability]
    ].forEach(([label, reachability]) => {
      if (reachability.broken.length) {
        throw new Error(`Visible interactive controls are not reachable in ${label}: ${JSON.stringify(reachability.broken)}`);
      }
    });
    if (layout.pageScrollWidth > layout.viewportWidth || layout.bodyScrollWidth > layout.viewportWidth) {
      throw new Error(`Unexpected horizontal overflow: ${JSON.stringify(layout)}`);
    }
    if (messages.length) throw new Error(`Browser console warnings/errors: ${messages.join(" | ")}`);

    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      emptyDuplicateImportCount,
      emptyDemoVisible,
      emptyImportButtonState,
      latestRecentFiles,
      csvMenuClosed,
      matchControlsExpanded,
      thresholdReadout,
      thresholdControl,
      thresholdClampState,
      thresholdTypedState,
      lightTheme,
      darkTheme,
      lightPaneSurfaces,
      darkPaneSurfaces,
      loadingProgressbar,
      loadingStatusSamples,
      latestJsonLoad,
      latestJsonLoadElapsedMs,
      lastNameChangeCandidateState,
      largeContactPerformance,
      sharedCompanyExactPhoneNameConflictState,
      performanceBudgets: PERFORMANCE_BUDGETS,
      leftPaneSmallListLayout,
      humeRegionLayout,
      topbarImportState,
      fastestSearchDefaultUnchecked,
      thresholdFilteredScores,
      cachedThresholdRebuildState,
      customFilterState,
      sortPressed,
      sortTopState,
      separatedBadgeVisible,
      fieldResolutionSelects,
      trainingExportEnabled,
      fullLabelIndicators,
      duplicateBadges,
      notDuplicateBadges,
      mergeMasterRadios,
      mergeFieldRadios,
      mergeMasterCanChange,
      leadSourceRule,
      mergeFieldCanChange,
      staleRefreshState,
      staleFailureCardRefreshState,
      missingContactIdRefreshState,
      missingContactIdFallbackRefreshState,
      mergePayload,
      accountMergeDisabled,
      datasetExportState,
      shortcutsVisible,
      fileModeRedirect,
      rootScrollPolicy,
      scrollTrapState,
      workspaceColumnScroll,
      rightPaneScrollModel,
      mobileScroll,
      interactiveCounts: {
        empty: emptyInteractiveReachability.count,
        loaded: loadedInteractiveReachability.count,
        merge: interactiveReachability.count,
        mobile: mobileInteractiveReachability.count
      },
      layout,
      screenshotsDir: outDir
    }, null, 2));
  } catch (error) {
    if (messages.length) {
      console.error(`Browser console warnings/errors before failure: ${messages.join(" | ")}`);
    }
    throw error;
  } finally {
    if (context) {
      await context.close();
    }
    await browser.close();
  }
}

function canonicalSalesforceOrgAlias(alias, instanceUrl = "") {
  const text = String(alias || "").trim();
  if (text.toLowerCase() !== "staging") return text;
  return String(instanceUrl || "").includes("politico--staging.sandbox.my.salesforce.com") ? "politico-staging" : text;
}

function isExpectedBrowserConsoleMessage(message) {
  return message.type() === "error" && /server responded with a status of 409 \(Conflict\)/i.test(message.text());
}

async function assertEmptyStateOmitsDuplicateImportAction(browser) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const diagnostics = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      diagnostics.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator('[data-empty-action="demo-data"]').waitFor({ state: "visible", timeout: 5000 });
    const duplicateImportButtonCount = await page.locator('[data-empty-action="choose-csv"]').count();
    const demoButtonVisible = await page.locator('[data-empty-action="demo-data"]').isVisible();
    return {
      duplicateImportButtonCount,
      demoButtonVisible
    };
  } finally {
    await page.close();
  }
}

async function assertLastNameChangeCandidateMatch(browser, filePath) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const diagnostics = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      diagnostics.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await importContactsThroughMenu(page, filePath);
    await waitForLoadingModalHidden(page, "Last-name-change Contact candidate load", diagnostics);
    await waitForFirstGroup(page, "Last-name-change Contact candidate load");
    return {
      ...(await datasetLoadState(page)),
      ...(await page.evaluate(() => ({
        firstGroupScore: state.groups[0]?.score || 0,
        firstGroupReasons: state.groups[0]?.reasons || []
      })))
    };
  } finally {
    await page.close();
  }
}

async function assertDifferentCompanyConflictSeparated(browser, filePath) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const diagnostics = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      diagnostics.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await importContactsThroughMenu(page, filePath);
    await waitForLoadingModalHidden(page, "Different-company Contact load", diagnostics);
    await setRangeValue(page, "#threshold", "80");
    await setRangeValue(page, "#maxThreshold", "99");
    await page.locator("#applyControlsButton").click();
    await page.locator("#loadingModal").waitFor({ state: "hidden", timeout: 10000 });
    return {
      ...(await datasetLoadState(page))
    };
  } finally {
    await page.close();
  }
}

async function assertSharedCompanyExactPhoneNameConflictSeparated(browser, filePath) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const diagnostics = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      diagnostics.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await importContactsThroughMenu(page, filePath);
    await waitForLoadingModalHidden(page, "Shared-company exact-phone Contact load", diagnostics);
    const loadState = await datasetLoadState(page);
    const runtimeScore = await page.evaluate(() => {
      const preparedRows = prepareRows(state.rows, state.objectType, state.mapping);
      const score = scoreContactPair(preparedRows[0], preparedRows[1]);
      return {
        score: Math.round(score.value),
        reasons: score.reasons
      };
    });

    if (loadState.groupCount !== 0) {
      throw new Error(`Expected the divergent-name pair to stay below the duplicate threshold: ${JSON.stringify({ loadState, runtimeScore })}`);
    }

    return {
      ...loadState,
      runtimeScore: runtimeScore.score,
      reasons: runtimeScore.reasons
    };
  } finally {
    await page.close();
  }
}

async function assertMirrorRelationshipSeparated(browser, filePath) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const diagnostics = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      diagnostics.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await importContactsThroughMenu(page, filePath);
    await waitForLoadingModalHidden(page, "Mirror relationship Contact load", diagnostics);
    await waitForFirstGroup(page, "Mirror relationship Contact load");
    const groupMemberships = await page.evaluate(() => {
      return state.groups.map((group) => ({
        status: group.status || "duplicate",
        score: group.score,
        reason: group.exclusionReason || group.reasons?.[0] || "",
        recordIds: group.records.map((record) => record.Id)
      }));
    });

    if (!groupMemberships.length) {
      throw new Error("Expected at least one duplicate group for the mirror-bridge regression.");
    }
    if (groupMemberships.some((group) => group.status !== "excluded" && group.recordIds.includes("003R00000000001") && group.recordIds.includes("003R00000000002"))) {
      throw new Error(`Mirror relationship regression failed: mirrored contacts were grouped together: ${JSON.stringify(groupMemberships)}`);
    }
    if (!groupMemberships.some((group) => group.status === "excluded" && group.score === 0 && group.reason.includes("Entitled Contact mirror"))) {
      throw new Error(`Mirror relationship regression failed: expected a visible excluded mirror group: ${JSON.stringify(groupMemberships)}`);
    }
    if (!groupMemberships.some((group) => group.status !== "excluded" && group.recordIds.length >= 2)) {
      throw new Error(`Mirror relationship regression failed: expected a surviving duplicate group after splitting the mirror bridge: ${JSON.stringify(groupMemberships)}`);
    }

    const excludedRow = page.locator('.group-item[data-group-status="excluded"]').first();
    await excludedRow.waitFor({ state: "visible", timeout: 5000 });
    const excludedRowText = await excludedRow.textContent();
    if (!excludedRowText?.includes("Excluded") || !excludedRowText.includes("Entitled Contact mirror")) {
      throw new Error(`Mirror relationship regression failed: excluded row styling/copy was missing: ${excludedRowText}`);
    }

    const excludedFilter = page.locator('[data-group-status-filter][value="excluded"]');
    const duplicateFilter = page.locator('[data-group-status-filter][value="duplicate"]');
    await excludedFilter.check();
    await page.locator("[data-group-status-apply]").click();
    await page.waitForFunction(() => document.querySelector("#groupCount")?.textContent?.trim() === "1", null, { timeout: 5000 });
    const excludedOnlyState = await page.evaluate(() => ({
      groupCount: document.querySelector("#groupCount")?.textContent?.trim() || "",
      statuses: [...document.querySelectorAll(".group-item")].map((item) => item.dataset.groupStatus)
    }));
    if (excludedOnlyState.groupCount !== "1" || excludedOnlyState.statuses.some((status) => status !== "excluded")) {
      throw new Error(`Mirror relationship regression failed: excluded filter did not isolate excluded groups: ${JSON.stringify(excludedOnlyState)}`);
    }

    await excludedFilter.uncheck();
    await duplicateFilter.check();
    await page.locator("[data-group-status-apply]").click();
    await page.waitForFunction(() => document.querySelector("#groupCount")?.textContent?.trim() !== "0", null, { timeout: 5000 });
    const duplicateOnlyState = await page.evaluate(() => ({
      statuses: [...document.querySelectorAll(".group-item")].map((item) => item.dataset.groupStatus)
    }));
    if (!duplicateOnlyState.statuses.length || duplicateOnlyState.statuses.some((status) => status === "excluded")) {
      throw new Error(`Mirror relationship regression failed: duplicate-only filter still showed excluded groups: ${JSON.stringify(duplicateOnlyState)}`);
    }

    await duplicateFilter.uncheck();
    await page.locator("[data-group-status-apply]").click();
    await excludedRow.waitFor({ state: "visible", timeout: 5000 });
    await excludedRow.locator(".group-item-main").click();
    await page.locator("#duplicateButton").click();
    const mergeModeButton = page.locator('[data-review-mode="merge"]');
    await mergeModeButton.click();
    await page.locator(".salesforce-merge-panel").waitFor({ state: "visible", timeout: 5000 });
    const mergeBlockedState = await page.evaluate(() => ({
      decisionStatus: document.querySelector("#decisionStatus")?.textContent?.trim() || "",
      warningText: document.querySelector(".excluded-merge-notice span")?.textContent?.trim() || "",
      submitDisabled: Boolean(document.querySelector(".merge-submit-button")?.disabled)
    }));
    if (
      !mergeBlockedState.decisionStatus.includes("Duplicate") ||
      !mergeBlockedState.warningText.includes("cannot enter the Salesforce merge queue") ||
      !mergeBlockedState.submitDisabled
    ) {
      throw new Error(`Mirror relationship regression failed: excluded merge warning/blocking was wrong: ${JSON.stringify(mergeBlockedState)}`);
    }

    return {
      ...(await datasetLoadState(page)),
      groupMemberships,
      mergeBlockedState
    };
  } finally {
    await page.close();
  }
}

async function assertLargeContactCsvPerformance(browser, filePath) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const diagnostics = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      diagnostics.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const startedAt = Date.now();
    await importContactsThroughMenu(page, filePath);
    await waitForLoadingModalHidden(page, "Large Contact CSV performance load", diagnostics, PERFORMANCE_BUDGETS.largeContactCsvWorkerMs);
    await waitForFirstGroup(page, "Large Contact CSV performance load");
    const groupListScrollLockState = await exerciseGroupListScrollAfterSelection(page);
    const matchControlsButton = page.getByRole("button", { name: /Match Controls/ });
    if (await matchControlsButton.getAttribute("aria-expanded") !== "true") {
      await matchControlsButton.click();
    }
    const largeContactFilterStartedAt = Date.now();
    const firstFilterRow = page.locator(".filter-row").first();
    await firstFilterRow.locator(".filter-field-select").selectOption("email");
    await firstFilterRow.locator(".filter-operator-select").selectOption("contains");
    await firstFilterRow.locator(".filter-value-control").fill("person1@perf1.example");
    await page.locator("#applyControlsButton").click();
    await page.waitForFunction(() => {
      const groupCount = document.querySelector("#groupCount");
      return groupCount?.textContent?.replace(/,/g, "").trim() === "1";
    }, null, { timeout: 30000 });
    const largeContactFilterApplyElapsedMs = Date.now() - largeContactFilterStartedAt;
    assertPerformanceBudget(
      "large Contact CSV custom filter apply",
      largeContactFilterApplyElapsedMs,
      PERFORMANCE_BUDGETS.largeContactCsvFilterApplyMs
    );
    return {
      elapsedMs: Date.now() - startedAt,
      ...(await datasetLoadState(page)),
      groupListScrollLockState,
      largeContactFilterApplyElapsedMs
    };
  } finally {
    await page.close();
  }
}

async function assertLargeContactJsonDeferredIngest(browser, filePath) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const diagnostics = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      diagnostics.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const startedAt = Date.now();
    await importContactsThroughMenu(page, filePath);
    await waitForLoadingModalHidden(page, "Large Contact JSON deferred load", diagnostics, 60000);
    await page.waitForFunction(() => {
      const applyButton = document.querySelector("#applyControlsButton");
      return state.matchingDeferred === true &&
        state.groups.length === 0 &&
        applyButton?.textContent?.trim() === "Match now";
    }, null, { timeout: 10000 });
    const preMatchState = await page.evaluate(() => ({
      rowCount: state.rows.length,
      groupCount: state.groups.length,
      sourcePillText: document.querySelector("#sourcePill")?.textContent?.trim() || "",
      applyButtonText: document.querySelector("#applyControlsButton")?.textContent?.trim() || "",
      reviewStateStatus: state.reviewStateStatus || "",
      matchingDeferred: state.matchingDeferred,
      loadPhase: state.loadPhase || ""
    }));
    const loadElapsedMs = Date.now() - startedAt;
    await page.locator("#applyControlsButton").click();
    await waitForFirstGroup(page, "Large Contact JSON explicit match");
    return {
      loadElapsedMs,
      elapsedMs: Date.now() - startedAt,
      ...preMatchState,
      ...(await datasetLoadState(page))
    };
  } finally {
    await page.close();
  }
}

async function waitForLoadingModalHidden(page, context, diagnostics = [], timeout = 10000) {
  try {
    await page.locator("#loadingModal").waitFor({ state: "hidden", timeout });
  } catch (error) {
    const debugState = await page.evaluate(() => ({
      loadingModalHidden: document.querySelector("#loadingModal")?.hidden ?? null,
      loadingTitle: document.querySelector("#loadingModalTitle")?.textContent?.trim() || "",
      loadingMessage: document.querySelector("#loadingModalMessage")?.textContent?.trim() || "",
      loadingStatus: document.querySelector("#loadingSplineStatus")?.textContent?.trim() || "",
      progressNow: document.querySelector("#loadingProgress")?.getAttribute("aria-valuenow") || "",
      loadError: state.loadError,
      reviewStateStatus: state.reviewStateStatus,
      isLoadingFile: state.isLoadingFile,
      loadingFileName: state.loadingFileName,
      matchingDeferred: state.matchingDeferred,
      loadPhase: state.loadPhase,
      rowCount: state.rows.length,
      groupCount: state.groups.length,
      processingMode: state.lastProcessingMode
    }));
    throw new Error(`${context} did not finish hiding the loading modal: ${JSON.stringify({ debugState, diagnostics })}`);
  }
}

async function importContactsThroughMenu(page, filePath) {
  await page.locator("#chooseCsvButton").click();
  await page.getByRole("menuitem", { name: "Contacts" }).waitFor({ state: "visible", timeout: 5000 });
  const startedAt = Date.now();
  const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 5000 });
  await page.getByRole("menuitem", { name: "Contacts" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(filePath);
  await waitForLoadingModalHidden(page, "Topbar Import Contacts load");
  return {
    fileChooserOpened: true,
    elapsedMs: Date.now() - startedAt,
    ...(await datasetLoadState(page))
  };
}

function csvDataRowCount(csvText) {
  return csvText.trim().split(/\r?\n/).length - 1;
}

function visibleInteractiveReachability(page) {
  return sharedVisibleInteractiveReachability(page, REACHABILITY_OPTIONS);
}

async function waitForFirstGroup(page, label) {
  try {
    await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: GROUP_ITEM_VISIBLE_TIMEOUT_MS });
  } catch (error) {
    const debugState = await duplicateReviewerDebugState(page);
    console.error(`${label} did not render a visible group: ${JSON.stringify(debugState)}`);
    throw error;
  }
}

async function datasetLoadState(page) {
  return page.evaluate(() => ({
    fileName: state.fileName,
    objectType: state.objectType,
    rowCount: state.rows.length,
    groupCount: state.groups.length,
    workerAvailable: typeof Worker !== "undefined",
    processingMode: state.lastProcessingMode,
    matchingStats: state.lastMatchingStats,
    sourceOrgAlias: state.datasetSource?.orgAlias || "",
    sourceInstanceUrl: state.datasetSource?.instanceUrl || ""
  }));
}

async function exerciseTrainingLabelRerender(page) {
  const matchButton = page.locator('[data-label-action="match"]').first();
  const notMatchButton = page.locator('[data-label-action="not_match"]').first();
  if (!(await matchButton.isVisible())) {
    return {
      available: false,
      matchActiveAfterMatch: false,
      matchActiveAfterRelabel: false,
      notMatchActiveAfterRelabel: false,
      notMatchPressedAfterRelabel: ""
    };
  }

  await matchButton.click();
  await page.waitForFunction(() => {
    const button = document.querySelector('[data-label-action="match"]');
    return button?.classList.contains("is-active") && button?.getAttribute("aria-pressed") === "true";
  }, null, { timeout: 5000 });
  const matchActiveAfterMatch = await matchButton.evaluate((button) => button.classList.contains("is-active"));

  await notMatchButton.click();
  await page.waitForFunction(() => {
    const match = document.querySelector('[data-label-action="match"]');
    const notMatch = document.querySelector('[data-label-action="not_match"]');
    return !match?.classList.contains("is-active") &&
      notMatch?.classList.contains("is-active") &&
      notMatch?.getAttribute("aria-pressed") === "true";
  }, null, { timeout: 5000 });

  return {
    available: true,
    matchActiveAfterMatch,
    matchActiveAfterRelabel: await matchButton.evaluate((button) => button.classList.contains("is-active")),
    notMatchActiveAfterRelabel: await notMatchButton.evaluate((button) => button.classList.contains("is-active")),
    notMatchPressedAfterRelabel: await notMatchButton.getAttribute("aria-pressed")
  };
}

async function reportSummaryState(page) {
  return page.locator("#metrics").evaluate((node) => {
    const stats = [...node.querySelectorAll("[data-summary-metric]")];
    const firstValue = stats[0]?.querySelector(".report-stat-value");
    const detailTitle = document.querySelector("#detailTitle");
    const matchScore = document.querySelector(".pair-summary strong");
    const reviewPane = document.querySelector(".review-pane");
    const reviewHeader = document.querySelector(".review-header");
    const styleFor = (element) => {
      const style = element ? getComputedStyle(element) : null;
      return {
        fontSize: style?.fontSize || "",
        fontWeight: style?.fontWeight || "",
        backgroundColor: style?.backgroundColor || ""
      };
    };
    const valueStyle = styleFor(firstValue);
    const titleStyle = styleFor(detailTitle);
    const matchScoreStyle = styleFor(matchScore);
    const summaryStyle = styleFor(node);
    const reviewPaneStyle = styleFor(reviewPane);
    const reviewHeaderStyle = styleFor(reviewHeader);
    const valueSize = Number.parseFloat(valueStyle.fontSize) || 0;
    const titleSize = Number.parseFloat(titleStyle.fontSize) || 0;
    const matchScoreSize = Number.parseFloat(matchScoreStyle.fontSize) || 0;
    return {
      className: node.className,
      labels: stats.map((stat) => stat.querySelector(".report-stat-label")?.textContent?.trim() || ""),
      values: Object.fromEntries(stats.map((stat) => [
        stat.dataset.summaryMetric,
        stat.querySelector(".report-stat-value")?.textContent?.trim() || ""
      ])),
      typography: {
        valueSize,
        titleSize,
        matchScoreSize,
        valueWeight: valueStyle.fontWeight,
        titleWeight: titleStyle.fontWeight,
        sizesAligned: Math.abs(valueSize - matchScoreSize) <= 0.5 && Math.abs(titleSize - matchScoreSize) <= 0.5
      },
      surface: {
        summaryBackground: summaryStyle.backgroundColor,
        reviewHeaderBackground: reviewHeaderStyle.backgroundColor,
        canvasBackground: reviewPaneStyle.backgroundColor
      },
      text: node.textContent?.trim() || ""
    };
  });
}

function fontWeightNumber(value) {
  if (value === "normal") return 400;
  if (value === "bold") return 700;
  return Number.parseFloat(value) || 0;
}

async function duplicateReviewerDebugState(page) {
  return page.evaluate(() => ({
    objectType: state.objectType,
    rowCount: state.rows.length,
    groupCount: state.groups.length,
    reviewMode: state.reviewMode,
    selectedGroupKey: state.selectedGroupKey,
    mergeReviewActive: typeof mergeReviewSession !== "undefined" ? mergeReviewSession.active : null,
    mergeReviewQueueCount: typeof mergeReviewSession !== "undefined" ? mergeReviewSession.queueGroupKeys.length : null,
    matchingDeferred: state.matchingDeferred,
    loadPhase: state.loadPhase,
    sourcePillText: document.querySelector("#sourcePill")?.textContent?.trim() || "",
    applyButtonText: document.querySelector("#applyControlsButton")?.textContent?.trim() || "",
    visibleGroupNodes: document.querySelectorAll(".group-item-main").length,
    threshold: state.threshold,
    maxThreshold: state.maxThreshold,
    filterCount: state.filters.length,
    filterLogicMode: state.filterLogicMode,
    labelStatusFilters: [...state.labelStatusFilters],
    pendingLabelStatusFilters: [...state.pendingLabelStatusFilters],
    loadError: state.loadError,
    reviewStateStatus: state.reviewStateStatus,
    groupListText: document.querySelector("#groupList")?.textContent?.trim().slice(0, 400) || ""
  }));
}

async function loadingProgressbarState(page) {
  const locator = page.locator("#loadingProgress");
  if (await locator.count() !== 1) return { exists: false, role: "", min: "", max: "", now: "" };
  return locator.evaluate((element) => ({
    ...(() => {
      const status = document.querySelector("#loadingSplineStatus");
      const colorToRgb = (value) => {
        const probe = document.createElement("span");
        probe.style.color = value;
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      };
      return {
        exists: true,
        role: element.getAttribute("role") || "",
        min: element.getAttribute("aria-valuemin") || "",
        max: element.getAttribute("aria-valuemax") || "",
        now: element.getAttribute("aria-valuenow") || "",
        splineText: status?.textContent?.trim() || "",
        splineColor: status ? getComputedStyle(status).color : "",
        secondaryAccentStrong: colorToRgb(getComputedStyle(document.documentElement).getPropertyValue("--managed-secondary-accent-strong").trim())
      };
    })()
  }));
}

async function loadingStatusRotationState(page) {
  return page.evaluate(() => {
    if (typeof loadingProgressStatusText !== "function") return [];
    return [
      ["Parsing CSV.", 4],
      ["Preparing records.", 8],
      ["Preparing account field statistics (10 of 100).", 18],
      ["Building candidate buckets (42 of 100).", 24],
      ["Finding candidate pairs (12 found).", 34],
      ["Scoring candidate pairs (250 of 500).", 56],
      ["Scoring candidate pairs (400 of 500).", 68],
      ["Sorting scored pairs.", 78],
      ["Building match groups.", 82],
      ["Rendering duplicate groups.", 98],
      ["Restoring saved review state.", 99]
    ].map(([message, progress]) => loadingProgressStatusText(message, progress));
  });
}

async function assertLatestRecentFiles(page) {
  await page.locator(".recent-file").filter({ hasText: "Contacts" }).first().waitFor({ state: "visible", timeout: 5000 });
  await page.locator(".recent-file").filter({ hasText: "Accounts" }).first().waitFor({ state: "visible", timeout: 5000 });

  return {
    contacts: await page.locator(".recent-file").filter({ hasText: "Contacts" }).count(),
    accounts: await page.locator(".recent-file").filter({ hasText: "Accounts" }).count()
  };
}

async function assertFileModeRedirect(browser) {
  const page = await browser.newPage();
  const indexUrl = new URL(pathToFileURL(path.join(__dirname, "..", "public", "index.html")).href);
  indexUrl.searchParams.set("server", baseUrl);
  indexUrl.searchParams.set("source", "staging-contacts");

  try {
    await page.goto(indexUrl.href, { waitUntil: "domcontentloaded" });
    await page.waitForURL((url) => {
      return url.origin === new URL(baseUrl).origin
        && url.searchParams.get("autoload") === "staging-contacts"
        && !url.searchParams.has("source")
        && !url.searchParams.has("server");
    }, { timeout: 5000 });
    return page.url();
  } finally {
    await page.close();
  }
}

async function assertProdContactsAutoload(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const prodDataset = {
    schema: "salesforce-duplicate-reviewer.dataset",
    schemaVersion: 1,
    objectType: "contact",
    fileName: "salesforce-prod-contacts-latest.json",
    source: {
      system: "salesforce",
      name: "Latest Prod Contacts",
      format: "salesforce-records-json",
      orgAlias: "qa-prod-org",
      instanceUrl: "https://qa-prod-org.example.invalid"
    },
    fields: [
      { apiName: "Id", label: "Id", type: "text" },
      { apiName: "Name", label: "Name", type: "text" },
      { apiName: "Email", label: "Email", type: "text" }
    ],
    records: [
      { Id: "003P00000000001", Name: "Prod Contact One", Email: "prod.one@example.com" },
      { Id: "003P00000000002", Name: "Prod Contact Two", Email: "prod.two@example.com" }
    ]
  };

  try {
    await page.route("**/api/staging/latest-files", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ files: [] }) });
    });
    await page.route("**/api/prod/latest-files", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          files: [
            {
              source: "prod-contacts",
              objectType: "contact",
              label: "Latest Prod Contacts",
              name: "salesforce-prod-contacts-latest.json",
              endpoint: "/api/prod-contacts/latest.json",
              size: 1,
              updatedAt: Date.now()
            }
          ]
        })
      });
    });
    await page.route("**/api/prod-contacts/latest.json", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: `${JSON.stringify(prodDataset)}\n`
      });
    });

    await page.goto(`${baseUrl}/?autoload=prod-contacts&object=contact&notify=1&sticky=1&name=salesforce-prod-contacts-latest.json`, {
      waitUntil: "domcontentloaded"
    });
    await page.waitForFunction(() => state.rows.length === 2 && state.objectType === "contact", null, { timeout: 10000 });

    const url = new URL(page.url());
    const autoloadState = await page.evaluate(() => ({
      fileName: state.fileName,
      sourceName: state.datasetMetadata?.source?.name || "",
      orgAlias: state.datasetSource?.orgAlias || "",
      instanceUrl: state.datasetSource?.instanceUrl || "",
      rowCount: state.rows.length,
      recentFiles: [...document.querySelectorAll(".recent-file")].map((node) => node.textContent.trim())
    }));

    if (
      url.searchParams.get("autoload") !== "prod-contacts" ||
      url.searchParams.get("object") !== "contact" ||
      url.searchParams.get("notify") !== "1" ||
      url.searchParams.get("sticky") !== "1" ||
      url.searchParams.get("name") !== "salesforce-prod-contacts-latest.json" ||
      autoloadState.fileName !== "salesforce-prod-contacts-latest.json" ||
      autoloadState.sourceName !== "Latest Prod Contacts" ||
      autoloadState.rowCount !== 2 ||
      autoloadState.orgAlias !== "qa-prod-org" ||
      autoloadState.instanceUrl !== "https://qa-prod-org.example.invalid" ||
      !autoloadState.recentFiles.some((text) => text.includes("Latest Prod Contacts"))
    ) {
      throw new Error(`Prod Contacts autoload regression failed: ${JSON.stringify(autoloadState)}`);
    }

    return autoloadState;
  } finally {
    await page.close();
  }
}

async function mergeLeadSourceRuleState(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll(".merge-matrix tbody tr")];
    const row = rows.find((item) => {
      return item.querySelector(".merge-field-name strong")?.textContent?.trim() === "Lead Source";
    });
    if (!row) return { found: false };

    const radios = [...row.querySelectorAll(".merge-field-radio")];
    return {
      found: true,
      status: row.querySelector(".merge-field-name span")?.textContent?.trim() || "",
      checkedValues: radios.filter((radio) => radio.checked).map((radio) => radio.value),
      disabledCount: radios.filter((radio) => radio.disabled).length,
      radioCount: radios.length,
      hasHardRuleClass: row.classList.contains("has-hard-rule")
    };
  });
}

async function captureMergePayload(page, csvPath) {
  const mergePayloads = [];
  const firstReviewPreMergePayloads = [];
  const secondReviewPreMergePayloads = [];
  let reviewPhase = "first";
  const dialogMessages = [];
  const handleDialog = async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept();
  };
  page.on("dialog", handleDialog);
  await importContactsThroughMenu(page, csvPath);
  await page.route("**/api/salesforce/premerge-check", async (route) => {
    const preMergePayload = JSON.parse(route.request().postData() || "{}");
    if (reviewPhase === "first") {
      firstReviewPreMergePayloads.push(preMergePayload);
    } else {
      secondReviewPreMergePayloads.push(preMergePayload);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        status: "fresh",
        checkedAt: new Date().toISOString(),
        objectType: "Contact",
        groupKey: preMergePayload.groupKey,
        masterId: preMergePayload.masterId,
        mergeIds: preMergePayload.mergeIds || [],
        ids: [preMergePayload.masterId, ...(preMergePayload.mergeIds || [])].filter(Boolean),
        missingIds: [],
        deletedIds: [],
        changedFields: [],
        currentRecords: [],
        loadedRecords: preMergePayload.records || []
      })
    });
  });
  await page.route("**/api/salesforce/merge", async (route) => {
    const payload = JSON.parse(route.request().postData() || "{}");
    mergePayloads.push(payload);
    const masterRecord = findMergePayloadRecord(payload, payload.masterId);
    const duplicateRecord = findMergePayloadRecord(payload, (payload.mergeIds || [])[0]);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        status: "success",
        objectType: "Contact",
        groupKey: payload.groupKey,
        masterId: payload.masterId,
        mergedRecordIds: payload.mergeIds || [],
        updatedRelatedIds: [],
        mergedAt: new Date().toISOString(),
        mergeReport: {
          generatedAt: new Date().toISOString(),
          fileName: "salesforce-merge-report-latest.csv",
          latestFileName: "salesforce-merge-report-latest.csv",
          csvPath: "/tmp/salesforce-merge-report-latest.csv",
          latestCsvPath: "/tmp/salesforce-merge-report-latest.csv",
          manifestPath: "/tmp/salesforce-merge-report-latest.json",
          latestManifestPath: "/tmp/salesforce-merge-report-latest.json",
          rowCount: 2,
          rows: buildMergeReportRows(payload, masterRecord, duplicateRecord)
        }
      })
    });
  });

  await waitForFirstGroup(page, "Merge payload fresh import");
  await page.locator(".group-item-main").first().click();
  await page.getByLabel("Duplicate review workspace").getByRole("button", { name: "Duplicate", exact: true }).click();
  await page.locator('[data-review-mode="merge"]').click();

  await page.locator(".merge-master-choice").first().waitFor({ state: "visible", timeout: 5000 });
  await page.evaluate(() => {
    const target = document.querySelector(".merge-master-radio");
    if (!target || typeof setMergeMasterSelection !== "function") return;
    setMergeMasterSelection(target.dataset.groupKey || "", target.value || "");
    if (typeof renderDetail === "function") renderDetail();
  });
  try {
    await page.locator(".merge-submit-button").click();
  } catch (error) {
    const masterDebug = await page.evaluate(() => {
      const radios = [...document.querySelectorAll(".merge-master-radio")];
      return {
        selectedMapValue: [...(mergeMasterSelections || new Map()).entries?.() || []],
        radios: radios.map((radio) => ({
          value: radio.value,
          checked: radio.checked,
          disabled: radio.disabled,
          groupKey: radio.dataset.groupKey || ""
        })),
        detailHtml: document.querySelector(".detail-surface")?.innerHTML || ""
      };
    });
    throw new Error(`Merge payload helper could not submit: ${JSON.stringify(masterDebug)}`);
  }
  await page.locator(".merge-review-panel").waitFor({ state: "visible", timeout: 5000 });
  await page.locator(".merge-confirmation-preview").waitFor({ state: "visible", timeout: 5000 });
  const reviewVisible = await page.locator(".merge-review-panel").isVisible();
  const confirmVisible = await page.locator(".merge-confirm-preview-button").isVisible();
  const cancelVisible = await page.locator(".merge-cancel-preview-button").isVisible();
  const previewState = await page.evaluate(() => {
    const panel = document.querySelector(".merge-confirmation-preview");
    const meta = [...document.querySelectorAll(".merge-confirmation-meta div")];
    const reviewOnlyRows = [...document.querySelectorAll('[data-merge-preview-kind="review-only"]')].map((node) => node.textContent.trim());
    return {
      title: panel?.querySelector("strong")?.textContent?.trim() || "",
      masterId: meta[0]?.querySelector("dd span")?.textContent?.trim() || "",
      duplicateCount: document.querySelectorAll(".merge-confirmation-preview .merge-id-chip").length,
      duplicateListCount: document.querySelectorAll(".merge-preview-list-item").length,
      reviewOnlyRows,
      reviewGroupCount: document.querySelectorAll(".group-item").length,
      currentPreviewLabel: document.querySelector(".merge-review-nav-status strong")?.textContent?.trim() || "",
      readOnly: !document.querySelector(".merge-master-radio") && !document.querySelector(".merge-field-radio")
    };
  });
  const mergeSentBeforeConfirm = mergePayloads.length > 0;

  let nextAdvanced = true;
  let leftRailNavigationWorked = true;
  if (!(await page.locator(".merge-review-next-button").isDisabled())) {
    const firstPreviewLabel = previewState.currentPreviewLabel;
    await page.locator(".merge-review-next-button").click();
    await page.waitForTimeout(100);
    const secondPreviewLabel = await page.locator(".merge-review-nav-status strong").textContent();
    nextAdvanced = Boolean(secondPreviewLabel && secondPreviewLabel.trim() && secondPreviewLabel.trim() !== firstPreviewLabel);

    await page.locator(".group-item-main").nth(2).click();
    await page.waitForTimeout(100);
    const leftRailPreviewLabel = await page.locator(".merge-review-nav-status strong").textContent();
    leftRailNavigationWorked = Boolean(leftRailPreviewLabel && leftRailPreviewLabel.includes("Contact group"));
  }

  await page.locator(".merge-cancel-preview-button").click();
  await page.locator(".merge-review-panel").waitFor({ state: "hidden", timeout: 5000 });
  const previewClearedAfterCancel = await page.locator(".merge-review-panel").count() === 0;
  const mergeSentAfterCancel = mergePayloads.length > 0;

  reviewPhase = "second";
  try {
    await page.locator(".merge-submit-button").click();
  } catch (error) {
    const debugState = await duplicateReviewerDebugState(page);
    const detailHtml = await page.evaluate(() => document.querySelector(".detail-surface")?.innerHTML || "");
    throw new Error(`Stale failure-card merge submit was not reachable: ${JSON.stringify({ debugState, detailHtml, state })}`);
  }
  await page.locator(".merge-review-panel").waitFor({ state: "visible", timeout: 5000 });
  await page.locator(".merge-confirm-preview-button").click();
  await page.locator(".merge-success-panel").waitFor({ state: "visible", timeout: 5000 });
  const successPanelVisible = await page.locator(".merge-success-panel").isVisible();
  const mergeSubmitCountAfterSuccess = await page.locator(".merge-submit-button").count();
  await page.unroute("**/api/salesforce/premerge-check");
  await page.unroute("**/api/salesforce/merge");
  page.off("dialog", handleDialog);
  const payloadsAligned = secondReviewPreMergePayloads.length === mergePayloads.length
    && secondReviewPreMergePayloads.every((preMergePayload, index) => {
      const payload = mergePayloads[index];
      return payload
        && preMergePayload.groupKey === payload.groupKey
        && preMergePayload.masterId === payload.masterId
        && JSON.stringify(preMergePayload.mergeIds || []) === JSON.stringify(payload.mergeIds || []);
    });
  const primaryPayload = mergePayloads[0] || {};
  const primaryMasterRecord = (primaryPayload.records || []).find((record) => record.id === primaryPayload.masterId) || null;
  return {
    ...primaryPayload,
    masterFields: {
      LeadSource: String(primaryMasterRecord?.fields?.leadSource || "")
    },
    preMergePayload: secondReviewPreMergePayloads[0] || firstReviewPreMergePayloads[0] || null,
    preMergePayloads: secondReviewPreMergePayloads,
    mergePayloads,
    reviewVisible,
    confirmVisible,
    cancelVisible,
    mergeSentBeforeConfirm,
    previewClearedAfterCancel,
    mergeSentAfterCancel,
    successPanelVisible,
    mergeSubmitCountAfterSuccess,
    nextAdvanced,
    leftRailNavigationWorked,
    readOnly: previewState.readOnly,
    reviewGroupCount: firstReviewPreMergePayloads.length,
    previewTitle: previewState.title,
    previewMasterId: previewState.masterId,
    previewDuplicateCount: previewState.duplicateListCount || previewState.duplicateCount,
    reviewOnlyRowCount: previewState.reviewOnlyRows.length,
    payloadsAligned,
    dialogMessages
  };
}

function buildMergeReportRows(payload, masterRecord, duplicateRecord) {
  return [
    ["ROLE", "Salesforce ID", "Name", "First Name", "Last Name", "Email", "Lead Source", "Phone", "Mobile Phone", "Account ID", "Account Name", "Created Date", "Last Modified Date", "System Modstamp", "Is Deleted", "STATUS", "DETAILS"],
    mergeReportRowFromPayloadRecord({
      role: "Master record",
      record: masterRecord,
      fallbackId: payload.masterId,
      status: "Retained as master",
      details: "Kept as the Salesforce merge master"
    }),
    mergeReportRowFromPayloadRecord({
      role: "Duplicate record",
      record: duplicateRecord,
      fallbackId: (payload.mergeIds || [])[0],
      status: "Merged into master",
      details: "Deleted by Salesforce merge and retained related detail"
    })
  ];
}

function mergeReportRowFromPayloadRecord({ role, record, fallbackId, status, details }) {
  const fields = record?.fields || {};
  const firstName = String(fields.firstName || "");
  const lastName = String(fields.lastName || "");
  const fullName = String(record?.name || fields.fullName || [firstName, lastName].filter(Boolean).join(" ") || fallbackId || "");
  return [
    role,
    String(record?.id || fallbackId || ""),
    fullName,
    firstName,
    lastName,
    String(fields.email || ""),
    String(fields.leadSource || ""),
    String(fields.phone || ""),
    String(fields.mobile || ""),
    String(fields.accountId || ""),
    String(fields.company || ""),
    String(fields.createdDate || ""),
    String(fields.lastModifiedDate || ""),
    String(fields.systemModstamp || ""),
    String(fields.isDeleted ?? ""),
    status,
    details
  ];
}

function findMergePayloadRecord(payload, id) {
  const normalizedId = String(id || "");
  return (payload.records || []).find((record) => String(record?.id || "") === normalizedId) || null;
}

function toSalesforceCurrentRecord(record) {
  const fields = record?.fields || {};
  return {
    Id: String(record?.id || ""),
    IsDeleted: false,
    CreatedDate: String(fields.createdDate || ""),
    LastModifiedDate: String(fields.lastModifiedDate || ""),
    SystemModstamp: String(fields.systemModstamp || ""),
    Name: String(record?.name || fields.fullName || ""),
    FirstName: String(fields.firstName || ""),
    LastName: String(fields.lastName || ""),
    Email: String(fields.email || ""),
    LeadSource: String(fields.leadSource || ""),
    Phone: String(fields.phone || ""),
    MobilePhone: String(fields.mobile || ""),
    AccountId: String(fields.accountId || ""),
    Account: { Name: String(fields.company || "") },
    AccountName: String(fields.company || "")
  };
}

async function captureMergeReportDownload(page) {
  const button = page.locator(".merge-report-download-button");
  const state = {
    buttonVisible: await button.isVisible(),
    downloaded: false,
    csv: ""
  };

  if (!state.buttonVisible) return state;

  const downloadPath = path.join(outDir, "merge-report-download.csv");
  const downloadPromise = page.waitForEvent("download");
  await button.click();
  const download = await downloadPromise;
  await download.saveAs(downloadPath);
  state.downloaded = true;
  state.csv = await fs.readFile(downloadPath, "utf8");
  return state;
}

async function captureWorkspaceExport(page, exportPath) {
  await page.locator("#exportMenuButton").click();
  await page.getByRole("menuitem", { name: "Workspace" }).waitFor({ state: "visible", timeout: 5000 });
  const button = page.locator("#workspaceExportButton");
  const state = {
    buttonVisible: await button.isVisible(),
    downloaded: false,
    json: null
  };

  if (!state.buttonVisible) return state;

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Workspace" }).click();
  const download = await downloadPromise;
  await download.saveAs(exportPath);
  state.downloaded = true;
  state.json = JSON.parse(await fs.readFile(exportPath, "utf8"));
  return state.json;
}

async function captureDatasetExport(page, exportPath) {
  const menu = page.locator("#exportMenu");
  if (await menu.isHidden()) {
    await page.locator("#exportMenuButton").click();
  }
  const button = page.locator("#datasetExportButton");
  await button.waitFor({ state: "visible", timeout: 5000 });
  const state = {
    buttonVisible: await button.isVisible(),
    downloaded: false,
    csv: "",
    headerRow: [],
    csvRowCount: 0
  };

  if (!state.buttonVisible) return state;

  const downloadPromise = page.waitForEvent("download");
  await button.click();
  const download = await downloadPromise;
  await download.saveAs(exportPath);
  state.downloaded = true;
  state.csv = await fs.readFile(exportPath, "utf8");
  const rows = state.csv.trim().split(/\r?\n/);
  state.csvRowCount = rows.length;
  state.headerRow = rows[0]?.split(",") || [];
  return state;
}

async function setSalesforceOrgSelection(page, org = {}) {
  const alias = org.alias || org.orgAlias || "";
  const instanceUrl = org.instanceUrl || org.url || org.orgInstanceUrl || "";
  const value = orgProfileKey({ alias, instanceUrl });
  await page.evaluate(({ targetAlias }) => {
    const select = document.querySelector("#orgRecentSelect");
    const option = [...(select?.options || [])].find((entry) => (entry.textContent || "").trim() === targetAlias);
    if (!select || !option) {
      throw new Error(`Recent org option not found for ${targetAlias}`);
    }
    select.value = option.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, { targetAlias: alias });
  await page.waitForFunction(
    () => !document.querySelector("#orgApplyButton")?.disabled,
    null,
    { timeout: 5000 }
  );
  await page.locator("#orgApplyButton").click();
  await page.waitForFunction(
    ([expectedAlias, expectedInstanceUrl, expectedValue]) => {
      const label = document.querySelector("#orgSelectionLabel")?.textContent || "";
      const recentValue = document.querySelector("#orgRecentSelect")?.value || "";
      const instanceValue = document.querySelector("#orgInstanceUrlValue")?.textContent || "";
      const status = document.querySelector("#orgStatus")?.textContent || "";
      return label.includes(expectedAlias) &&
        recentValue === expectedValue &&
        instanceValue === expectedInstanceUrl &&
        status.includes(expectedAlias);
    },
    [alias, instanceUrl, value],
    { timeout: 5000 }
  );
}

async function orgSelectorState(page) {
  return page.evaluate(() => {
    const recentSelect = document.querySelector("#orgRecentSelect");
    const recentOptions = [...(recentSelect?.options || [])].map((option) => ({
      value: option.value,
      label: option.textContent || "",
      title: option.title || ""
    }));
    return {
      label: document.querySelector("#orgSelectionLabel")?.textContent?.trim() || "",
      pill: document.querySelector("#orgSelectionPill")?.textContent?.trim() || "",
      recentValue: recentSelect?.value || "",
      alias: document.querySelector("#orgSelectionLabel")?.textContent?.trim() || "",
      instanceUrl: document.querySelector("#orgInstanceUrlValue")?.textContent?.trim() || "",
      instanceUrlTagName: document.querySelector("#orgInstanceUrlValue")?.tagName || "",
      instanceUrlReadonly: document.querySelector("#orgInstanceUrlValue")?.tagName === "DIV",
      aliasInputPresent: Boolean(document.querySelector("#orgAliasInput")),
      instanceUrlInputPresent: Boolean(document.querySelector("#orgInstanceUrlInput")),
      status: document.querySelector("#orgStatus")?.textContent?.trim() || "",
      applyDisabled: Boolean(document.querySelector("#orgApplyButton")?.disabled),
      warningVisible: !document.querySelector("#orgMismatchWarning")?.hidden,
      warningText: document.querySelector("#orgMismatchWarning")?.textContent?.trim() || "",
      aliasOptions: recentOptions.slice(1).map((option) => ({
        value: option.value,
        alias: option.label,
        label: option.label,
        title: option.title
      }))
    };
  });
}

function orgProfileKey({ alias, instanceUrl }) {
  return `${normalizeText(alias)}|${normalizeText(normalizeInstanceUrl(instanceUrl))}`;
}

function normalizeInstanceUrl(value = "") {
  try {
    const url = new URL(String(value || "").trim());
    if (url.hostname.endsWith(".lightning.force.com")) {
      url.hostname = url.hostname.replace(".lightning.force.com", ".my.salesforce.com");
    }
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

async function importWorkspaceThroughMenu(page, filePath) {
  await page.locator("#chooseCsvButton").click();
  await page.getByRole("menuitem", { name: "Workspace" }).waitFor({ state: "visible", timeout: 5000 });
  const startedAt = Date.now();
  const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 5000 });
  await page.getByRole("menuitem", { name: "Workspace" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(filePath);
  await waitForLoadingModalHidden(page, "Topbar Import Workspace load");
  await waitForFirstGroup(page, "Topbar Import Workspace load");
  return {
    fileChooserOpened: true,
    elapsedMs: Date.now() - startedAt,
    ...(await datasetLoadState(page))
  };
}

async function assertWorkspaceExportRoundTrip(browser, exportPath, datasetPath) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  try {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await importContactsThroughMenu(page, datasetPath);
    await page.locator("#loadingModal").waitFor({ state: "hidden", timeout: 10000 });
    await waitForFirstGroup(page, "Workspace round-trip dataset reload");
    const importState = await importWorkspaceThroughMenu(page, exportPath);
    await page.locator("#loadingModal").waitFor({ state: "hidden", timeout: 10000 });
    await waitForFirstGroup(page, "Workspace round-trip import");
    const state = await page.evaluate(() => ({
      decisionCount: [...state.decisions.values()].filter((decision) => decision === "duplicate").length,
      trainingLabelCount: state.trainingLabels.size,
      reviewStateStatus: state.reviewStateStatus
    }));
    return {
      ...state,
      importState
    };
  } finally {
    await context.close();
  }
}

async function captureStaleRefreshFlow(page) {
  const refreshEndpoint = "/api/smoke/stale-refresh/latest.json";
  const state = {
    preMergeCalled: false,
    refreshCalled: false,
    mergeCalled: false,
    dialogMessage: "",
    datasetContractVersion: "",
    datasetRollbackInventoryCount: 0,
    sourceFormat: ""
  };
  await page.route("**/api/salesforce/premerge-check", async (route) => {
    const payload = JSON.parse(route.request().postData() || "{}");
    state.preMergeCalled = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        status: "stale",
        checkedAt: new Date().toISOString(),
        objectType: "Contact",
        groupKey: payload.groupKey,
        masterId: payload.masterId,
        mergeIds: payload.mergeIds || [],
        ids: [payload.masterId, ...(payload.mergeIds || [])].filter(Boolean),
        missingIds: [],
        deletedIds: [],
        changedFields: [
          {
            id: payload.masterId,
            recordName: "Ada Lovelace",
            field: "email",
            label: "Email",
            loadedValue: "ada@example.com",
            currentValue: "ada.updated@example.com"
          }
        ],
        currentRecords: [],
        loadedRecords: payload.records || []
      })
    });
  });
  await page.route("**/api/salesforce/merge", async (route) => {
    state.mergeCalled = true;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Merge should not run with stale data" } })
    });
  });
  await page.route(`**${refreshEndpoint}`, async (route) => {
    state.refreshCalled = true;
    state.datasetRollbackInventoryCount = buildRollbackRefreshDataset().rollbackInventory.length;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildRollbackRefreshDataset())
    });
  });

  await page.evaluate((endpoint) => {
    state.datasetSource = {
      endpoint,
      fileName: "salesforce-report-latest.json",
      displayName: "Latest Contacts",
      objectType: "contact",
      format: "json",
      contractVersion: "salesforce-contact-rollback-v1"
    };
  }, refreshEndpoint);

  const refreshResponsePromise = page.waitForResponse((response) => response.url().endsWith(refreshEndpoint));
  page.once("dialog", async (dialog) => {
    state.dialogMessage = dialog.message();
    await dialog.accept();
  });
  try {
    await page.locator(".merge-submit-button").click();
  } catch (error) {
    const debugState = await duplicateReviewerDebugState(page);
    const detailHtml = await page.evaluate(() => document.querySelector(".detail-surface")?.innerHTML || "");
    throw new Error(`Stale failure-card merge submit was not reachable: ${JSON.stringify({ debugState, detailHtml, state })}`);
  }
  await refreshResponsePromise;
  await page.evaluate(() => {
    if (typeof endFileLoad === "function") endFileLoad();
    if (typeof renderSource === "function") renderSource();
    if (typeof renderDetail === "function") renderDetail();
  });
  await page.locator("#loadingModal").waitFor({ state: "hidden", timeout: 10000 });
  await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: GROUP_ITEM_VISIBLE_TIMEOUT_MS });
  state.datasetContractVersion = "salesforce-contact-rollback-v1";
  state.sourceFormat = "json";
  await page.unroute("**/api/salesforce/premerge-check");
  await page.unroute("**/api/salesforce/merge");
  await page.unroute(`**${refreshEndpoint}`);
  return {
    ...state,
    refreshEndpoint
  };
}

async function captureStaleFailureCardRefreshFlow(page) {
  const refreshEndpoint = "/api/smoke/stale-failure-card-refresh/latest.json";
  const state = {
    preMergeCalled: false,
    refreshCalled: false,
    mergeCalled: false,
    cardVisible: false,
    refreshButtonVisible: false,
    dismissedDialogMessage: "",
    buttonDialogMessage: "",
    datasetContractVersion: "",
    datasetRollbackInventoryCount: 0,
    sourceFormat: ""
  };

  await page.route("**/api/salesforce/premerge-check", async (route) => {
    const payload = JSON.parse(route.request().postData() || "{}");
    state.preMergeCalled = true;
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          message: "Pre-merge freshness check failed (1 changed field). Refresh Contacts before merging.",
          preMergeCheck: {
            ok: false,
            status: "stale",
            checkedAt: new Date().toISOString(),
            objectType: "Contact",
            groupKey: payload.groupKey,
            masterId: payload.masterId,
            mergeIds: payload.mergeIds || [],
            ids: [payload.masterId, ...(payload.mergeIds || [])].filter(Boolean),
            missingIds: [],
            deletedIds: [],
            changedFields: [
              {
                id: payload.masterId,
                recordName: "Ada Lovelace",
                field: "email",
                label: "Email",
                loadedValue: "ada@example.com",
                currentValue: "ada.updated@example.com"
              }
            ],
            currentRecords: [],
            loadedRecords: payload.records || []
          }
        }
      })
    });
  });
  await page.route("**/api/salesforce/merge", async (route) => {
    state.mergeCalled = true;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Merge should not run with stale data" } })
    });
  });
  await page.route(`**${refreshEndpoint}`, async (route) => {
    state.refreshCalled = true;
    state.datasetRollbackInventoryCount = buildRollbackRefreshDataset().rollbackInventory.length;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildRollbackRefreshDataset())
    });
  });

  await page.evaluate((endpoint) => {
    state.datasetSource = {
      endpoint,
      fileName: "salesforce-report-latest.json",
      displayName: "Latest Contacts",
      objectType: "contact",
      format: "json",
      contractVersion: "salesforce-contact-rollback-v1"
    };
    if (typeof resetMergeReviewSession === "function") {
      resetMergeReviewSession();
    }
    if (typeof endFileLoad === "function") endFileLoad();
    if (typeof renderSource === "function") renderSource();
    if (typeof renderDetail === "function") renderDetail();
  }, refreshEndpoint);
  await page.locator(".group-item-main").first().click();
  await page.getByLabel("Duplicate review workspace").getByRole("button", { name: "Duplicate", exact: true }).click();
  await page.locator('[data-review-mode="merge"]').click();
  await page.evaluate(() => {
    window.__smokeOriginalConfirm = window.__smokeOriginalConfirm || window.confirm;
    window.__smokeConfirmMessages = [];
    window.__smokeConfirmResponses = [false, true];
    window.confirm = (message) => {
      window.__smokeConfirmMessages.push(String(message || ""));
      return window.__smokeConfirmResponses.length ? Boolean(window.__smokeConfirmResponses.shift()) : true;
    };
  });

  try {
    await page.locator(".merge-submit-button").click();
  } catch (error) {
    const debugState = await duplicateReviewerDebugState(page);
    const detailHtml = await page.evaluate(() => document.querySelector(".detail-surface")?.innerHTML || "");
    throw new Error(`Stale failure-card merge submit was not reachable: ${JSON.stringify({ debugState, detailHtml, state })}`);
  }
  await page.locator(".merge-result.failed").waitFor({ state: "visible", timeout: 5000 });
  state.cardVisible = await page.locator(".merge-result.failed").isVisible();
  state.refreshButtonVisible = await page.locator(".merge-refresh-stale-data-button").isVisible();

  const refreshResponsePromise = page.waitForResponse((response) => response.url().endsWith(refreshEndpoint));
  await page.locator(".merge-refresh-stale-data-button").click();
  await refreshResponsePromise;
  await page.evaluate(() => {
    if (typeof endFileLoad === "function") endFileLoad();
    if (typeof renderSource === "function") renderSource();
    if (typeof renderDetail === "function") renderDetail();
  });
  await page.locator("#loadingModal").waitFor({ state: "hidden", timeout: 10000 });
  await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: GROUP_ITEM_VISIBLE_TIMEOUT_MS });
  const confirmMessages = await page.evaluate(() => {
    const messages = window.__smokeConfirmMessages || [];
    if (window.__smokeOriginalConfirm) window.confirm = window.__smokeOriginalConfirm;
    return messages;
  });
  state.dismissedDialogMessage = confirmMessages[0] || "";
  state.buttonDialogMessage = confirmMessages[1] || "";
  state.datasetContractVersion = "salesforce-contact-rollback-v1";
  state.sourceFormat = "json";

  await page.unroute("**/api/salesforce/premerge-check");
  await page.unroute("**/api/salesforce/merge");
  await page.unroute(`**${refreshEndpoint}`);
  return {
    ...state,
    refreshEndpoint
  };
}

function buildRollbackRefreshDataset() {
  const records = rollbackRefreshRecords();
  const columns = ["Id", "First Name", "Last Name", "Company", "Email", "Lead Source", "Created Date", "Phone", "Mobile"];
  return {
    schema: "salesforce-duplicate-reviewer.dataset",
    schemaVersion: 2,
    contractVersion: "salesforce-contact-rollback-v1",
    objectType: "contact",
    fileName: "salesforce-report-latest.json",
    source: {
      system: "salesforce",
      name: "Latest Contacts",
      format: "salesforce-rest-soql-json",
      contractVersion: "salesforce-contact-rollback-v1"
    },
    fields: columns.map((column) => ({ apiName: column, label: column, type: "text" })),
    columns,
    rows: records.map((record) => columns.map((column) => record[column] || "")),
    records,
    rollbackInventory: [
      {
        recordId: records[0].Id,
        recordName: `${records[0]["First Name"]} ${records[0]["Last Name"]}`,
        relationships: [
          {
            path: "Tasks",
            kind: "array",
            records: [
              {
                Id: "00T000000000AAA",
                Subject: "Intro call",
                OwnerId: "005000000000AAA"
              }
            ]
          },
          {
            path: "Opportunities",
            kind: "array",
            records: [
              {
                Id: "006000000000AAA",
                Name: "Test Opportunity",
                AccountId: "001000000000AAA"
              }
            ]
          }
        ]
      }
    ],
    rowCount: records.length,
    generatedAt: new Date().toISOString()
  };
}

function rollbackRefreshRecords() {
  return [
    {
      Id: "003T00000000001",
      "First Name": "Ada",
      "Last Name": "Lovelace",
      Company: "Analytical Engines",
      Email: "ada@example.com",
      "Lead Source": "Web",
      "Created Date": "2024-01-01T09:00:00.000Z",
      Phone: "(555) 010-0001",
      Mobile: "",
      Tasks: [
        {
          Id: "00T000000000AAA",
          Subject: "Intro call",
          OwnerId: "005000000000AAA"
        }
      ],
      Opportunities: [
        {
          Id: "006000000000AAA",
          Name: "Test Opportunity",
          AccountId: "001000000000AAA"
        }
      ]
    },
    {
      Id: "003T00000000002",
      "First Name": "Ada",
      "Last Name": "Lovelace",
      Company: "Analytical Engines Inc.",
      Email: "ada.updated@example.com",
      "Lead Source": "Referral",
      "Created Date": "2025-01-01T09:00:00.000Z",
      Phone: "",
      Mobile: "(555) 020-0001"
    }
  ];
}

async function captureMissingContactIdRefreshFlow(page, missingIdCsvPath, refreshedCsv) {
  const refreshEndpoint = "/api/smoke/missing-contact-ids/latest.csv";
  const state = {
    noticeVisible: false,
    refreshButtonVisible: false,
    refreshCalled: false,
    preMergeCalled: false,
    mergeCalled: false,
    dialogMessage: "",
    refreshedHasIds: false
  };

  await importContactsThroughMenu(page, missingIdCsvPath);
  await page.evaluate((endpoint) => {
    state.datasetSource = {
      endpoint,
      fileName: "contacts-missing-ids.csv",
      displayName: "Latest Contacts",
      objectType: "contact",
      format: "csv"
    };
  }, refreshEndpoint);
  await waitForFirstGroup(page, "Missing Contact ID dataset load");
  await page.locator(".group-item-main").first().click();
  await page.getByLabel("Duplicate review workspace").getByRole("button", { name: "Duplicate", exact: true }).click();
  await page.locator('[data-review-mode="merge"]').click();
  await page.locator(".merge-repair-notice").waitFor({ state: "visible", timeout: 5000 });
  state.noticeVisible = await page.locator(".merge-repair-notice").isVisible();
  state.refreshButtonVisible = await page.locator(".merge-refresh-contact-ids-button").isVisible();

  await page.route("**/api/salesforce/premerge-check", async (route) => {
    state.preMergeCalled = true;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Pre-merge should not run without Contact IDs" } })
    });
  });
  await page.route("**/api/salesforce/merge", async (route) => {
    state.mergeCalled = true;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Merge should not run without Contact IDs" } })
    });
  });
  await page.route(`**${refreshEndpoint}`, async (route) => {
    state.refreshCalled = true;
    await route.fulfill({
      status: 200,
      contentType: "text/csv",
      body: refreshedCsv
    });
  });

  const refreshResponsePromise = page.waitForResponse((response) => response.url().endsWith(refreshEndpoint));
  page.once("dialog", async (dialog) => {
    state.dialogMessage = dialog.message();
    await dialog.accept();
  });
  await page.locator(".merge-refresh-contact-ids-button").click();
  await refreshResponsePromise;
  await page.locator("#loadingModal").waitFor({ state: "hidden", timeout: 10000 });
  await waitForFirstGroup(page, "Missing Contact ID refresh");
  state.refreshedHasIds = await page.evaluate(() => {
    return state.objectType === "contact" && state.rows.length > 0 && state.rows.every((record) => /^003/.test(salesforceId(record)));
  });

  await page.unroute("**/api/salesforce/premerge-check");
  await page.unroute("**/api/salesforce/merge");
  await page.unroute(`**${refreshEndpoint}`);
  return state;
}

async function captureMissingContactIdFallbackRefreshFlow(page, missingIdCsvPath, refreshedCsv) {
  const refreshEndpoint = "/api/staging-contacts/latest.json";
  const state = {
    noticeVisible: false,
    refreshButtonVisible: false,
    refreshButtonText: "",
    refreshCalled: false,
    preMergeCalled: false,
    mergeCalled: false,
    dialogMessage: "",
    refreshedHasIds: false
  };

  await importContactsThroughMenu(page, missingIdCsvPath);
  await page.evaluate(() => {
    state.datasetSource = {
      endpoint: "",
      fileName: "contacts-missing-ids.csv",
      displayName: "contacts-missing-ids.csv",
      objectType: "contact",
      format: "csv"
    };
    state.recentFiles = state.recentFiles.filter((record) => {
      const text = `${record.endpoint || ""} ${record.displayName || ""} ${record.name || ""}`.toLowerCase();
      return !text.includes("staging-contacts") && !text.includes("latest contacts");
    });
  });
  await waitForFirstGroup(page, "Missing Contact ID fallback dataset load");
  await page.locator(".group-item-main").first().click();
  await page.getByLabel("Duplicate review workspace").getByRole("button", { name: "Duplicate", exact: true }).click();
  await page.locator('[data-review-mode="merge"]').click();
  await page.locator(".merge-repair-notice").waitFor({ state: "visible", timeout: 5000 });
  state.noticeVisible = await page.locator(".merge-repair-notice").isVisible();
  state.refreshButtonVisible = await page.locator(".merge-refresh-contact-ids-button").isVisible();
  state.refreshButtonText = (await page.locator(".merge-refresh-contact-ids-button").textContent())?.trim() || "";

  await page.route("**/api/salesforce/premerge-check", async (route) => {
    state.preMergeCalled = true;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Pre-merge should not run without Contact IDs" } })
    });
  });
  await page.route("**/api/salesforce/merge", async (route) => {
    state.mergeCalled = true;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Merge should not run without Contact IDs" } })
    });
  });
  await page.route(`**${refreshEndpoint}`, async (route) => {
    state.refreshCalled = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(buildRollbackRefreshDataset())
    });
  });

  const refreshResponsePromise = page.waitForResponse((response) => response.url().endsWith(refreshEndpoint));
  page.once("dialog", async (dialog) => {
    state.dialogMessage = dialog.message();
    await dialog.accept();
  });
  await page.locator(".merge-refresh-contact-ids-button").click();
  await refreshResponsePromise;
  await page.locator("#loadingModal").waitFor({ state: "hidden", timeout: 10000 });
  await waitForFirstGroup(page, "Missing Contact ID fallback refresh");
  state.refreshedHasIds = await page.evaluate(() => {
    return state.objectType === "contact" && state.rows.length > 0 && state.rows.every((record) => /^003/.test(salesforceId(record)));
  });

  await page.unroute("**/api/salesforce/premerge-check");
  await page.unroute("**/api/salesforce/merge");
  await page.unroute(`**${refreshEndpoint}`);
  return state;
}

async function setRangeValue(page, selector, value) {
  await page.locator(selector).evaluate((input, nextValue) => {
    input.value = nextValue;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

async function themeColorState(page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const topbar = getComputedStyle(document.querySelector(".topbar"));
    return {
      colorScheme: root.colorScheme,
      bodyBg: body.backgroundColor,
      bodyColor: body.color,
      topbarBg: topbar.backgroundColor,
      accent: root.getPropertyValue("--managed-accent").trim(),
      secondaryAccent: root.getPropertyValue("--managed-secondary-accent").trim()
    };
  });
}

async function brandLogoState(page) {
  return page.locator(".brand-logo").evaluate((logo) => {
    const frame = logo.closest(".brand-logo-frame");
    const copy = document.querySelector(".brand-copy");
    const title = document.querySelector(".brand h1");
    const subtitle = document.querySelector(".brand-copy p");
    const topbar = document.querySelector(".topbar");
    const actions = document.querySelector(".topbar-actions");
    const support = document.querySelector(".topbar-support");
    const supportLink = document.querySelector(".topbar-support a");
    const rectFor = (element) => {
      const rect = element?.getBoundingClientRect();
      return rect
        ? { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height }
        : { top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 };
    };
    const frameRect = rectFor(frame);
    const copyRect = rectFor(copy);
    const topbarRect = rectFor(topbar);
    const actionsRect = rectFor(actions);
    const supportRect = rectFor(support);
    const frameCenter = frameRect.top + frameRect.height / 2;
    const copyCenter = copyRect.top + copyRect.height / 2;
    const topbarCenter = topbarRect.left + topbarRect.width / 2;
    const actionsCenter = actionsRect.left + actionsRect.width / 2;
    const actionButtons = [...actions.querySelectorAll(".button, .icon-button")]
      .filter((button) => button.getClientRects().length > 0);
    const titleStyle = title ? getComputedStyle(title) : null;
    const subtitleStyle = subtitle ? getComputedStyle(subtitle) : null;
    const rowCounts = [...actionButtons.reduce((rows, button) => {
      const top = Math.round(button.getBoundingClientRect().top);
      rows.set(top, (rows.get(top) || 0) + 1);
      return rows;
    }, new Map()).values()];
    const buttonRects = actionButtons.map((button) => {
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return {
        height: Math.round(rect.height),
        fontSize: Number.parseFloat(style.fontSize),
        width: Math.round(rect.width)
      };
    });
    return {
      visible: frameRect.width > 0 && frameRect.height > 0 && logo.naturalWidth > 0,
      alt: logo.getAttribute("alt") || "",
      src: logo.currentSrc || logo.getAttribute("src") || "",
      naturalWidth: logo.naturalWidth,
      naturalHeight: logo.naturalHeight,
      frameWidth: Math.round(frameRect.width),
      frameHeight: Math.round(frameRect.height),
      copyGap: Math.round(copyRect.left - frameRect.right),
      copyCenterDelta: Math.round(Math.abs(frameCenter - copyCenter)),
      titleText: title?.textContent?.trim() || "",
      titleFontFamily: titleStyle?.fontFamily || "",
      titleFontSize: titleStyle?.fontSize || "",
      titleLetterSpacing: titleStyle?.letterSpacing || "",
      subtitleText: subtitle?.textContent?.trim() || "",
      subtitleFontFamily: subtitleStyle?.fontFamily || "",
      subtitleFontSize: subtitleStyle?.fontSize || "",
      subtitleFontWeight: subtitleStyle?.fontWeight || "",
      subtitleLetterSpacing: subtitleStyle?.letterSpacing || "",
      supportContact: support?.textContent?.replace(/\s+/g, " ").trim() || "",
      supportHref: supportLink?.getAttribute("href") || "",
      supportRightAligned: Math.abs(Math.round(topbarRect.right - supportRect.right) - 24) <= 2,
      actionsCenterDelta: Math.abs(Math.round(actionsCenter - topbarCenter)),
      actionsCentered: actionsRect.width > 0 && Math.abs(Math.round(actionsCenter - topbarCenter)) <= 16,
      actionTexts: actionButtons.map((button) => button.textContent?.replace(/\s+/g, " ").trim() || button.getAttribute("aria-label") || ""),
      actionRowCounts: rowCounts,
      actionButtonCount: actionButtons.length,
      actionButtonRects: buttonRects,
      actionRowsBalanced: rowCounts.length === 2 && rowCounts[0] === 3 && rowCounts[1] === 2,
      actionsComfortable: buttonRects.every((rect) => rect.height <= 40 && rect.fontSize <= 12)
    };
  });
}

async function exportMenuStateForSmoke(page) {
  return page.locator("#exportMenu").evaluate((menu) => ({
    hidden: menu.hidden,
    options: [...menu.querySelectorAll('[role="menuitem"]')].map((button) => button.textContent?.trim() || ""),
    disabled: [...menu.querySelectorAll('[role="menuitem"]')].map((button) => button.disabled)
  }));
}

function zeroLetterSpacing(value) {
  return value === "normal" || value === "0px";
}

async function paneSurfaceState(page) {
  return page.evaluate(() => {
    const entries = {
      body: document.body,
      app: document.querySelector(".app"),
      mainGrid: document.querySelector(".main-grid"),
      controlPane: document.querySelector(".control-pane"),
      workspaceColumn: document.querySelector(".workspace-column"),
      reviewPane: document.querySelector(".review-pane")
    };
    const colors = Object.fromEntries(Object.entries(entries).map(([name, element]) => {
      return [name, element ? getComputedStyle(element).backgroundColor : "missing"];
    }));
    const uniqueColors = [...new Set(Object.values(colors))];
    return {
      colors,
      uniqueColors,
      standardized: uniqueColors.length === 1
    };
  });
}

async function exerciseCustomFilters(page) {
  await addFilter(page, 1);
  const singleFilterIndexCount = await page.locator(".filter-row .filter-index").count();
  const fieldOptions = await page.locator(".filter-row").first().locator(".filter-field-select option").evaluateAll((options) => {
    return options.map((option) => option.textContent?.trim() || "");
  });
  await configureFilter(page, 0, "email", "contains", "contact1@example.com");
  const singleFilterLayout = await filterRowLayoutState(page, 0);
  await addFilter(page, 2);
  const multipleFilterIndexCount = await page.locator(".filter-row .filter-index").count();
  await configureFilter(page, 1, "email", "contains", "contact2@example.com");
  const defaultLogicMode = await page.locator(".filter-logic-mode-select").inputValue();
  const logicOptions = await page.locator(".filter-logic-mode-select option").evaluateAll((options) => {
    return options.map((option) => ({ value: option.value, label: option.textContent?.trim() || "" }));
  });
  await page.locator(".filter-logic-mode-select").selectOption("custom");
  await page.locator(".filter-logic-input").fill("1 OR 2");

  await addFilter(page, 3);
  const dateFilter = page.locator(".filter-row").nth(2);
  await dateFilter.locator(".filter-field-select").selectOption("createdDate");
  const dateOperators = await dateFilter.locator(".filter-operator-select option").evaluateAll((options) => {
    return options.map((option) => option.textContent?.trim() || "");
  });
  await page.locator("[data-filter-remove]").nth(2).click();
  await page.locator(".filter-logic-mode-select").selectOption("custom");
  await page.locator(".filter-logic-input").fill("1 OR 2");

  await page.locator("#applyControlsButton").click();
  await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: GROUP_ITEM_VISIBLE_TIMEOUT_MS });
  const filteredCount = await page.locator("#groupCount").evaluate((node) => Number(node.textContent?.replace(/,/g, "") || 0));
  const logicMode = await page.locator(".filter-logic-mode-select").inputValue();
  const logicValue = await page.locator(".filter-logic-input").inputValue();

  while (await page.locator("[data-filter-remove]").count()) {
    await page.locator("[data-filter-remove]").first().click();
  }
  await page.locator("#applyControlsButton").click();
  await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: GROUP_ITEM_VISIBLE_TIMEOUT_MS });

  return {
    filteredCount,
    defaultLogicMode,
    logicMode,
    logicValue,
    logicOptions,
    singleFilterIndexCount,
    multipleFilterIndexCount,
    singleFilterLayout,
    fieldOptions,
    dateOperators
  };
}

async function exerciseLabelStatusFilter(page) {
  const fullCheckbox = page.locator('[data-label-status-filter][value="full"]');
  const startingCount = await page.locator("#groupCount").evaluate((node) => Number(node.textContent?.replace(/,/g, "") || 0));
  await fullCheckbox.check();
  const countBeforeApply = await page.locator("#groupCount").evaluate((node) => Number(node.textContent?.replace(/,/g, "") || 0));
  const applyButton = page.locator("[data-label-status-apply]");
  const applyEnabledAfterChange = await applyButton.isEnabled();
  await applyButton.click();
  await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: GROUP_ITEM_VISIBLE_TIMEOUT_MS });
  const filteredCount = await page.locator("#groupCount").evaluate((node) => Number(node.textContent?.replace(/,/g, "") || 0));
  const visibleFullCount = await page.locator(".group-item.is-label-full").count();
  const applyDisabledAfterApply = await applyButton.isDisabled();
  await fullCheckbox.uncheck();
  await applyButton.click();
  await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: GROUP_ITEM_VISIBLE_TIMEOUT_MS });
  return { startingCount, countBeforeApply, applyEnabledAfterChange, filteredCount, visibleFullCount, applyDisabledAfterApply };
}

async function addFilter(page, expectedCount) {
  const currentCount = await page.locator(".filter-row").count();
  if (currentCount < expectedCount) {
    await page.locator(".filter-builder-title [data-filter-add]").first().click();
  }
  await page.locator(".filter-row").nth(expectedCount - 1).waitFor({ state: "visible", timeout: 5000 });
}

async function filterRowLayoutState(page, index) {
  return page.locator(".filter-row").nth(index).evaluate((row) => {
    const panel = row.closest(".match-controls-panel");
    const rowRect = row.getBoundingClientRect();
    const panelRect = panel?.getBoundingClientRect();
    const controls = [
      row.querySelector(".filter-field-select"),
      row.querySelector(".filter-operator-select"),
      row.querySelector(".filter-value-control")
    ].filter(Boolean);
    const tops = controls.map((control) => Math.round(control.getBoundingClientRect().top));
    const uniqueTops = [...new Set(tops)];
    return {
      controlCount: controls.length,
      tops,
      sameLine: tops.length >= 3 && Math.max(...tops) - Math.min(...tops) <= 2,
      stacked: tops.length >= 3 && uniqueTops.length >= 3,
      withinPanel: Boolean(panelRect && rowRect.left >= panelRect.left - 1 && rowRect.right <= panelRect.right + 1),
      horizontalOverflow: Boolean(panelRect && rowRect.right > panelRect.right + 1),
      rowRight: Math.round(rowRect.right),
      panelRight: Math.round(panelRect?.right || 0)
    };
  });
}

async function configureFilter(page, index, field, operator, value) {
  const row = page.locator(".filter-row").nth(index);
  await row.locator(".filter-field-select").selectOption(field);
  await row.locator(".filter-operator-select").selectOption(operator);
  await row.locator(".filter-value-control").first().fill(value);
}

async function setNumberValue(page, selector, value) {
  await page.locator(selector).evaluate((input, nextValue) => {
    input.value = nextValue;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function thresholdControlState(page) {
  return page.evaluate(() => {
    const slider = document.querySelector("#thresholdSlider");
    return {
      minRange: document.querySelector("#threshold")?.value || "",
      maxRange: document.querySelector("#maxThreshold")?.value || "",
      minNumber: document.querySelector("#thresholdMinNumber")?.value || "",
      maxNumber: document.querySelector("#thresholdMaxNumber")?.value || "",
      minFill: slider?.style.getPropertyValue("--threshold-min-pct") || "",
      maxFill: slider?.style.getPropertyValue("--threshold-max-pct") || ""
    };
  });
}

async function visibleGroupScores(page) {
  return page.locator(".group-item .group-item-top .match-pill").evaluateAll((nodes) => {
    return nodes
      .map((node) => Number(node.textContent?.trim()))
      .filter((score) => Number.isFinite(score));
  });
}

async function groupListTopState(page) {
  return page.evaluate(() => {
    const list = document.querySelector("#groupList");
    const firstGroup = document.querySelector(".group-item");
    const scores = [...document.querySelectorAll(".group-item .group-item-top .match-pill")]
      .map((node) => Number(node.textContent?.trim()))
      .filter((score) => Number.isFinite(score));
    return {
      scrollTop: list?.scrollTop || 0,
      firstSelected: firstGroup?.classList.contains("is-selected") || false,
      firstScore: scores[0] || 0,
      scoresAscending: scores.every((score, index) => index === 0 || scores[index - 1] <= score)
    };
  });
}

async function exerciseGroupListScrollAfterSelection(page) {
  const list = page.locator("#groupList");
  await list.scrollIntoViewIfNeeded();
  await list.hover();
  const before = await list.evaluate((element) => ({
    scrollTop: element.scrollTop,
    maxScrollTop: Math.max(0, element.scrollHeight - element.clientHeight),
    selectedVisible: !!element.querySelector(".group-item.is-selected")
  }));
  await page.locator(".group-item").first().click();
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(150);
  const after = await list.evaluate((element) => {
    const selected = element.querySelector(".group-item.is-selected");
    const listRect = element.getBoundingClientRect();
    const selectedRect = selected?.getBoundingClientRect();
    const selectedVisible = !!selectedRect && selectedRect.bottom > listRect.top && selectedRect.top < listRect.bottom;
    return {
      afterScrollTop: element.scrollTop,
      maxScrollTop: Math.max(0, element.scrollHeight - element.clientHeight),
      selectedVisible,
      selectedTop: selectedRect ? selectedRect.top - listRect.top : null,
      selectedBottom: selectedRect ? selectedRect.bottom - listRect.top : null
    };
  });
  return { before, after };
}

async function assertRootScrollPolicy(page) {
  return page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    const bodyStyle = getComputedStyle(document.body);
    const htmlStyle = getComputedStyle(document.documentElement);
    const rootHasOverflow = root.scrollHeight > root.clientHeight + 1;
    const blockedValues = new Set(["hidden", "clip"]);
    return {
      ok: !blockedValues.has(bodyStyle.overflowY) && !blockedValues.has(htmlStyle.overflowY),
      rootHasOverflow,
      bodyOverflowY: bodyStyle.overflowY,
      htmlOverflowY: htmlStyle.overflowY,
      scrollHeight: root.scrollHeight,
      clientHeight: root.clientHeight
    };
  });
}

async function assertNoPrimaryScrollTraps(page) {
  return page.evaluate(() => {
    const blockedOverflow = new Set(["hidden", "clip"]);
    const selectors = [
      ["html", document.documentElement],
      ["body", document.body],
      [".app", document.querySelector(".app")],
      [".main-grid", document.querySelector(".main-grid")],
      [".workspace-column", document.querySelector(".workspace-column")],
      [".control-pane", document.querySelector(".control-pane")],
      [".review-pane", document.querySelector(".review-pane")]
    ];
    const broken = [];

    const visibleTextBelowViewport = (element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = [...range.getClientRects()];
        range.detach();
        const clippedRect = rects.find((rect) => rect.width > 0 && rect.height > 0 && rect.bottom > window.innerHeight + 1);
        if (clippedRect) {
          return {
            text: node.textContent.trim().replace(/\s+/g, " ").slice(0, 80),
            bottom: Math.round(clippedRect.bottom)
          };
        }
      }
      return null;
    };

    for (const [selector, element] of selectors) {
      if (!element) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const hasVerticalOverflow = element.scrollHeight > element.clientHeight + 1;
      const belowViewportText = visibleTextBelowViewport(element);
      if (!blockedOverflow.has(style.overflowY) || (!hasVerticalOverflow && !belowViewportText)) continue;
      broken.push({
        selector,
        overflowY: style.overflowY,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        rectBottom: Math.round(rect.bottom),
        belowViewportText
      });
    }

    return {
      ok: broken.length === 0,
      broken
    };
  });
}

async function assertVerticalScrollAvailable(page, selector, label) {
  return page.locator(selector).first().evaluate((element, name) => {
    const style = getComputedStyle(element);
    const hasOverflow = element.scrollHeight > element.clientHeight + 1;
    if (!hasOverflow) {
      return {
        label: name,
        hasOverflow,
        scrolled: true,
        overflowY: style.overflowY,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight
      };
    }

    const before = element.scrollTop;
    element.scrollTop = Math.min(element.scrollHeight - element.clientHeight, before + 180);
    const after = element.scrollTop;
    element.scrollTop = before;
    return {
      label: name,
      hasOverflow,
      scrolled: after > before,
      overflowY: style.overflowY,
      before,
      after,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight
    };
  }, label);
}

async function assertLeftPaneSmallListLayout(page) {
  return page.evaluate(() => {
    const numberFromText = (value) => Number(String(value || "").replace(/,/g, "")) || 0;
    const weightNumber = (value) => {
      if (value === "normal") return 400;
      if (value === "bold") return 700;
      return Number(value) || 400;
    };
    const groupCount = numberFromText(document.querySelector("#groupCount")?.textContent);
    const groupList = document.querySelector("#groupList");
    const groupPanel = document.querySelector(".group-panel");
    const groupItem = document.querySelector(".group-item");
    const labelFilter = document.querySelector(".label-status-filter");
    const labelOptions = [...document.querySelectorAll(".label-status-option span")];
    const labelFooter = document.querySelector(".label-status-filter-footer");
    const recentNames = [...document.querySelectorAll(".recent-file-name")];
    const groupListStyle = groupList ? getComputedStyle(groupList) : null;
    const groupPanelStyle = groupPanel ? getComputedStyle(groupPanel) : null;
    const labelFilterRect = labelFilter?.getBoundingClientRect();
    const lastLabelRect = labelOptions.at(-1)?.getBoundingClientRect();
    const labelFooterRect = labelFooter?.getBoundingClientRect();
    const labelFooterGap = lastLabelRect && labelFooterRect
      ? Math.round(labelFooterRect.top - lastLabelRect.bottom)
      : 0;
    const labelWeights = labelOptions.map((node) => weightNumber(getComputedStyle(node).fontWeight));
    const recentNameWeights = recentNames.map((node) => weightNumber(getComputedStyle(node).fontWeight));
    const smallListShouldNotVirtualize = groupCount <= 60;
    const groupItemClippedByPanel = Boolean(
      groupPanel &&
      groupItem &&
      ["hidden", "clip"].includes(groupPanelStyle?.overflowY) &&
      groupItem.getBoundingClientRect().bottom > groupPanel.getBoundingClientRect().bottom + 1
    );

    return {
      ok: Boolean(
        groupList &&
        labelFilter &&
        (!smallListShouldNotVirtualize || !groupList.classList.contains("is-virtualized")) &&
        (!smallListShouldNotVirtualize || !/(auto|scroll|hidden|clip)/.test(groupListStyle?.overflowY || "")) &&
        !["hidden", "clip"].includes(groupPanelStyle?.overflowY || "") &&
        !groupItemClippedByPanel &&
        labelFooterGap <= 16 &&
        labelWeights.every((weight) => weight < 600) &&
        recentNameWeights.every((weight) => weight < 600)
      ),
      groupCount,
      groupListVirtualized: groupList?.classList.contains("is-virtualized") || false,
      groupListOverflowY: groupListStyle?.overflowY || "",
      groupPanelOverflowY: groupPanelStyle?.overflowY || "",
      labelFooterGap,
      labelFilterHeight: labelFilterRect ? Math.round(labelFilterRect.height) : 0,
      labelWeights,
      recentNameWeights,
      groupItemClippedByPanel
    };
  });
}

async function assertHumeRegionLayout(page) {
  return page.evaluate(() => {
    const rectFor = (selector) => {
      const element = document.querySelector(selector);
      const rect = element?.getBoundingClientRect();
      return rect
        ? { selector, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }
        : null;
    };
    const overlaps = (a, b) => Boolean(
      a && b &&
      a.left < b.right &&
      a.right > b.left &&
      a.top < b.bottom &&
      a.bottom > b.top
    );
    const controlPane = rectFor(".control-pane");
    const workspace = rectFor(".workspace-column");
    const matchControls = rectFor(".match-controls-panel");
    const reviewHeader = rectFor(".review-header");
    const detailSurface = rectFor("#detailSurface");
    const reportSummary = rectFor("#metrics");
    const desktop = document.documentElement.clientWidth >= 981;
    const majorOverlaps = [
      ["controlPane", controlPane, "workspace", workspace],
      ["matchControls", matchControls, "reviewHeader", reviewHeader],
      ["matchControls", matchControls, "detailSurface", detailSurface],
      ["reportSummary", reportSummary, "detailSurface", detailSurface]
    ].filter(([, a,, b]) => overlaps(a, b)).map(([aName, a,, bName]) => ({ aName, bName, a, b }));
    const gutter = desktop && controlPane && workspace ? Math.round(workspace.left - controlPane.right) : null;
    const matchControlsInRail = Boolean(matchControls && controlPane && matchControls.left >= controlPane.left - 1 && matchControls.right <= controlPane.right + 1);
    return {
      ok: majorOverlaps.length === 0 && (!desktop || gutter >= 28) && matchControlsInRail,
      desktop,
      gutter,
      matchControlsInRail,
      majorOverlaps,
      controlPane,
      workspace,
      matchControls,
      reviewHeader,
      detailSurface,
      reportSummary
    };
  });
}

async function assertSourceRailReflow(page, { longAlias, longInstanceUrl, restoreOrg }) {
  const widths = [1440, 390];
  const viewportStates = [];

  for (const width of widths) {
    await page.setViewportSize({ width, height: 960 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(100);
    viewportStates.push(await page.evaluate(() => {
      const rectFor = (selector) => {
        const element = document.querySelector(selector);
        const rect = element?.getBoundingClientRect();
        return rect
          ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }
          : null;
      };
      const overlaps = (a, b) => Boolean(
        a && b &&
        a.left < b.right &&
        a.right > b.left &&
        a.top < b.bottom &&
        a.bottom > b.top
      );
      const controlPane = rectFor(".control-pane");
      const workspace = rectFor(".workspace-column");
      const orgPanel = rectFor(".org-panel");
      const rail = document.querySelector(".control-pane");
      const railScrollBefore = rail ? rail.scrollTop : 0;
      if (rail) {
        rail.scrollTop = Math.min(rail.scrollHeight - rail.clientHeight, rail.scrollTop + 240);
      }
      const railScrollAfter = rail ? rail.scrollTop : 0;
      if (rail) rail.scrollTop = railScrollBefore;
      const root = document.scrollingElement || document.documentElement;
      const rootScrollBefore = root.scrollTop;
      root.scrollTop = Math.min(root.scrollHeight - root.clientHeight, root.scrollTop + 240);
      const rootScrollAfter = root.scrollTop;
      root.scrollTop = rootScrollBefore;
      return {
        width: document.documentElement.clientWidth,
        controlPane,
        workspace,
        orgPanel,
        overlap: overlaps(controlPane, workspace),
        controlPaneFitsViewport: Boolean(controlPane && controlPane.bottom <= window.innerHeight + 1),
        orgPanelFitsRail: Boolean(controlPane && orgPanel && orgPanel.right <= controlPane.right + 1),
        rootOverflow: root.scrollHeight > root.clientHeight + 1,
        rootScrollChanged: rootScrollAfter > rootScrollBefore,
        railScroll: rail
          ? {
              before: railScrollBefore,
              after: railScrollAfter,
              scrollHeight: rail.scrollHeight,
              clientHeight: rail.clientHeight,
              maxScrollTop: Math.max(0, rail.scrollHeight - rail.clientHeight)
            }
          : null
      };
    }));
  }

  await setSalesforceOrgSelection(page, { alias: longAlias, instanceUrl: longInstanceUrl });
  await page.waitForTimeout(100);

  const sourceToggle = page.getByRole("button", { name: "Source", exact: true });
  const matchControlsToggle = page.getByRole("button", { name: "Match Controls", exact: true });
  const matchGroupsToggle = page.getByRole("button", { name: "Match Groups", exact: true });

  const sourceHit = await probeHitTarget(page, '[aria-controls="sourcePanelBody"]', "center");
  const sourceBefore = await sourceToggle.getAttribute("aria-expanded");
  await sourceToggle.click();
  await page.waitForFunction(() => document.querySelector('[aria-controls="sourcePanelBody"]')?.getAttribute("aria-expanded") === "false", null, { timeout: 5000 });
  const sourceCollapsed = await sourceToggle.getAttribute("aria-expanded");
  await sourceToggle.click();
  await page.waitForFunction(() => document.querySelector('[aria-controls="sourcePanelBody"]')?.getAttribute("aria-expanded") === "true", null, { timeout: 5000 });

  await matchControlsToggle.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const matchControlsHit = await probeHitTarget(page, '[aria-controls="matchControlsPanelBody"]', "center");
  const matchControlsBefore = await matchControlsToggle.getAttribute("aria-expanded");
  await matchControlsToggle.click();
  await page.waitForFunction(() => document.querySelector('[aria-controls="matchControlsPanelBody"]')?.getAttribute("aria-expanded") === "false", null, { timeout: 5000 });
  const matchControlsCollapsed = await matchControlsToggle.getAttribute("aria-expanded");
  await matchControlsToggle.click();
  await page.waitForFunction(() => document.querySelector('[aria-controls="matchControlsPanelBody"]')?.getAttribute("aria-expanded") === "true", null, { timeout: 5000 });

  await matchGroupsToggle.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const matchGroupsHit = await probeHitTarget(page, '[aria-controls="matchGroupsPanelBody"]', "center");
  const matchGroupsBefore = await matchGroupsToggle.getAttribute("aria-expanded");
  await matchGroupsToggle.click();
  await page.waitForFunction(() => document.querySelector('[aria-controls="matchGroupsPanelBody"]')?.getAttribute("aria-expanded") === "false", null, { timeout: 5000 });
  const matchGroupsCollapsed = await matchGroupsToggle.getAttribute("aria-expanded");
  await matchGroupsToggle.click();
  await page.waitForFunction(() => document.querySelector('[aria-controls="matchGroupsPanelBody"]')?.getAttribute("aria-expanded") === "true", null, { timeout: 5000 });

  const orgState = await page.evaluate(() => ({
    label: document.querySelector("#orgSelectionLabel")?.textContent?.trim() || "",
    labelTitle: document.querySelector("#orgSelectionLabel")?.title || "",
    status: document.querySelector("#orgStatus")?.textContent?.trim() || "",
    aliasInputPresent: Boolean(document.querySelector("#orgAliasInput")),
    instanceUrlInputPresent: Boolean(document.querySelector("#orgInstanceUrlInput")),
    instanceUrlTagName: document.querySelector("#orgInstanceUrlValue")?.tagName || "",
    instanceUrlReadonly: document.querySelector("#orgInstanceUrlValue")?.tagName === "DIV",
    recentOptions: [...document.querySelectorAll("#orgRecentSelect option")].slice(1).map((option) => ({
      label: option.textContent || "",
      title: option.title || ""
    })),
    controlPane: document.querySelector(".control-pane")?.getBoundingClientRect()
      ? (() => {
          const rect = document.querySelector(".control-pane").getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
        })()
      : null,
    orgPanel: document.querySelector(".org-panel")?.getBoundingClientRect()
      ? (() => {
          const rect = document.querySelector(".org-panel").getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
        })()
      : null,
    rail: (() => {
      const rail = document.querySelector(".control-pane");
      return rail
        ? {
            scrollTop: rail.scrollTop,
            scrollHeight: rail.scrollHeight,
            clientHeight: rail.clientHeight,
            maxScrollTop: Math.max(0, rail.scrollHeight - rail.clientHeight)
          }
        : null;
    })()
  }));

  await setSalesforceOrgSelection(page, restoreOrg);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);

  return {
    ok:
      viewportStates.length === 2 &&
      viewportStates.every((state) => state && !state.overlap && state.orgPanelFitsRail) &&
      viewportStates.filter((state) => state.width >= 981).every((state) => state.controlPaneFitsViewport && state.railScroll && state.railScroll.after > state.railScroll.before && state.railScroll.maxScrollTop > 0) &&
      viewportStates.filter((state) => state.width < 981).every((state) => state.rootOverflow && state.rootScrollChanged) &&
      Boolean(sourceHit?.text?.includes("Source")) &&
      sourceBefore === "true" &&
      sourceCollapsed === "false" &&
      Boolean(matchControlsHit?.text?.includes("Match Controls")) &&
      matchControlsBefore === "true" &&
      matchControlsCollapsed === "false" &&
      Boolean(matchGroupsHit?.text?.includes("Match Groups")) &&
      matchGroupsBefore === "true" &&
      matchGroupsCollapsed === "false" &&
      orgState.label === "qa-smoke-org-with-an-extremely-long-name-that-should-truncate" &&
      orgState.labelTitle === orgState.label &&
      orgState.status.includes("Target org:") &&
      !orgState.aliasInputPresent &&
      !orgState.instanceUrlInputPresent &&
      orgState.instanceUrlTagName === "DIV" &&
      orgState.instanceUrlReadonly &&
      orgState.recentOptions.every((option) => option.label === option.label.trim() && !option.label.includes("·") && !option.label.includes("https://")) &&
      Boolean(orgState.rail),
    viewportStates,
    sourceHit,
    sourceBefore,
    sourceCollapsed,
    matchControlsHit,
    matchControlsBefore,
    matchControlsCollapsed,
    matchGroupsHit,
    matchGroupsBefore,
    matchGroupsCollapsed,
    orgState
  };
}

async function assertRightPaneSingleScrollModel(page) {
  const setup = await page.evaluate(() => {
    const workspace = document.querySelector(".workspace-column");
    const reviewPane = document.querySelector(".review-pane");
    const matchControls = document.querySelector(".match-controls-panel");
    const detailSurface = document.querySelector("#detailSurface");
    if (!workspace || !reviewPane || !matchControls || !detailSurface) {
      return { ready: false };
    }

    window.scrollTo(0, 0);
    workspace.scrollTop = 0;
    reviewPane.scrollTop = 0;
    const detailRect = detailSurface.getBoundingClientRect();
    const matchRect = matchControls.getBoundingClientRect();
    return {
      ready: true,
      targetX: Math.round(Math.min(Math.max(detailRect.left + detailRect.width / 2, 20), window.innerWidth - 20)),
      targetY: Math.round(Math.min(Math.max(detailRect.top + 40, 20), window.innerHeight - 20)),
      workspaceBefore: workspace.scrollTop,
      reviewBefore: reviewPane.scrollTop,
      matchTopBefore: Math.round(matchRect.top),
      windowBefore: window.scrollY,
      reviewOverflowY: getComputedStyle(reviewPane).overflowY,
      workspaceOverflowY: getComputedStyle(workspace).overflowY,
      workspaceScrollHeight: workspace.scrollHeight,
      workspaceClientHeight: workspace.clientHeight,
      reviewScrollHeight: reviewPane.scrollHeight,
      reviewClientHeight: reviewPane.clientHeight
    };
  });

  if (!setup.ready) return { ok: false, reason: "missing right-pane elements", ...setup };

  await page.mouse.move(setup.targetX, setup.targetY);
  await page.mouse.wheel(0, 640);
  await page.waitForTimeout(100);

  return page.evaluate((before) => {
    const workspace = document.querySelector(".workspace-column");
    const reviewPane = document.querySelector(".review-pane");
    const matchControls = document.querySelector(".match-controls-panel");
    const mergeSubmit = document.querySelector(".merge-submit-button");
    const workspaceAfterWheel = workspace.scrollTop;
    const reviewAfterWheel = reviewPane.scrollTop;
    const matchTopAfterWheel = Math.round(matchControls.getBoundingClientRect().top);
    const windowAfterWheel = window.scrollY;

    mergeSubmit?.scrollIntoView({ block: "center", inline: "nearest" });
    const mergeRect = mergeSubmit?.getBoundingClientRect();
    const mergeSubmitReachable = Boolean(
      mergeRect &&
      mergeRect.width > 0 &&
      mergeRect.height > 0 &&
      mergeRect.top >= 0 &&
      mergeRect.bottom <= window.innerHeight + 1
    );

    const reviewOverflowY = getComputedStyle(reviewPane).overflowY;
    const reviewOwnsVerticalScroll = ["auto", "scroll"].includes(reviewOverflowY) &&
      reviewPane.scrollHeight > reviewPane.clientHeight + 1;

    return {
      ok:
        (workspaceAfterWheel > before.workspaceBefore || windowAfterWheel > before.windowBefore) &&
        reviewAfterWheel <= before.reviewBefore + 1 &&
        matchTopAfterWheel <= before.matchTopBefore &&
        !reviewOwnsVerticalScroll &&
        mergeSubmitReachable,
      ...before,
      workspaceAfterWheel,
      reviewAfterWheel,
      matchTopAfterWheel,
      windowAfterWheel,
      reviewOwnsVerticalScroll,
      mergeSubmitReachable,
      workspaceAtBottom: workspace.scrollTop,
      mergeSubmitRect: mergeRect
        ? {
            top: Math.round(mergeRect.top),
            bottom: Math.round(mergeRect.bottom),
            height: Math.round(mergeRect.height)
          }
        : null
    };
  }, setup);
}

async function assertWindowScrollAvailable(page) {
  return page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    const hasOverflow = root.scrollHeight > root.clientHeight + 1;
    if (!hasOverflow) {
      return {
        hasOverflow,
        scrolled: true,
        scrollHeight: root.scrollHeight,
        clientHeight: root.clientHeight
      };
    }

    const before = window.scrollY;
    window.scrollTo(0, Math.min(root.scrollHeight - root.clientHeight, before + 260));
    const after = window.scrollY;
    return {
      hasOverflow,
      scrolled: after > before,
      before,
      after,
      scrollHeight: root.scrollHeight,
      clientHeight: root.clientHeight
    };
  });
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
