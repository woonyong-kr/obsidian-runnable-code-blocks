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
