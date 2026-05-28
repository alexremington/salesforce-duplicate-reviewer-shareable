const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { loadPlaywright } = require("../vendor/managed-app/scripts/playwright-loader");

let chromium;
try {
  ({ chromium } = loadPlaywright());
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const baseUrl = process.env.DUPLICATE_REVIEWER_URL || "http://127.0.0.1:5180";
const outDir = process.env.PLAYWRIGHT_SMOKE_OUT_DIR || path.join(os.tmpdir(), "duplicate-reviewer-playwright");

async function run() {
  await fs.mkdir(outDir, { recursive: true });
  const csvPath = path.join(outDir, "contacts-smoke.csv");
  const accountCsvPath = path.join(outDir, "accounts-smoke.csv");
  await fs.writeFile(csvPath, contactSmokeCsv());
  await fs.writeFile(accountCsvPath, [
    "Id,Name,Website,Billing Street,Billing City,Billing State,Billing Postal Code,Billing Country",
    "001T00000000001,Northstar Analytics Inc.,northstar.example,125 Market St,San Francisco,CA,94105,United States",
    "001T00000000002,Northstar Analytics,https://northstar.example,125 Market Street,San Francisco,California,94105,US"
  ].join("\n"));

  const browser = await chromium.launch();
  const messages = [];

  try {
    const fileModeRedirect = await assertFileModeRedirect(browser);

    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        messages.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => messages.push(`pageerror: ${error.message}`));

    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const latestRecentFiles = await assertLatestRecentFiles(page);
    const lightTheme = await themeColorState(page);
    const lightPaneSurfaces = await paneSurfaceState(page);
    await page.screenshot({ path: path.join(outDir, "desktop-empty.png"), fullPage: false });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(100);
    const darkTheme = await themeColorState(page);
    const darkPaneSurfaces = await paneSurfaceState(page);
    await page.screenshot({ path: path.join(outDir, "desktop-empty-dark.png"), fullPage: false });
    await page.emulateMedia({ colorScheme: "light" });

    const emptyChooseVisible = await page.locator('[data-empty-action="choose-csv"]').isVisible();
    const emptyDemoVisible = await page.locator('[data-empty-action="demo-data"]').isVisible();
    const filterFieldDisabledBeforeLoad = await page.locator(".filter-row .filter-field-select").first().isDisabled();
    const applyDisabledBeforeLoad = await page.locator("#applyControlsButton").isDisabled();
    const labelStatusDisabledBeforeLoad = await page.locator('[data-label-status-filter][value="unlabeled"]').isDisabled();
    const hideLabeledDisabledBeforeLoad = await page.locator("#hideLabeledGroups").isDisabled();
    await page.locator("#chooseCsvButton").click();
    await page.getByRole("menuitem", { name: "Contacts" }).waitFor({ state: "visible", timeout: 5000 });
    await page.keyboard.press("Escape");
    const csvMenuClosed = await page.locator("#csvObjectMenu").isHidden();
    await page.locator('[data-empty-action="demo-data"]').click();
    await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: 10000 });

    await page.locator("#csvInput").setInputFiles(csvPath);
    await page.locator("#loadingModal").waitFor({ state: "hidden", timeout: 10000 });
    await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: 10000 });
    await page.locator(".group-item-main").first().click();
    const matchControlsButton = page.getByRole("button", { name: /Match Controls/ });
    if (await matchControlsButton.getAttribute("aria-expanded") !== "true") {
      await matchControlsButton.click();
    }
    const matchControlsExpanded = await matchControlsButton.getAttribute("aria-expanded");
    await setRangeValue(page, "#threshold", "80");
    await setRangeValue(page, "#maxThreshold", "99");
    const thresholdReadout = await page.locator("#thresholdValue").textContent();
    const thresholdControl = await thresholdControlState(page);
    await setNumberValue(page, "#thresholdMinNumber", "105");
    const thresholdClampState = await thresholdControlState(page);
    await setNumberValue(page, "#thresholdMinNumber", "80");
    const thresholdTypedState = await thresholdControlState(page);
    const fastestSearchDefaultUnchecked = !(await page.locator("#highRecallMode").isChecked());
    const labelStatusEnabledAfterLoad = await page.locator('[data-label-status-filter][value="unlabeled"]').isEnabled();
    const hideLabeledEnabledAfterLoad = await page.locator("#hideLabeledGroups").isEnabled();
    await page.locator("#applyControlsButton").click();
    await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: 10000 });
    const thresholdFilteredScores = await visibleGroupScores(page);
    await setRangeValue(page, "#maxThreshold", "100");
    await page.locator("#applyControlsButton").click();
    await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: 10000 });
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

    const trainingMatchButton = page.locator('[data-label-action="match"]').first();
    if (await trainingMatchButton.isVisible()) {
      await trainingMatchButton.click();
    }
    await page.locator(".group-item.is-label-full .label-status-indicator.full").first().waitFor({ state: "visible", timeout: 5000 });
    const fullLabelIndicators = await page.locator(".group-item.is-label-full .label-status-indicator.full").count();
    const trainingExportEnabled = await page.locator("#trainingExportButton").isEnabled();
    const labelStatusFilterState = await exerciseLabelStatusFilter(page);

    await page.getByLabel("Duplicate review workspace").getByRole("button", { name: "Duplicate", exact: true }).click();
    await page.locator(".record-decision-badge.duplicate").first().waitFor({ state: "visible", timeout: 5000 });

    const duplicateBadges = await page.locator(".record-decision-badge.duplicate").count();
    await page.screenshot({ path: path.join(outDir, "desktop-duplicate.png"), fullPage: false });

    await page.getByLabel("Duplicate review workspace").getByRole("button", { name: "Not Duplicate", exact: true }).click();
    await page.locator(".record-decision-badge.not-duplicate").first().waitFor({ state: "visible", timeout: 5000 });
    const notDuplicateBadges = await page.locator(".record-decision-badge.not-duplicate").count();
    await page.screenshot({ path: path.join(outDir, "desktop-not-duplicate.png"), fullPage: false });

    await page.getByLabel("Duplicate review workspace").getByRole("button", { name: "Duplicate", exact: true }).click();
    await page.locator('[data-review-mode="merge"]').click();
    await page.locator(".merge-master-radio").first().waitFor({ state: "visible", timeout: 5000 });
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
    await page.locator(".merge-confirmation-input").fill("MERGE");
    const mergeConfirmationValue = await page.locator(".merge-confirmation-input").inputValue();
    const mergePayload = await captureMergePayload(page);
    await page.setViewportSize({ width: 1280, height: 560 });
    const reviewPaneScroll = await assertVerticalScrollAvailable(page, ".review-pane", "review pane");
    const rootScrollPolicy = await assertRootScrollPolicy(page);
    const interactiveReachability = await visibleInteractiveReachability(page);
    await page.screenshot({ path: path.join(outDir, "desktop-merge.png"), fullPage: false });

    await page.locator("#chooseCsvButton").click();
    await page.getByRole("menuitem", { name: "Accounts" }).click();
    await page.locator("#csvInput").setInputFiles(accountCsvPath);
    await page.locator("#loadingModal").waitFor({ state: "hidden", timeout: 10000 });
    await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: 10000 });
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
    await page.screenshot({ path: path.join(outDir, "mobile-review.png"), fullPage: false });

    const layout = await page.evaluate(() => ({
      viewportWidth: document.documentElement.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth
    }));

    if (!emptyChooseVisible) throw new Error("Expected empty-state Choose CSV action to be visible.");
    if (!emptyDemoVisible) throw new Error("Expected empty-state Load Demo action to be visible.");
    if (!lightTheme.colorScheme.includes("light") || !darkTheme.colorScheme.includes("dark") || lightTheme.bodyBg === darkTheme.bodyBg) {
      throw new Error(`Expected the UI theme to follow system light/dark mode: ${JSON.stringify({ lightTheme, darkTheme })}`);
    }
    if (!lightPaneSurfaces.standardized || !darkPaneSurfaces.standardized) {
      throw new Error(`Expected layout panes to share one canvas background: ${JSON.stringify({ lightPaneSurfaces, darkPaneSurfaces })}`);
    }
    if (!filterFieldDisabledBeforeLoad || !applyDisabledBeforeLoad || !labelStatusDisabledBeforeLoad || !hideLabeledDisabledBeforeLoad) {
      throw new Error("Expected match filters and Apply to be disabled before a dataset is loaded.");
    }
    if (!latestRecentFiles.contacts || !latestRecentFiles.accounts) {
      throw new Error(`Expected latest Contact and Account exports in Recent files: ${JSON.stringify(latestRecentFiles)}`);
    }
    if (!csvMenuClosed) throw new Error("Expected CSV object menu to close with Escape.");
    if (matchControlsExpanded !== "true") throw new Error("Expected Match Controls panel to expand.");
    if (thresholdReadout !== "80-99") throw new Error(`Expected threshold readout to update to 80-99, got ${thresholdReadout}.`);
    if (thresholdControl.minRange !== "80" || thresholdControl.maxRange !== "99" || thresholdControl.minNumber !== "80" || thresholdControl.maxNumber !== "99") {
      throw new Error(`Expected dual threshold control to sync sliders and number inputs: ${JSON.stringify(thresholdControl)}`);
    }
    if (thresholdClampState.minRange !== "99" || thresholdClampState.maxRange !== "99") {
      throw new Error(`Expected min threshold typing to stop at the max handle: ${JSON.stringify(thresholdClampState)}`);
    }
    if (thresholdTypedState.minRange !== "80" || thresholdTypedState.maxRange !== "99") {
      throw new Error(`Expected typed min threshold to update the slider: ${JSON.stringify(thresholdTypedState)}`);
    }
    if (!fastestSearchDefaultUnchecked) {
      throw new Error("Expected fastest search to be opt-in so broader candidate search is the default.");
    }
    if (!labelStatusEnabledAfterLoad) throw new Error("Expected label status filters to enable after loading a dataset.");
    if (!hideLabeledEnabledAfterLoad) throw new Error("Expected Match Groups filters to enable after loading a dataset.");
    if (!thresholdFilteredScores.length || thresholdFilteredScores.some((score) => score < 80 || score > 99)) {
      throw new Error(`Expected max threshold to limit visible scores to 80-99: ${JSON.stringify(thresholdFilteredScores)}`);
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
    if (!customFilterState.singleFilterLayout.sameLine) {
      throw new Error(`Expected field, operator, and value to stay on one desktop line: ${JSON.stringify(customFilterState.singleFilterLayout)}`);
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
    if (!trainingExportEnabled) throw new Error("Expected training label action to enable label export.");
    if (!fullLabelIndicators) throw new Error("Expected fully labeled groups to show a green label indicator.");
    if (!labelStatusFilterState.filteredCount || !labelStatusFilterState.visibleFullCount) {
      throw new Error(`Expected label status checkboxes to filter fully labeled groups: ${JSON.stringify(labelStatusFilterState)}`);
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
    if (mergeConfirmationValue !== "MERGE") throw new Error("Expected Contact merge confirmation input to accept text.");
    if (mergePayload.masterFields?.LeadSource !== "Web") {
      throw new Error(`Expected Salesforce merge payload to preserve oldest Lead Source: ${JSON.stringify(mergePayload)}`);
    }
    if (!accountMergeDisabled) throw new Error("Expected Account merge mode to be disabled.");
    if (!shortcutsVisible) throw new Error("Expected shortcuts modal to be visible.");
    if (!rootScrollPolicy.ok) throw new Error(`Root scrolling is suppressed: ${JSON.stringify(rootScrollPolicy)}`);
    if (reviewPaneScroll.hasOverflow && !reviewPaneScroll.scrolled) {
      throw new Error(`Review pane has clipped content but did not scroll: ${JSON.stringify(reviewPaneScroll)}`);
    }
    if (mobileScroll.hasOverflow && !mobileScroll.scrolled) {
      throw new Error(`Mobile page has clipped content but did not scroll: ${JSON.stringify(mobileScroll)}`);
    }
    if (interactiveReachability.broken.length) {
      throw new Error(`Visible interactive controls are not reachable: ${JSON.stringify(interactiveReachability.broken)}`);
    }
    if (layout.pageScrollWidth > layout.viewportWidth || layout.bodyScrollWidth > layout.viewportWidth) {
      throw new Error(`Unexpected horizontal overflow: ${JSON.stringify(layout)}`);
    }
    if (messages.length) throw new Error(`Browser console warnings/errors: ${messages.join(" | ")}`);

    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      emptyChooseVisible,
      emptyDemoVisible,
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
      fastestSearchDefaultUnchecked,
      thresholdFilteredScores,
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
      mergePayload,
      accountMergeDisabled,
      shortcutsVisible,
      fileModeRedirect,
      rootScrollPolicy,
      reviewPaneScroll,
      mobileScroll,
      interactiveCount: interactiveReachability.count,
      layout,
      screenshotsDir: outDir
    }, null, 2));
  } finally {
    await browser.close();
  }
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
  const indexUrl = new URL(pathToFileURL(path.join(__dirname, "..", "index.html")).href);
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

