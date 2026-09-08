import { describe, expect, it, vi } from "vitest";
import { BrowserPreviewRunner } from "../src/runners/browser-preview-runner";
import { BrowserTypeScriptRunner } from "../src/runners/typescript-runner";

describe("browser adapters", () => {
  it("wraps HTML and CSS previews in a network-blocking CSP with only the height reporter allowed", async () => {
    const html = await new BrowserPreviewRunner("html").run("<h1>Hello</h1><script>window.userScript = true</script>");
    const css = await new BrowserPreviewRunner("css").run(".preview { color: red; }");
    expect(html.preview?.html).toContain("Content-Security-Policy");
    expect(html.preview?.html).toMatch(/script-src 'nonce-[^']+'/u);
    expect(html.preview?.scripts).toBe("blocked");
    expect(html.preview?.html).toContain("<h1>Hello</h1>");
    const staticDocument = new DOMParser().parseFromString(html.preview?.html ?? "", "text/html");
    const staticScripts = staticDocument.querySelectorAll("script");
    expect(staticScripts).toHaveLength(2);
    expect(staticScripts[0]?.getAttribute("nonce")).toBeNull();
    expect(staticScripts[1]?.getAttribute("nonce")).toBeTruthy();
    expect(staticScripts[1]?.textContent).toContain('type: "resize"');
    expect(css.preview?.html).toContain(".preview { color: red; }");
    expect(css.preview?.html).toContain("Style a real component");
    const documentWithHead = await new BrowserPreviewRunner("html").run("<html><head><title>x</title></head><body>x</body></html>");
    expect(documentWithHead.preview?.html).toContain("<head><meta http-equiv=");
  });

  it("keeps user JavaScript in Worker data, never in executable frame scripts", async () => {
    const result = await new BrowserPreviewRunner("web").run('<button id="run">Run</button><script>console.log("worker-only-marker")</script>');
    const frame = new DOMParser().parseFromString(result.preview?.html ?? "", "text/html");
    const payload = JSON.parse(frame.querySelector("#rcb-preview-data")?.textContent ?? "{}") as { source: string; html: string };
    expect(payload.source).toContain('console.log("worker-only-marker")');
    expect(payload.html).toContain('<button id="run">Run</button>');
    const executable = [...frame.querySelectorAll('script:not([type="application/json"])')];
    expect(executable).toHaveLength(1);
    expect(executable[0]?.textContent.includes("worker-only-marker")).toBe(false);
    const policy = frame.head.firstElementChild?.getAttribute("content");
    expect(policy).toMatch(/script-src 'nonce-[^']+'/u);
    expect(policy).not.toContain("'unsafe-inline'; style");
    expect(policy).toContain("connect-src 'none'");
    expect(result.preview?.scripts).toBe("isolated");
  });

  it("places the policy before deceptive markup and keeps escaped script endings inert", async () => {
    const result = await new BrowserPreviewRunner("web").run('<!-- <head> --><script>const x = "worker-only-marker";</script><img onerror="while(true){}">');
    const frame = new DOMParser().parseFromString(result.preview?.html ?? "", "text/html");
    expect(frame.head.firstElementChild?.getAttribute("http-equiv")).toBe("Content-Security-Policy");
    expect(frame.querySelectorAll('script[nonce]')).toHaveLength(1);
    expect(frame.querySelectorAll('[onerror]')).toHaveLength(0);
    expect(frame.querySelector('script[nonce]')?.textContent.includes("worker-only-marker")).toBe(false);
  });

  it("transpiles TypeScript before passing code to the Worker", async () => {
    const result = await new BrowserPreviewRunner("web-ts").run('<script type="text/typescript">const button = document.querySelector<HTMLButtonElement>("#run")!; button.textContent = "Ready";</script>');
    const frame = new DOMParser().parseFromString(result.preview?.html ?? "", "text/html");
    const payload = JSON.parse(frame.querySelector("#rcb-preview-data")?.textContent ?? "{}") as { source: string };
    expect(payload.source).not.toContain("querySelector<HTMLButtonElement>");
    expect(payload.source).toContain('button.textContent = "Ready"');
    expect(result.exitCode).toBe(0);
  });

  it("compiles a React JSX and TypeScript component into the shared isolated preview", async () => {
    const result = await new BrowserPreviewRunner("react").run(`
      import { useState } from "react";
      export default function Counter() {
        const [count, setCount] = useState<number>(0);
        return <button onClick={() => setCount(count + 1)}>Clicked {count} times</button>;
      }
    `);

    expect(result.exitCode).toBe(0);
    expect(result.provider).toMatch(/React \d+\.\d+\.\d+/u);
    expect(result.preview?.scripts).toBe("isolated");
    expect(result.preview?.html).toContain("connect-src 'none'");
    expect(result.preview?.html).toContain('__RCB_REACT_RUNTIME__');
    expect(result.preview?.html).toContain("ReactDOMClient.createRoot");
    expect(result.preview?.html).toContain("React.createElement");
    expect(result.preview?.html).not.toContain("useState<number>");
  });

  it("reports React JSX and TypeScript compilation errors before opening a preview", async () => {
    const result = await new BrowserPreviewRunner("react").run(
      "export default function Broken() { return <button>"
    );

    expect(result.exitCode).toBe(1);
    expect(result.provider).toMatch(/React \d+\.\d+\.\d+/u);
    expect(result.preview).toBeUndefined();
    expect(result.stderr).not.toBe("");
  });

  it("reports invalid or missing TypeScript script blocks without opening a preview", async () => {
    const invalid = await new BrowserPreviewRunner("web-ts").run(
      '<script type="text/typescript">const value: = 4;</script>'
    );
    const missing = await new BrowserPreviewRunner("web-ts").run("<button>Run</button>");

    expect(invalid.exitCode).toBe(1);
    expect(invalid.preview).toBeUndefined();
    expect(invalid.stderr).not.toBe("");
    expect(missing.exitCode).toBe(1);
    expect(missing.preview).toBeUndefined();
    expect(missing.stderr).toContain("requires at least one");
  });

  it("reports preview DOM availability", async () => {
    const original = globalThis.document;
    vi.stubGlobal("document", undefined);
    await expect(new BrowserPreviewRunner("html").availability()).resolves.toMatchObject({ available: false });
    vi.stubGlobal("document", original);
    await expect(new BrowserPreviewRunner("html").availability()).resolves.toMatchObject({ available: true });
  });

  it("transpiles TypeScript before delegating to the isolated worker", async () => {
    const run = vi.fn(async () => ({ durationMs: 1, exitCode: 0, stderr: "", stdout: "4" }));
    const javascript = {
      availability: async () => ({ available: true, detail: "ready" }),
      run
    };
    const runner = new BrowserTypeScriptRunner(javascript);
    await expect(runner.availability()).resolves.toMatchObject({ available: true });
    await expect(runner.run("const value: number = 4; console.log(value);")).resolves.toMatchObject({
      exitCode: 0,
      provider: expect.stringContaining("Sucrase")
    });
    expect(run).toHaveBeenCalledWith(expect.not.stringContaining(": number"), undefined);
  });

  it("returns TypeScript transform errors without starting JavaScript", async () => {
    const run = vi.fn();
    const javascript = {
      availability: async () => ({ available: true, detail: "ready" }),
      run
    };
    const result = await new BrowserTypeScriptRunner(javascript).run("const value: = 4;");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toBe("");
    expect(run).not.toHaveBeenCalled();
  });
});
