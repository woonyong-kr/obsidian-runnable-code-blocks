import { expect, test } from "@playwright/test";
import { OUTPUT_LIMITS } from "../../src/output-buffer";

test("edits, resets, runs, and interacts with the React example", async ({ page }) => {
  await page.goto("/");
  const lesson = page.locator("[data-featured-test-case]");
  const editor = lesson.locator(".cm-content");
  await expect(editor).toContainText("useState");

  await editor.fill('export default function App() { return <button>Changed</button>; }');
  await expect(lesson.getByRole("button", { name: "Reset" })).toBeVisible();
  await lesson.getByRole("button", { name: "Reset" }).click();
  await expect(editor).toContainText("useState");

  await lesson.getByRole("button", { name: "Run code" }).click();
  await expect(lesson.locator(".rcb__console-meta")).toContainText("Preview ready");
  const container = lesson.locator(".rcb__preview-frame").contentFrame();
  const preview = container.locator("#preview").contentFrame();
  const counter = preview.getByRole("button");
  await expect(counter).toBeVisible();
  await counter.click();
  await expect(counter).toHaveText("Clicked 1 times");
});

test("runs the bundled react-dom createPortal API", async ({ page }) => {
  await page.goto("/");
  const lesson = page.locator("[data-featured-test-case]");
  await lesson.locator(".cm-content").fill(`import { createPortal } from "react-dom";

export default function PortalExample() {
  return createPortal(<aside>Portal works</aside>, document.body);
}`);

  await lesson.getByRole("button", { name: "Run code" }).click();
  await expect(lesson.locator(".rcb__console-meta")).toContainText("Preview ready");
  const preview = lesson.locator(".rcb__preview-frame").contentFrame().locator("#preview").contentFrame();
  await expect(preview.getByText("Portal works")).toBeVisible();
});

test("inherits host theme tokens and shows a keyboard focus ring", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const lesson = page.locator("[data-featured-test-case]");
  const block = lesson.locator(".rcb");
  await expect(block).toBeVisible();
  const colors = await block.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, text: style.color };
  });
  expect(colors.background).toBe("rgb(43, 45, 48)");
  expect(colors.text).toBe("rgb(223, 225, 229)");

  const blockIdentity = await block.evaluate((element) => {
    element.setAttribute("data-theme-test", "mounted-once");
    return element.getAttribute("data-theme-test");
  });
  expect(blockIdentity).toBe("mounted-once");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(block).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(block).toHaveAttribute("data-theme-test", "mounted-once");

  const keyword = lesson.locator(".cm-content span").filter({ hasText: /^import$/u }).first();
  await expect(keyword).toBeVisible();
  await page.addStyleTag({
    content: "body.rcb-site.rcb-theme-token-test { --code-keyword: rgb(1, 2, 3); }"
  });
  await page.locator("body").evaluate((element) => element.classList.add("rcb-theme-token-test"));
  await expect(keyword).toHaveCSS("color", "rgb(1, 2, 3)");
  await expect(block).toHaveAttribute("data-theme-test", "mounted-once");

  await lesson.locator(".cm-content").focus();
  await expect(lesson.locator(".rcb__editor")).not.toHaveCSS("box-shadow", "none");
});

test("allows 102 numbered lines before the editor itself scrolls", async ({ page }) => {
  await page.goto("/");
  const editor = page.locator("[data-featured-test-case] .cm-content");
  const scroller = page.locator("[data-featured-test-case] .cm-scroller");
  await editor.fill(Array.from({ length: 102 }, (_, index) => `// ${String(index + 1)}`).join("\n"));
  await expect(page.locator("[data-featured-test-case] .cm-lineNumbers .cm-gutterElement:not(:first-child)")).toHaveCount(102);
  const atLimit = await scroller.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }));
  expect(atLimit.scrollHeight).toBeLessThanOrEqual(atLimit.clientHeight + 1);

  await editor.fill(Array.from({ length: 103 }, (_, index) => `// ${String(index + 1)}`).join("\n"));
  const overLimit = await scroller.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }));
  expect(overLimit.scrollHeight).toBeGreaterThan(overLimit.clientHeight);
});

