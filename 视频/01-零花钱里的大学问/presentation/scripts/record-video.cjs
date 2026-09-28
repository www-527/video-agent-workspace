const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const project = path.resolve(__dirname, "..");
  const recordDir = path.join(project, "qa", "recording");
  const output = path.join(project, "qa", "chapter01-screen.webm");
  fs.mkdirSync(recordDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: recordDir, size: { width: 1920, height: 1080 } },
  });
  await context.addInitScript(() => localStorage.clear());
  const pageCreatedAt = Date.now();
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4173/?auto=1&capture=1", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const playbackStartedAt = Date.now();
  await page.keyboard.press("Space");

  // 314.10 s of speech + eight 200 ms transition pads + a 2.5 s tail.
  await page.waitForTimeout(318200);
  await page.screenshot({ path: path.join(project, "qa", "recording-final-frame.png") });

  const video = page.video();
  await page.close();
  if (!video) throw new Error("Playwright did not create a video recording");
  await video.saveAs(output);
  await context.close();
  await browser.close();
  fs.writeFileSync(path.join(project, "qa", "recording-metadata.json"), JSON.stringify({
    pageCreatedAt,
    playbackStartedAt,
    preRollSeconds: (playbackStartedAt - pageCreatedAt) / 1000,
    expectedProgramSeconds: 315.7,
    sourceVideo: output,
  }, null, 2));
})();