function contactSmokeCsv() {
  const rows = [["Id", "First Name", "Last Name", "Company", "Email", "Lead Source", "Created Date", "Phone", "Mobile"]];
  const names = [
    ["Maya", "Rodriguez"],
    ["John", "Pierce"],
    ["Priya", "Shah"],
    ["Daniel", "Kim"],
    ["Aisha", "Johnson"],
    ["Lucas", "Martin"],
    ["Nora", "Bennett"],
    ["Ethan", "Cole"],
    ["Sofia", "Rivera"],
    ["Caleb", "Morgan"],
    ["Leah", "Patel"],
    ["Owen", "Reed"],
    ["Amelia", "Stone"],
    ["Noah", "Brooks"],
    ["Grace", "Chen"],
    ["Isaac", "Turner"],
    ["Emma", "Walker"],
    ["Liam", "Foster"],
    ["Zoe", "Carter"],
    ["Henry", "Morris"],
    ["Mia", "Hayes"],
    ["Leo", "Parker"],
    ["Chloe", "Bailey"],
    ["Miles", "Cooper"]
  ];
  for (let index = 1; index <= 24; index += 1) {
    const firstId = `003T${String(index * 2 - 1).padStart(11, "0")}`;
    const secondId = `003T${String(index * 2).padStart(11, "0")}`;
    const nearMatch = index % 3 === 0;
    const email = nearMatch ? "" : `contact${index}@example.com`;
    const [firstName, lastName] = names[index - 1];
    const company = index % 2 ? `Northstar Analytics ${index}` : `CivicWire ${index}`;
    const firstPhone = `(555) 010-${String(index).padStart(4, "0")}`;
    const secondMobile = nearMatch ? `(555) 990-${String(index).padStart(4, "0")}` : `(555) 020-${String(index).padStart(4, "0")}`;
    const day = String((index % 28) + 1).padStart(2, "0");
    rows.push([firstId, firstName, lastName, company, email, "Web", `2024-01-${day}T09:00:00.000Z`, firstPhone, ""]);
    rows.push([secondId, firstName, lastName, `${company} Inc.`, email, "Referral", `2025-01-${day}T09:00:00.000Z`, "", secondMobile]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
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

async function captureMergePayload(page) {
  let payload = null;
  await page.route("**/api/salesforce/merge", async (route) => {
    payload = JSON.parse(route.request().postData() || "{}");
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
        mergedAt: new Date().toISOString()
      })
    });
  });

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(".merge-submit-button").click();
  await page.locator(".merge-result.success").waitFor({ state: "visible", timeout: 5000 });
  await page.unroute("**/api/salesforce/merge");
  return payload || {};
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
      accent: root.getPropertyValue("--accent").trim()
    };
  });
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
  await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: 10000 });
  const filteredCount = await page.locator("#groupCount").evaluate((node) => Number(node.textContent?.replace(/,/g, "") || 0));
  const logicMode = await page.locator(".filter-logic-mode-select").inputValue();
  const logicValue = await page.locator(".filter-logic-input").inputValue();

  while (await page.locator("[data-filter-remove]").count()) {
    await page.locator("[data-filter-remove]").first().click();
  }
  await page.locator("#applyControlsButton").click();
  await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: 10000 });

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
  await fullCheckbox.check();
  await page.locator("#applyControlsButton").click();
  await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: 10000 });
  const filteredCount = await page.locator("#groupCount").evaluate((node) => Number(node.textContent?.replace(/,/g, "") || 0));
  const visibleFullCount = await page.locator(".group-item.is-label-full").count();
  await fullCheckbox.uncheck();
  await page.locator("#applyControlsButton").click();
  await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: 10000 });
  return { filteredCount, visibleFullCount };
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
    const controls = [
      row.querySelector(".filter-field-select"),
      row.querySelector(".filter-operator-select"),
      row.querySelector(".filter-value-control")
    ].filter(Boolean);
    const tops = controls.map((control) => Math.round(control.getBoundingClientRect().top));
    return {
      controlCount: controls.length,
      tops,
      sameLine: tops.length >= 3 && Math.max(...tops) - Math.min(...tops) <= 2
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

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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

async function visibleInteractiveReachability(page) {
  return page.evaluate(() => {
    const intentionallyHidden = new Set(["csvInput", "trainingImportInput"]);
    const controls = [...document.querySelectorAll("button, input, select, textarea, a[href], [role='button'], [role='menuitem']")];
    const visibleControls = controls.filter((element) => {
      if (intentionallyHidden.has(element.id)) return false;
      if (element.disabled || element.hidden || element.getAttribute("aria-hidden") === "true") return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    });
    const broken = visibleControls
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const pointerEventsHandledByThumb = element.classList.contains("threshold-slider-input");
        return (style.pointerEvents === "none" && !pointerEventsHandledByThumb) || rect.width < 8 || rect.height < 8;
      })
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id || "",
        className: String(element.className || ""),
        text: String(element.textContent || element.getAttribute("aria-label") || "").trim().slice(0, 60)
      }));

    return {
      count: visibleControls.length,
      broken
    };
  });
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