test("keeps an interactive preview navigation inside its sandbox", async ({ page }) => {
  const escapedRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("preview-navigation-should-not-load")) {
      escapedRequests.push(request.url());
    }
  });
  await page.goto("/");
  await page.getByText("Run every language example").click();
  const lesson = page.locator(".rcb-site__lesson", {
    has: page.getByRole("heading", { exact: true, name: /Web \(HTML\/CSS\/JS\)/u })
  });
  await lesson.locator(".cm-content").fill(`<!doctype html><script>
location.href = "/preview-navigation-should-not-load";
</script>`);
  await lesson.getByRole("button", { name: "Run code" }).click();
  await expect(lesson.locator(".rcb")).toHaveAttribute("data-state", "error");
  await expect(lesson.getByRole("button", {name: "Run code"})).toBeEnabled();

  expect(escapedRequests).toEqual([]);
});

test("uses the configured personal compiler before Wandbox for Java", async ({ page }) => {
  const wandboxRequests: string[] = [];
  await page.route("https://runner.woonyong.com/v1/capabilities", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        languages: ["java"],
        protocolVersion: 1,
        runnerVersion: "0.1.0",
        service: "personal-compiler",
        status: "online"
      }
    });
  });
  await page.route("https://runner.woonyong.com/v1/run", async (route) => {
    const payload = route.request().postDataJSON() as { language?: string };
    expect(payload.language).toBe("java");
    expect(route.request().headers()["x-runnable-request-id"]).toMatch(/^[0-9a-f-]{36}$/iu);
    await route.fulfill({
      contentType: "application/json",
      json: {
        durationMs: 18,
        exitCode: 0,
        language: "java",
        provider: "Woon personal compiler · java",
        stderr: "",
        stdout: "personal-java-ok\n"
      }
    });
  });
  await page.route("https://wandbox.org/**", async (route) => {
    if (route.request().url().endsWith("/compile.json")) {
      wandboxRequests.push(route.request().url());
    }
    await route.abort();
  });

  await page.goto("/");
  await page.getByText("Run every language example").click();
  const lesson = page.locator(".rcb-site__lesson", {
    has: page.getByRole("heading", { exact: true, name: /Java ·/u })
  });
  const runButton = lesson.getByRole("button", { name: "Run code" });
  await expect(runButton).toBeEnabled();
  await runButton.click();

  await expect(lesson.locator(".rcb__output")).toContainText("personal-java-ok");
  await lesson.getByText("Execution details", { exact: true }).click();
  await expect(lesson.locator(".rcb__diagnostic-text")).toContainText("Woon personal compiler · java");
  expect(wandboxRequests).toEqual([]);
});

test("blocks ReactDOM script resources inside the opaque preview", async ({ page }) => {
  const attemptedRequests: string[] = [];
  const failedRequests: string[] = [];
  const responses: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("react-script-must-not-load")) {
      attemptedRequests.push(request.url());
    }
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("react-script-must-not-load")) {
      failedRequests.push(request.failure()?.errorText ?? "unknown");
    }
  });
  page.on("response", (response) => {
    if (response.url().includes("react-script-must-not-load")) {
      responses.push(response.url());
    }
  });
  await page.goto("/");
  const lesson = page.locator("[data-featured-test-case]");
  await lesson.locator(".cm-content").fill(`import { preinit } from "react-dom";

preinit("/react-script-must-not-load.js", { as: "script" });

export default function App() {
  return <p>Sandbox remains ready</p>;
}`);

  await lesson.getByRole("button", { name: "Run code" }).click();
  await expect(lesson.locator(".rcb__console-meta")).toContainText("Preview ready");
  const outer = lesson.locator(".rcb__preview-frame");
  await expect(outer).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(outer).not.toHaveAttribute("sandbox", /allow-same-origin/u);
  const previewFrame = outer.contentFrame().locator("#preview");
  await expect(previewFrame).toHaveAttribute("referrerpolicy", "no-referrer");
  await expect(previewFrame).not.toHaveAttribute("sandbox", /allow-same-origin/u);
  await expect(previewFrame.contentFrame().getByText("Sandbox remains ready")).toBeVisible();
  await expect(previewFrame.contentFrame().locator('script[src]')).toHaveCount(0);

  expect(attemptedRequests).toHaveLength(0);
  expect(failedRequests).toHaveLength(0);
  expect(responses).toEqual([]);
  expect(page.url()).not.toContain("react-script-must-not-load");
});

