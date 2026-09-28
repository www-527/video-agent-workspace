const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const project = path.resolve(__dirname, "..");
  const output = path.join(project, "qa", "screenshots");
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  const diagnostics = [];

  for (let step = 0; step < 10; step += 1) {
    await page.goto("http://127.0.0.1:4175/?capture=1", { waitUntil: "networkidle" });
    await page.evaluate((target) => {
      localStorage.setItem("stock-puzzle-video-cursor-v1", JSON.stringify({ chapter: 0, step: target }));
    }, step);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(3200);
    await page.screenshot({ path: path.join(output, `step-${String(step + 1).padStart(2, "0")}.png`) });
    diagnostics.push(await page.evaluate((currentStep) => {
      const safe = { left: 96, top: 80, right: 1824, bottom: 1000 };
      const visibleOutsideSafe = [...document.querySelectorAll(".sp-scene *")]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return { tag: element.tagName, cls: element.className?.toString().slice(0, 120) ?? "", text: element.textContent?.trim().slice(0, 60) ?? "", rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, opacity: Number(style.opacity), visibility: style.visibility };
        })
        .filter((item) => item.tag !== "IMG")
        .filter((item) => item.rect.width > 1 && item.rect.height > 1 && item.opacity > 0.05 && item.visibility !== "hidden")
        .filter((item) => item.rect.x < safe.left - 1 || item.rect.y < safe.top - 1 || item.rect.x + item.rect.width > safe.right + 1 || item.rect.y + item.rect.height > safe.bottom + 1);
      return { step: currentStep, sceneClass: document.querySelector(".sp-scene")?.className, outsideSafe: visibleOutsideSafe, bodyScroll: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight } };
    }, step));
  }
  fs.writeFileSync(path.join(project, "qa", "layout-diagnostics.json"), JSON.stringify({ diagnostics, consoleErrors }, null, 2));
  await browser.close();
})();
