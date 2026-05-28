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

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const latestRecentFiles = await assertLatestRecentFiles(page);
    await page.screenshot({ path: path.join(outDir, "desktop-empty.png"), fullPage: false });

    const emptyChooseVisible = await page.locator('[data-empty-action="choose-csv"]').isVisible();
    const emptyDemoVisible = await page.locator('[data-empty-action="demo-data"]').isVisible();
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
    await page.getByRole("button", { name: /Match Controls/ }).click();
    const matchControlsExpanded = await page.getByRole("button", { name: /Match Controls/ }).getAttribute("aria-expanded");
    await setRangeValue(page, "#threshold", "80");
    await setRangeValue(page, "#maxThreshold", "99");
    const thresholdReadout = await page.locator("#thresholdValue").textContent();
    await page.locator("#highRecallMode").check();
    await page.locator("#applyControlsButton").click();
    await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: 10000 });
    const thresholdFilteredScores = await visibleGroupScores(page);
    await setRangeValue(page, "#maxThreshold", "100");
    await page.locator("#applyControlsButton").click();
    await page.locator(".group-item-main").first().waitFor({ state: "visible", timeout: 10000 });
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
    await page.locator(".group-select").first().check();
    const batchDuplicateEnabled = await page.locator("#batchDuplicateButton").isEnabled();
    await page.locator("#clearSelectionButton").click();
    const selectedCountCleared = (await page.locator("#selectedCount").textContent()) === "0 selected";
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
    const trainingExportEnabled = await page.locator("#trainingExportButton").isEnabled();

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

    await page.getByRole("button", { name: "Shortcuts" }).click();
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
    if (!latestRecentFiles.contacts || !latestRecentFiles.accounts) {
      throw new Error(`Expected latest Contact and Account exports in Recent files: ${JSON.stringify(latestRecentFiles)}`);
    }
    if (!csvMenuClosed) throw new Error("Expected CSV object menu to close with Escape.");
    if (matchControlsExpanded !== "true") throw new Error("Expected Match Controls panel to expand.");
    if (thresholdReadout !== "80-99") throw new Error(`Expected threshold readout to update to 80-99, got ${thresholdReadout}.`);
    if (!thresholdFilteredScores.length || thresholdFilteredScores.some((score) => score < 80 || score > 99)) {
      throw new Error(`Expected max threshold to limit visible scores to 80-99: ${JSON.stringify(thresholdFilteredScores)}`);
    }
    if (sortPressed !== "true") throw new Error("Expected group sort toggle to respond.");
    if (!sortTopState.firstSelected || sortTopState.scrollTop > 1 || !sortTopState.scoresAscending) {
      throw new Error(`Expected sorting ascending to keep the first visible group selected at the top: ${JSON.stringify(sortTopState)}`);
    }
    if (!batchDuplicateEnabled) throw new Error("Expected batch buttons to enable after selecting a visible group.");
    if (!selectedCountCleared) throw new Error("Expected Clear selection to reset selected count.");
    if (!separatedBadgeVisible) throw new Error("Expected Separate action to show a separated-record badge.");
    if (!fieldResolutionSelectable) throw new Error("Expected visible field-resolution selects to contain options.");
    if (!trainingExportEnabled) throw new Error("Expected training label action to enable label export.");
    if (!duplicateBadges) throw new Error("Expected at least one Duplicate decision badge.");
    if (!notDuplicateBadges) throw new Error("Expected at least one Not Duplicate decision badge.");
    if (!mergeMasterRadios) throw new Error("Expected Contact merge master radios.");
    if (!mergeFieldRadios) throw new Error("Expected Contact merge field radios.");
    if (!mergeMasterCanChange) throw new Error("Expected Contact merge master radio selection to change.");
    if (!mergeFieldCanChange) throw new Error("Expected Contact merge field radio selection to change.");
    if (mergeConfirmationValue !== "MERGE") throw new Error("Expected Contact merge confirmation input to accept text.");
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
      thresholdFilteredScores,
      sortPressed,
      sortTopState,
      batchDuplicateEnabled,
      selectedCountCleared,
      separatedBadgeVisible,
      fieldResolutionSelects,
      trainingExportEnabled,
      duplicateBadges,
      notDuplicateBadges,
      mergeMasterRadios,
      mergeFieldRadios,
      mergeMasterCanChange,
      mergeFieldCanChange,
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
  const rows = [["Id", "First Name", "Last Name", "Company", "Email", "Phone", "Mobile"]];
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
    rows.push([firstId, firstName, lastName, company, email, firstPhone, ""]);
    rows.push([secondId, firstName, lastName, `${company} Inc.`, email, "", secondMobile]);
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

async function setRangeValue(page, selector, value) {
  await page.locator(selector).evaluate((input, nextValue) => {
    input.value = nextValue;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
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
        return style.pointerEvents === "none" || rect.width < 8 || rect.height < 8;
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