test("bounds direct preview message relays with one truncation marker", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Run every language example").click();
  const lesson = page.locator(".rcb-site__lesson", {
    has: page.getByRole("heading", { exact: true, name: /Web \(HTML\/CSS\/JS\)/u })
  });
  await lesson.locator(".cm-content").fill(`<!doctype html><script>
for (let index = 0; index < 250; index += 1) {
  parent.postMessage({
    sender: "runnable-code-blocks-preview",
    type: "log",
    message: "direct relay " + index
  }, "*");
}
</script>`);

  await lesson.getByRole("button", { name: "Run code" }).click();
  await expect(lesson.locator(".rcb__output")).toContainText(OUTPUT_LIMITS.marker);
  const output = await lesson.locator(".rcb__output").textContent();

  expect(output?.split(OUTPUT_LIMITS.marker)).toHaveLength(2);
  expect(output).not.toContain("direct relay 249");
});

test("bounds real Web Worker output with one truncation marker", async ({ page }) => {
  await page.route("https://wandbox.org/**", async (route) => await route.abort());
  await page.goto("/");
  await page.getByText("Run every language example").click();
  const lesson = page.locator(".rcb-site__lesson", {
    has: page.getByRole("heading", { exact: true, name: /JavaScript ·/u })
  });
  await lesson.locator(".cm-content").fill(
    "for (let index = 0; index < 250; index += 1) console.log(index);"
  );
  await lesson.getByRole("button", { name: "Run code" }).click();
  await expect(lesson.locator(".rcb__console-meta")).toContainText("Success");
  await lesson.getByText("Execution details", { exact: true }).click();
  await expect(lesson.locator(".rcb__diagnostic-text")).toContainText("Web Worker");
  const output = await lesson.locator(".rcb__output").textContent();

  expect(output?.split(OUTPUT_LIMITS.marker)).toHaveLength(2);
});

