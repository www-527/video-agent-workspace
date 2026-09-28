const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const project = path.resolve(__dirname, "..");
  const recordDir = path.join(project, "qa", "recording");
  const output = path.join(project, "qa", "chapter03-screen.webm");
  fs.mkdirSync(recordDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: recordDir, size: { width: 1920, height: 1080 } } });
  await context.addInitScript(() => localStorage.clear());
  const createdAt = Date.now();
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4175/?auto=1&capture=1", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const startedAt = Date.now();
  await page.keyboard.press("Space");
  let reachedFinal = false;
  for (let elapsed = 0; elapsed < 540000; elapsed += 15000) {
    await page.waitForTimeout(15000);
    const scene = await page.locator(".sp-scene").getAttribute("class");
    const cursor = await page.evaluate(() => localStorage.getItem("stock-puzzle-video-cursor-v1"));
    console.log(`[record] ${Math.round((Date.now() - startedAt) / 1000)}s ${scene} ${cursor}`);
    if (await page.locator(".sp-final").count()) {
      reachedFinal = true;
      break;
    }
  }
  if (!reachedFinal) throw new Error("Final scene was not reached within 540 seconds");
  const finalSceneAt = Date.now();
  await page.waitForTimeout(32000);
  await page.screenshot({ path: path.join(project, "qa", "recording-final-frame.png") });
  const video = page.video();
  await page.close();
  if (!video) throw new Error("Playwright did not create a recording");
  await video.saveAs(output);
  await context.close();
  await browser.close();
  fs.writeFileSync(path.join(project, "qa", "recording-metadata.json"), JSON.stringify({ createdAt, startedAt, finalSceneAt, preRollSeconds: (startedAt - createdAt) / 1000, contentBeforeFinalSeconds: (finalSceneAt - startedAt) / 1000, finalHoldSeconds: 32, sourceVideo: output }, null, 2));
})();
