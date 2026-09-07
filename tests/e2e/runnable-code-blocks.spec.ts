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
  await expect(lesson.locator(".rcb__console-meta")).toContainText("Preview ready");

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
  await expect(lesson.locator(".rcb__console-meta")).toContainText("Woon personal compiler · java");
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
  await expect.poll(() => failedRequests.length).toBe(1);

  expect(attemptedRequests).toHaveLength(1);
  expect(failedRequests).toHaveLength(1);
  expect(failedRequests[0]).toMatch(/csp/iu);
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
  await expect(lesson.locator(".rcb__console-meta")).toContainText("Web Worker");
  const output = await lesson.locator(".rcb__output").textContent();

  expect(output?.split(OUTPUT_LIMITS.marker)).toHaveLength(2);
});
