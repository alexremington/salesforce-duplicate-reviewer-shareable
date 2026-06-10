function isVisibleRect(rect) {
  return rect && rect.width > 0 && rect.height > 0;
}

async function probeHitTarget(page, selector, point = "center") {
  const locator = page.locator(selector);
  const box = await locator.boundingBox();
  if (!isVisibleRect(box)) {
    throw new Error(`No visible bounding box for ${selector}`);
  }

  const x = point === "right" ? box.x + box.width - 1 : point === "left" ? box.x + 1 : box.x + box.width / 2;
  const y = box.y + box.height / 2;
  return page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y);
    return {
      x,
      y,
      tagName: element ? element.tagName : null,
      id: element ? element.id : null,
      className: element ? element.className : null,
      text: element ? element.textContent : null,
    };
  }, { x, y });
}

async function assertNoOverlap(page, firstSelector, secondSelector) {
  const first = await page.locator(firstSelector).boundingBox();
  const second = await page.locator(secondSelector).boundingBox();
  if (!isVisibleRect(first) || !isVisibleRect(second)) {
    throw new Error(`Missing bounding box for ${firstSelector} or ${secondSelector}`);
  }

  const overlap = first.x < second.x + second.width &&
    first.x + first.width > second.x &&
    first.y < second.y + second.height &&
    first.y + first.height > second.y;

  if (overlap) {
    throw new Error(`Overlap detected between ${firstSelector} and ${secondSelector}`);
  }
}

module.exports = {
  assertNoOverlap,
  probeHitTarget,
};
