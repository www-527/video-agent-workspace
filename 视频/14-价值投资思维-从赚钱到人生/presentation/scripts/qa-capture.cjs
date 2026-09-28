const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const project = path.resolve(__dirname, "..");
  const output = path.join(project, "qa", "screenshots");
  const port = process.env.PORT || "4177";
  const steps = Number(process.env.STEPS || 20);
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${port}/?capture=1`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  const diagnostics = [];
  for (let step = 0; step < steps; step += 1) {
    await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(output, `step-${String(step + 1).padStart(2, "0")}.png`) });
    diagnostics.push(await page.evaluate((currentStep) => {
      const safe = { left: 96, top: 80, right: 1824, bottom: 1000 };
      const nodes = [...document.querySelectorAll(".scene-safe *")];
      const visibleText = nodes.map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const ownText = [...element.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent || "").join(" ").trim();
        return { tag: element.tagName, cls: String(element.className || "").slice(0, 100), text: ownText.slice(0, 70), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, opacity: Number(style.opacity), visibility: style.visibility, overflow: element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2 };
      }).filter((item) => item.text && item.rect.width > 1 && item.rect.height > 1 && item.opacity > .05 && item.visibility !== "hidden");
      const outsideSafe = visibleText.filter((item) => item.rect.x < safe.left - 2 || item.rect.y < safe.top - 2 || item.rect.x + item.rect.width > safe.right + 2 || item.rect.y + item.rect.height > safe.bottom + 2);
      return { step: currentStep, sceneClass: document.querySelector("section")?.className || "", outsideSafe, textOverflow: visibleText.filter((item) => item.overflow), bodyScroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight } };
    }, step));
    if (step < steps - 1) await page.keyboard.press("ArrowRight");
  }
  fs.writeFileSync(path.join(project, "qa", "layout-diagnostics.json"), JSON.stringify({ steps, diagnostics, consoleErrors }, null, 2));
  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