for (const width of [360, 1280]) {
  test(`keeps controls accessible and copies edits at ${String(width)}px`, async ({ page, context }) => {
    await page.setViewportSize({width, height: 800});
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    const lesson = page.locator("[data-featured-test-case]");
    await lesson.locator(".cm-content").fill("console.log(42)");
    const controls = await lesson.locator(".rcb__toolbar button:visible").evaluateAll(buttons => buttons.map(button => {
      const bounds = button.getBoundingClientRect();
      const parent = button.closest(".rcb__toolbar");
      if (!parent) throw new Error("Control is outside its toolbar");
      const toolbar = parent.getBoundingClientRect();
      return {
        label: button.getAttribute("aria-label"),
        icon: Boolean(button.querySelector("svg")),
        text: button.textContent.trim(),
        above: bounds.top - toolbar.top,
        below: toolbar.bottom - bounds.bottom
      };
    }));
    expect(controls.length).toBeGreaterThanOrEqual(3);
    for (const control of controls) {
      expect(control.label).toBeTruthy();
      expect(control.icon).toBe(true);
      expect(control.text).toBe("");
      expect(control.above).toBeGreaterThanOrEqual(8);
      expect(control.below).toBeGreaterThanOrEqual(8);
    }
    await lesson.getByRole("button", {name: "Copy code", exact: true}).click();
    await expect(lesson.getByRole("button", {name: "Copied", exact: true})).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("console.log(42)");
    await expect(lesson.locator(".rcb__editing-hint")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}


test("terminates a runaway preview Worker and allows a clean restart", async ({ page }) => {
  test.setTimeout(15_000);
  await page.goto("/");
  const lesson = page.locator("[data-featured-test-case]");
  await lesson.locator(".cm-content").fill(`export default function App() {
    return <button onClick={() => { while (true) {} }}>Hang worker</button>;
  }`);
  const created = page.waitForEvent("worker");
  await lesson.getByRole("button", { name: "Run code" }).click();
  const worker = await created;
  const closed = worker.waitForEvent("close", {timeout: 5_000});
  await expect(lesson.locator(".rcb__console-meta")).toContainText("Preview ready");
  const result = lesson.locator(".rcb__preview-frame").contentFrame().locator("#preview").contentFrame();
  await result.getByRole("button", { name: "Hang worker" }).click({ noWaitAfter: true, timeout: 2_000 });
  await lesson.getByRole("button", { name: "Stop", exact: true }).click({ timeout: 2_000 });
  await expect(lesson.locator(".rcb")).toHaveAttribute("data-state", "cancelled");
  await closed;
  await lesson.locator(".cm-content").fill('export default function App() { return <p>Restarted after termination</p>; }');
  await lesson.getByRole("button", { name: "Run code" }).click();
  await expect(result.getByText("Restarted after termination")).toBeVisible();
});

for (const [name, code] of [
  ["synchronous loop", "while (true) {}"],
  ["microtask starvation", "Promise.resolve().then(function spin() { Promise.resolve().then(spin); });"],
  ["native regular expression", 'while (true) /^(a+)+$/.test("a".repeat(35) + "!");']
] as const) {
  test(`automatically terminates a preview Worker after ${name}`, async ({ page }) => {
    await page.goto("/");
    const lesson = page.locator("[data-featured-test-case]");
    await lesson.locator(".cm-content").fill(`export default function App() { ${code} return <p>Busy</p>; }`);
    const created = page.waitForEvent("worker");
    // Chromium reports Worker closure about four seconds after creation. Subscribe
    // immediately and allow transport/teardown latency independently of the UI watchdog.
    const closed = created.then((worker) => worker.waitForEvent("close", { timeout: 6_000 }));
    await lesson.getByRole("button", { name: "Run code" }).click();
    await expect(lesson.locator(".rcb__output")).toContainText("did not respond within 2 seconds", { timeout: 4_000 });
    await closed;
    await expect(lesson.getByRole("button", { name: "Run code" })).toBeEnabled();
    await lesson.locator(".cm-content").fill('export default function App() { return <p>Recovered</p>; }');
    await lesson.getByRole("button", { name: "Run code" }).click();
    await expect(lesson.locator(".rcb__preview-frame").contentFrame().locator("#preview").contentFrame().getByText("Recovered")).toBeVisible();
  });
}

test("preserves inline HTML handlers and their element receiver in the Worker", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Run every language example").click();
  const lesson = page.locator('.rcb[data-language="web"]');
  await lesson.locator(".cm-content").fill(`<button onclick="this.textContent='Clicked'" onmousedown="this.setAttribute('data-pressed','yes')">Ready</button>`);
  await lesson.getByRole("button", { name: "Run code" }).click();
  await expect(lesson.locator(".rcb__console-meta")).toContainText("Preview ready");
  const result = lesson.locator(".rcb__preview-frame").contentFrame().locator("#preview").contentFrame();
  await result.getByRole("button", { name: "Ready" }).click();
  await expect(result.getByRole("button", { name: "Clicked" })).toHaveAttribute("data-pressed", "yes");
});

test("bridges web TypeScript events once and prevents Worker DOM scripts from executing on the frame", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Run every language example").click();
  const lesson = page.locator('.rcb[data-language="web-ts"]');
  await lesson.locator(".cm-content").fill(`<button id="run">Ready</button><script type="text/typescript">
    let count: number = 0;
    document.querySelector<HTMLButtonElement>("#run")!.addEventListener("click", () => {
      document.querySelector("#run")!.textContent = "Count " + ++count;
      const script = document.createElement("script");
      script.textContent = "while(true){}";
      document.body.appendChild(script);
    });
  </script>`);
  await lesson.getByRole("button", { name: "Run code" }).click();
  const result = lesson.locator(".rcb__preview-frame").contentFrame().locator("#preview").contentFrame();
  await result.getByRole("button", { name: "Ready" }).click();
  await expect(result.getByRole("button", { name: "Count 1" })).toBeVisible();
  await lesson.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(lesson.getByRole("button", { name: "Run code" })).toBeEnabled();
});
