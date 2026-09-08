import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const frameDirectory = join(pluginRoot, "demo/captures/frames");
mkdirSync(frameDirectory, { recursive: true });

execFileSync("npm", ["run", "build"], { cwd: pluginRoot, stdio: "inherit" });
const server = spawn(process.execPath, ["scripts/serve-demo.mjs"], {
  cwd: pluginRoot,
  env: { ...process.env, PORT: "0" },
  stdio: ["ignore", "pipe", "inherit"]
});

let browser;
try {
  const url = await serverUrl(server);
  browser = await chromium.launch();
  const page = await browser.newPage({ colorScheme: "dark", viewport: { height: 900, width: 1600 } });
  await page.goto(url);
  const featured = page.locator("[data-featured-test-case]");
  await featured.locator(".rcb").evaluate((element) => {
    window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 180);
  });
  await page.screenshot({ path: join(frameDirectory, "01-ready.png") });

  await featured.locator(".cm-content").fill(`import { useState } from "react";

export default function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>Clicked {count} times</button>;
}`);
  await page.screenshot({ path: join(frameDirectory, "02-edited.png") });

  await featured.getByRole("button", { name: "Run code" }).click();
  await page.screenshot({ path: join(frameDirectory, "03-running.png") });
  await featured.locator(".rcb__console-meta").filter({ hasText: /Preview ready/u }).waitFor();
  const counter = featured.locator(".rcb__preview-frame").contentFrame()
    .locator("#preview").contentFrame().getByRole("button");
  await counter.click();
  await counter.filter({ hasText: "Clicked 1 times" }).waitFor();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await featured.getByRole("button", { name: "Copy code" }).click();
  await featured.getByRole("button", { name: "Copied", exact: true }).waitFor();
  await page.screenshot({ path: join(frameDirectory, "04-output.png") });

  await page.getByText("Run every language example").click();
  const webLesson = page.locator(".rcb-site__lesson", {
    has: page.getByRole("heading", { exact: true, name: /Web \(HTML\/CSS\/JS\)/u })
  });
  await webLesson.getByRole("button", { name: "Run code" }).click();
  await webLesson.locator(".rcb__console-meta").filter({ hasText: /Preview ready/u }).waitFor();
  await webLesson.evaluate((element) => {
    window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 72);
  });
  await page.screenshot({ path: join(frameDirectory, "05-web.png") });

  copyFileSync(join(frameDirectory, "04-output.png"), join(pluginRoot, "docs/assets/runnable-code-blocks-preview.png"));
  copyFileSync(join(frameDirectory, "05-web.png"), join(pluginRoot, "docs/assets/runnable-web-preview.png"));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}

execFileSync("npm", ["run", "demo:build"], { cwd: pluginRoot, stdio: "inherit" });
copyFileSync(
  join(pluginRoot, "demo/dist/runnable-code-blocks-demo.gif"),
  join(pluginRoot, "docs/assets/runnable-code-blocks-demo.gif")
);

// Record provenance only after every capture and GIF assembly succeeds.
const mediaPath = join(pluginRoot, "docs/release-media.json");
const media = JSON.parse(readFileSync(mediaPath, "utf8"));
media.capturedAt = new Date().toISOString().slice(0, 10);
for (const asset of media.assets) {
  asset.sha256 = createHash("sha256").update(readFileSync(join(pluginRoot, asset.path))).digest("hex");
}
writeFileSync(mediaPath, `${JSON.stringify(media, null, 2)}\n`);

function serverUrl(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => finish(new Error("Demo server did not start")), 5000);
    const exited = () => finish(new Error("Demo server exited before becoming ready"));
    const data = (chunk) => {
      output += chunk.toString();
      if (!output.includes("\n")) return;
      try { finish(null, JSON.parse(output.split("\n")[0]).url); }
      catch (error) { finish(error); }
    };
    function finish(error, url) {
      clearTimeout(timer);
      child.off("error", exited);
      child.off("exit", exited);
      child.stdout.off("data", data);
      if (error) reject(error); else resolve(url);
    }
    child.once("error", exited);
    child.once("exit", exited);
    child.stdout.on("data", data);
  });
}
