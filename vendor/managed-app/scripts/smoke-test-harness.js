const { loadPlaywright } = require("./playwright-loader");

function loadChromium() {
  const { chromium } = loadPlaywright();
  return chromium;
}

function assertPerformanceBudget(label, elapsedMs, budgetMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs > budgetMs) {
    throw new Error(`${label} exceeded the smoke-test performance budget: ${elapsedMs}ms > ${budgetMs}ms.`);
  }
}

async function visibleInteractiveReachability(page, options = {}) {
  return page.evaluate((config) => {
    const intentionallyHidden = new Set(config.intentionallyHiddenIds || []);
    const pointerEventsAllowedClassNames = new Set(config.pointerEventsAllowedClassNames || []);
    const sharedHitAncestorSelectors = config.sharedHitAncestorSelectors || [];
    const controls = [...document.querySelectorAll("button, input, select, textarea, a[href], [role='button'], [role='menuitem']")];
    const controlLabel = (element) => String(
      element.textContent ||
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      element.getAttribute("placeholder") ||
      element.value ||
      ""
    ).trim().replace(/\s+/g, " ").slice(0, 80);
    const elementDescriptor = (element) => ({
      tag: element.tagName.toLowerCase(),
      id: element.id || "",
      className: String(element.className || ""),
      text: controlLabel(element)
    });
    const isCoveredByOwnClickableSurface = (element, hitTarget) => {
      if (!hitTarget) return false;
      if (element === hitTarget || element.contains(hitTarget)) return true;
      const elementPointerAllowed = [...pointerEventsAllowedClassNames].some((className) => element.classList.contains(className));
      const targetPointerAllowed = [...pointerEventsAllowedClassNames].some((className) => hitTarget.classList?.contains(className));
      const sharesAllowedAncestor = sharedHitAncestorSelectors.length
        ? sharedHitAncestorSelectors.some((selector) => element.closest(selector) === hitTarget.closest?.(selector))
        : element.parentElement === hitTarget.parentElement;
      if (elementPointerAllowed && targetPointerAllowed && sharesAllowedAncestor) return true;
      if (element.id) {
        const label = hitTarget.closest?.("label");
        if (label?.htmlFor === element.id || label?.contains(element)) return true;
      }
      const parentLabel = element.closest("label");
      return Boolean(parentLabel && parentLabel.contains(hitTarget));
    };
    const hitPointForElement = (element) => {
      const rects = [...element.getClientRects()].filter((rect) => (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth
      ));
      const rect = rects[0];
      if (!rect) return null;
      return {
        x: Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 1),
        y: Math.min(Math.max(rect.top + rect.height / 2, 1), window.innerHeight - 1)
      };
    };
    const pointIsInsideClippingAncestors = (element, point) => {
      if (!point) return false;
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (!/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) continue;
        const rect = ancestor.getBoundingClientRect();
        if (
          point.x < rect.left ||
          point.x > rect.right ||
          point.y < rect.top ||
          point.y > rect.bottom
        ) {
          return false;
        }
      }
      return true;
    };
    const visibleControls = controls.filter((element) => {
      if (intentionallyHidden.has(element.id)) return false;
      if (element.disabled || element.hidden || element.getAttribute("aria-hidden") === "true") return false;
      if (element.type === "hidden") return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const hitPoint = hitPointForElement(element);
      return style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0 &&
        pointIsInsideClippingAncestors(element, hitPoint);
    });
    const broken = visibleControls
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const pointerEventsAllowed = [...pointerEventsAllowedClassNames].some((className) => element.classList.contains(className));
        if ((style.pointerEvents === "none" && !pointerEventsAllowed) || rect.width < 8 || rect.height < 8) return true;
        const hitPoint = hitPointForElement(element);
        if (!hitPoint) return false;
        const hitTarget = document.elementFromPoint(hitPoint.x, hitPoint.y);
        return !isCoveredByOwnClickableSurface(element, hitTarget);
      })
      .map((element) => {
        const hitPoint = hitPointForElement(element);
        const hitTarget = hitPoint ? document.elementFromPoint(hitPoint.x, hitPoint.y) : null;
        return {
          ...elementDescriptor(element),
          hitPoint,
          hitTarget: hitTarget ? elementDescriptor(hitTarget) : null
        };
      });

    return {
      count: visibleControls.length,
      broken
    };
  }, {
    intentionallyHiddenIds: options.intentionallyHiddenIds || [],
    pointerEventsAllowedClassNames: options.pointerEventsAllowedClassNames || [],
    sharedHitAncestorSelectors: options.sharedHitAncestorSelectors || []
  });
}

module.exports = {
  assertPerformanceBudget,
  loadChromium,
  loadPlaywright,
  visibleInteractiveReachability
};
