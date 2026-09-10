import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodeRunner } from "../src/contracts";
import { RunnerRegistry } from "../src/runner-registry";
import { createStaticWebRunnerRegistry, enhanceRunnableCodeBlocks } from "../src/web-adapter";

function successfulRunner(language: string): CodeRunner {
  return {
    environment: "browser",
    language,
    availability: async () => ({ available: true, detail: "Browser runner ready" }),
    run: async () => ({ durationMs: 2, exitCode: 0, stderr: "", stdout: "Hello" })
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("web adapter", () => {
  it("keeps the optional personal compiler in reusable adapter configuration", async () => {
    const fetch_ = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        languages: ["java"],
        protocolVersion: 1,
        runnerVersion: "0.1.0",
        service: "personal-compiler",
        status: "online"
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        durationMs: 4,
        exitCode: 0,
        language: "java",
        provider: "Personal compiler · java",
        stderr: "",
        stdout: "42\n"
      })));
    const registry = createStaticWebRunnerRegistry({
      fetch: fetch_ as typeof fetch,
      personalCompilerEndpoint: "https://runner.example.com",
      remoteExecutionEnabled: false
    });
    const runner = registry.create("java");

    await expect(runner?.availability()).resolves.toMatchObject({ available: true });
    await expect(runner?.run("class Main {}")).resolves.toMatchObject({ stdout: "42\n" });
  });

  it("rejects an invalid personal compiler endpoint before mounting blocks", () => {
    expect(() => createStaticWebRunnerRegistry({
      fetch: window.fetch.bind(window),
      personalCompilerEndpoint: "http://runner.example.com"
    })).toThrow("HTTPS");
  });

  it("isolates invalid host configuration and recovers without sending code before Run", async () => {
    let endpoint = "http://invalid.example.com";
    const fetch_ = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => new Response(JSON.stringify(init?.method === "POST" ? {
      durationMs: 1, exitCode: 0, language: "java", provider: "Personal compiler", stderr: "", stdout: "42"
    } : { languages: ["java"], protocolVersion: 1, runnerVersion: "1", service: "personal-compiler", status: "online" })));
    const registry = createStaticWebRunnerRegistry(() => ({ fetch: fetch_, personalCompilerEndpoint: endpoint, remoteExecutionEnabled: false }));
    const browser = registry.create("javascript");
    const java = registry.create("java");
    if (!browser || !java) throw new Error("Expected configured languages");
    expect(browser.environment).toBe("browser");
    await expect(java.availability()).resolves.toMatchObject({ available: false, reason: "misconfigured" });
    expect(fetch_).not.toHaveBeenCalled();

    endpoint = "https://recovered.example.com";
    await expect(java.availability()).resolves.toMatchObject({ available: true });
    expect(fetch_.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
    await expect(java.run("class Main {}" )).resolves.toMatchObject({ stdout: "42" });
    const posts = fetch_.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[0]).toBe("https://recovered.example.com/v1/run");
    browser.dispose?.();
    java.dispose?.();
  });

  it("keeps other providers disabled after an unknown personal-compiler result", async () => {
    const fetch_ = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") throw new Error("Connection lost");
      return new Response(JSON.stringify({ languages: ["java"], protocolVersion: 1, runnerVersion: "1", service: "personal-compiler", status: "online" }));
    });
    const java = createStaticWebRunnerRegistry(() => ({ fetch: fetch_, personalCompilerEndpoint: "https://unknown.example.com", remoteExecutionEnabled: false })).create("java");
    if (!java) throw new Error("Expected Java runner");
    await expect(java.run("private source")).rejects.toMatchObject({ executionState: "unknown" });
    expect(fetch_.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(fetch_.mock.calls.every(([url]) => typeof url === "string" && url.startsWith("https://unknown.example.com/"))).toBe(true);
  });

  it("enhances only run-language fences from standard Markdown HTML", async () => {
    document.body.innerHTML = `
      <pre><code class="language-run-javascript">console.log("Hello")</code></pre>
      <pre><code class="language-javascript">console.log("static")</code></pre>
    `;
    const registry = new RunnerRegistry().register("javascript", () => successfulRunner("javascript"));

    const mounted = enhanceRunnableCodeBlocks(document, registry);
    await Promise.resolve();

    expect(mounted).toHaveLength(1);
    expect(document.querySelectorAll(".rcb")).toHaveLength(1);
    expect(document.querySelector(".language-javascript")?.textContent).toContain("static");
    expect(document.querySelector(".rcb__language")?.textContent).toBe("javascript");
  });

  it("passes the Markdown source to the mounted runner", async () => {
    document.body.innerHTML = `<pre><code class="language-run-javascript">console.log("source")</code></pre>`;
    const run = vi.fn(async () => ({ durationMs: 2, exitCode: 0, stderr: "", stdout: "Hello" }));
    const registry = new RunnerRegistry().register("javascript", () => ({
      ...successfulRunner("javascript"),
      run
    }));

    enhanceRunnableCodeBlocks(document, registry);
    const button = document.querySelector<HTMLButtonElement>(".rcb__button--run");
    await vi.waitFor(() => {
      expect(button?.disabled).toBe(false);
    });
    button?.click();
    await vi.waitFor(() => {
      expect(run).toHaveBeenCalledOnce();
    });

    expect(run).toHaveBeenCalledWith('console.log("source")', expect.objectContaining({
      signal: expect.any(AbortSignal) as AbortSignal
    }));
    expect(document.querySelector(".rcb__output")?.textContent).toBe("Hello");
  });

  it("keeps unsupported Kotlin editable while making browser capability explicit", async () => {
    document.body.innerHTML = `<pre><code class="language-run-kotlin">fun main() {}</code></pre>`;

    enhanceRunnableCodeBlocks(document, new RunnerRegistry());
    await Promise.resolve();

    expect(document.querySelector<HTMLButtonElement>(".rcb__button--run")?.disabled).toBe(true);
    expect(document.querySelector(".rcb__notice")?.textContent).toContain("no browser runner");
  });
});
