const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const config = require("../video.config.json");

(async () => {
  const project = path.resolve(__dirname, "..");
  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.addInitScript(() => {
    localStorage.clear();
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler, delay = 0, ...args) =>
      nativeSetTimeout(handler, Math.max(80, Number(delay) / 120), ...args));
  });
  await page.goto(`http://127.0.0.1:${config.port}/?auto=1&capture=1`, { waitUntil: "networkidle" });
  await page.evaluate((selector) => {
    window.__autoFlow = [];
    const record = () => {
      const node = document.querySelector(selector);
      const value = node?.className || "";
      if (value && window.__autoFlow.at(-1) !== value) window.__autoFlow.push(value);
    };
    record();
    new MutationObserver(record).observe(document.body, { childList: true, subtree: true });
  }, config.sceneSelector);
  await page.locator(".auto-gate").click();
  await page.waitForSelector(config.finalSelector, { timeout: 15000 });
  const sequence = await page.evaluate(() => window.__autoFlow);
  if (sequence.length !== config.steps) {
    throw new Error(`Expected ${config.steps} visual steps, saw ${sequence.length}: ${sequence.join(" -> ")}`);
  }
  fs.writeFileSync(path.join(project, "qa", "auto-flow.json"), JSON.stringify({
    passed: true,
    expectedSteps: config.steps,
    observedSteps: sequence.length,
    sequence,
    firstStepPreserved: !sequence[0].includes("final"),
    finalReached: sequence.at(-1).includes(config.finalSelector.slice(1)),
  }, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

