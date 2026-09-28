const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const output = path.resolve(__dirname, "../qa/screenshots");
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto("http://127.0.0.1:4173/?capture=1", { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const wanted = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const perStep = [];
  for (let step = 0; step < 9; step += 1) {
    await page.evaluate((targetStep) => {
      localStorage.setItem("pocket-money-video-cursor-v1", JSON.stringify({ chapter: 0, step: targetStep }));
    }, step);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    perStep.push(await page.evaluate(() => ({
      step: document.querySelector(".step-count")?.textContent,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      shell: document.querySelector(".lesson-shell")?.getBoundingClientRect().toJSON(),
      header: document.querySelector(".lesson-header")?.getBoundingClientRect().toJSON(),
      frame: document.querySelector(".stage-frame")?.getBoundingClientRect().toJSON(),
      frameTransform: getComputedStyle(document.querySelector(".stage-frame")).transform,
      shellTransform: getComputedStyle(document.querySelector(".lesson-shell")).transform,
    })));
    if (wanted.has(step)) {
      await page.screenshot({ path: path.join(output, `step-${step + 1}.png`) });
    }
  }
  const diagnostics = await page.evaluate(() => ({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    scene: document.querySelector(".lesson-scene")?.getBoundingClientRect().toJSON(),
    shell: document.querySelector(".lesson-shell")?.getBoundingClientRect().toJSON(),
  }));
  diagnostics.perStep = perStep;
  fs.writeFileSync(path.resolve(__dirname, "../qa/layout-diagnostics.json"), JSON.stringify(diagnostics, null, 2));
  await browser.close();
})();
