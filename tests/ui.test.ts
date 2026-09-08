import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodeRunner, RunContext, RunResult } from "../src/contracts";
import { mountRunnableBlock } from "../src/ui";

function createRunner(overrides: Partial<CodeRunner> = {}): CodeRunner {
  return {
    environment: "browser",
    language: "javascript",
    availability: async () => ({ available: true, detail: "ready" }),
    run: async () => ({ durationMs: 1.5, exitCode: 0, stderr: "", stdout: "ok\n" }),
    ...overrides
  };
}

async function markPreviewReady(host: HTMLElement): Promise<void> {
  const frame = host.querySelector<HTMLIFrameElement>(".rcb__preview-frame");
  const tokenSource = frame?.srcdoc.match(/const token = ("[^"]+");/u)?.[1];
  expect(frame).not.toBeNull();
  expect(tokenSource).toBeTruthy();
  window.dispatchEvent(new MessageEvent("message", {
    data: {
      sender: "runnable-code-blocks-container",
      token: JSON.parse(tokenSource ?? "null") as string,
      type: "preview-ready"
    },
    origin: "null",
    source: frame?.contentWindow
  }));
  await vi.waitFor(() => expect(host.querySelector(".rcb__console-meta")?.textContent).toContain("Preview ready"));
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("runnable block UI", () => {
  it("rechecks an offline runner without losing edited source", async () => {
    let online = false;
    const host = document.body.appendChild(document.createElement("div"));
    mountRunnableBlock(host, { code: "source", language: "java", runner: createRunner({ availability: async () => ({ available: online, detail: "offline" }) }) });
    await vi.waitFor(() => expect(host.querySelector('.rcb')?.getAttribute('data-state')).toBe('unavailable'));
    const editor = host.querySelector('.cm-editor');
    online = true;
    const retry = host.querySelector<HTMLButtonElement>('.rcb__button--retry');
    expect(retry?.hidden).toBe(false);
    retry?.click();
    await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>('.rcb__button--run')?.disabled).toBe(false));
    expect(host.querySelector('.cm-editor')).toBe(editor);
  });

  it("cancels a pending run and ignores a late successful result", async () => {
    let finish!: (result: RunResult) => void;
    const result = new Promise<RunResult>(resolve => { finish = resolve; });
    const run = vi.fn(() => result);
    const host = document.body.appendChild(document.createElement("div"));
    mountRunnableBlock(host, { code: "source", language: "javascript", runner: createRunner({ run }) });
    await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>('.rcb__button--run')?.disabled).toBe(false));
    host.querySelector<HTMLButtonElement>('.rcb__button--run')?.click();
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    const stop = host.querySelector<HTMLButtonElement>('.rcb__button--run');
    expect(stop?.hidden).toBe(false);
    stop?.click();
    expect(host.querySelector('.rcb')?.getAttribute('data-state')).toBe('cancelled');
    finish({ durationMs: 1, exitCode: 0, stdout: 'stale', stderr: '' });
    await result;
    expect(host.querySelector('.rcb')?.getAttribute('data-state')).toBe('cancelled');
    expect(host.querySelector<HTMLButtonElement>('.rcb__button--run')?.disabled).toBe(false);
    expect(host.querySelector('.rcb__output')?.textContent).not.toContain('stale');
  });
  it.each([
    ["cancelled", "Server execution cancelled; container removed."],
    ["completed", "The server execution had already completed."],
    ["unknown", "Server cancellation could not be confirmed"]
  ] as const)("reports %s only from the current cancellation acknowledgement", async (state, message) => {
    const contexts: RunContext[] = [];
    const runner = createRunner({ environment: "remote", run: async (_code, context) => {
      contexts.push(context ?? {});
      return await new Promise<RunResult>((_resolve, reject) => context?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    } });
    const host = document.body.appendChild(document.createElement("div"));
    const mounted = mountRunnableBlock(host, { code: "source", language: "java", runner });
    const run = host.querySelector<HTMLButtonElement>(".rcb__button--run");
    await vi.waitFor(() => expect(run?.disabled).toBe(false));
    run?.click();
    await vi.waitFor(() => expect(contexts).toHaveLength(1));
    host.querySelector<HTMLButtonElement>(".rcb__button--run")?.click();
    expect(host.querySelector(".rcb__output")?.textContent).not.toContain("Server execution cancelled");
    contexts[0]?.onCancellation?.("pending");
    expect(host.querySelector(".rcb__console-meta")?.textContent).toBe("Cancelling");
    contexts[0]?.onCancellation?.(state);
    expect(host.querySelector(".rcb__output")?.textContent).toContain(message);
    run?.click();
    await vi.waitFor(() => expect(contexts).toHaveLength(2));
    contexts[0]?.onCancellation?.("cancelled");
    expect(host.querySelector(".rcb")?.getAttribute("data-state")).toBe("running");
    expect(host.querySelector(".rcb__output")?.textContent).toBe("Waiting for result…");
    mounted.dispose();
  });

  it("renders numbered trailing lines and disposes the mounted block", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    const mounted = mountRunnableBlock(host, {
      code: "console.log('source')",
      language: "javascript",
      runner: createRunner()
    });
    await Promise.resolve();
    const content = host.querySelector<HTMLElement>(".cm-content");
    expect(content?.hasAttribute("aria-label")).toBe(false);
    const labelledBy = content?.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy ?? "")?.textContent).toBe(
      "javascript runnable code editor"
    );
    expect(host.querySelectorAll(".cm-line")).toHaveLength(3);
    expect(
      Array.from(host.querySelectorAll(".cm-lineNumbers .cm-gutterElement"), (line) => line.textContent)
        .filter(Boolean)
        .slice(-3)
    ).toEqual(["1", "2", "3"]);
    expect(host.querySelector(".rcb__status")?.textContent).toBe("Ready to run");
    expect(host.querySelector<HTMLElement>(".rcb__console")?.hidden).toBe(true);
    expect(host.querySelector<HTMLButtonElement>(".rcb__button--reset")?.hidden).toBe(true);
    mounted.dispose();
    expect(host.querySelector(".rcb")).toBeNull();
  });

  it("renders both Run icons without treating multiple classes as one token", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    mountRunnableBlock(host, {
      code: "console.log('source')",
      language: "javascript",
      runner: createRunner()
    });
    await Promise.resolve();

    expect(host.querySelector(".rcb__button-icon--run")).not.toBeNull();
    expect(host.querySelector(".rcb__button-icon--running")).not.toBeNull();
    expect(host.querySelector(".cm-editor")).not.toBeNull();
  });

  it("shows runner exceptions as console errors", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    mountRunnableBlock(host, {
      code: "throw new Error()",
      language: "javascript",
      runner: createRunner({ run: async () => { throw new Error("sandbox failed"); } })
    });
    await Promise.resolve();
    host.querySelector<HTMLButtonElement>(".rcb__button--run")?.click();
    await vi.waitFor(() => expect(host.querySelector(".rcb")?.getAttribute("data-state")).toBe("error"));

    expect(host.querySelector(".rcb")?.getAttribute("data-state")).toBe("error");
    expect(host.querySelector(".rcb__output")?.textContent).toBe("sandbox failed");
  });

  it("shows a stable animated running action and waiting output", async () => {
    let finish: ((result: RunResult) => void) | undefined;
    const result = new Promise<RunResult>((resolve) => {
      finish = resolve;
    });
    const host = document.body.appendChild(document.createElement("div"));
    mountRunnableBlock(host, {
      code: "console.log('later')",
      language: "javascript",
      runner: createRunner({ run: async () => await result })
    });
    await Promise.resolve();

    const button = host.querySelector<HTMLButtonElement>(".rcb__button--run");
    button?.click();
    await vi.waitFor(() => expect(host.querySelector(".rcb__output")?.textContent).toBe("Waiting for result…"));

    expect(button?.getAttribute("aria-busy")).toBe("true");
    expect(button?.textContent).toBe("");
    expect(button?.getAttribute("aria-label")).toBe("Stop");
    expect(button?.disabled).toBe(false);
    expect(host.querySelectorAll(".rcb__button--run")).toHaveLength(1);
    expect(host.querySelector<SVGElement>(".rcb__button-icon--running")?.hasAttribute("hidden")).toBe(false);
    expect(host.querySelector(".rcb__console-meta")?.textContent).toBe("Running…");
    expect(host.querySelector(".rcb__output")?.textContent).toBe("Waiting for result…");

    finish?.({ durationMs: 12, exitCode: 0, provider: "Test runner", stderr: "", stdout: "done" });
    await vi.waitFor(() => expect(host.querySelector(".rcb")?.getAttribute("data-state")).toBe("success"));

    expect(button?.getAttribute("aria-busy")).toBe("false");
    expect(button?.textContent).toBe("");
    expect(button?.getAttribute("aria-label")).toBe("Run code");
    expect(host.querySelector(".rcb__console-meta")?.textContent).toBe("Success");
    expect(host.querySelector(".rcb__diagnostic-text")?.textContent).toContain("Test runner");
    expect(host.querySelector<HTMLDetailsElement>(".rcb__details")?.open).toBe(false);
  });

  it("clears previous result metadata before showing a later runner error", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    const runner = createRunner({
      run: vi
        .fn()
        .mockResolvedValueOnce({
          durationMs: 2,
          exitCode: 0,
          provider: "First provider",
          stderr: "",
          stdout: "ok"
        })
        .mockRejectedValueOnce(new Error("second run failed"))
    });
    mountRunnableBlock(host, { code: "code", language: "javascript", runner });
    await Promise.resolve();
    const button = host.querySelector<HTMLButtonElement>(".rcb__button--run");
    button?.click();
    await vi.waitFor(() => expect(host.querySelector(".rcb__console-meta")?.textContent).toBe("Success"));
    expect(host.querySelector(".rcb__console-meta")?.textContent).toBe("Success");

    button?.click();
    await vi.waitFor(() => expect(host.querySelector(".rcb__console-meta")?.textContent).toBe("Runner error"));
    expect(host.querySelector(".rcb__console-meta")?.textContent).toBe("Runner error");
    expect(host.querySelector(".rcb__output")?.textContent).toBe("second run failed");
  });

  it("disables execution when the runner is unavailable", async () => {
    const run = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    mountRunnableBlock(host, {
      code: "fun main() {}",
      language: "kotlin",
      runner: createRunner({
        language: "kotlin",
        availability: async () => ({ available: false, detail: "kotlinc missing" }),
        run
      })
    });
    await Promise.resolve();

    const button = host.querySelector<HTMLButtonElement>(".rcb__button--run");
    expect(button?.disabled).toBe(true);
    button?.click();
    expect(run).not.toHaveBeenCalled();
    expect(host.querySelector(".rcb__notice")?.textContent).toBe("kotlinc missing");
    expect(host.querySelector<HTMLElement>(".rcb__notice")?.hidden).toBe(false);
  });

  it("turns availability exceptions into a stable unavailable state", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    mountRunnableBlock(host, {
      code: "print('hello')",
      language: "python",
      runner: createRunner({
        availability: async () => { throw new Error("provider preflight crashed"); }
      })
    });
    await vi.waitFor(() => expect(host.querySelector(".rcb")?.getAttribute("data-state")).toBe("unavailable"));

    expect(host.querySelector(".rcb")?.getAttribute("data-state")).toBe("unavailable");
    expect(host.querySelector<HTMLButtonElement>(".rcb__button--run")?.disabled).toBe(true);
    expect(host.querySelector(".rcb__notice")?.textContent).toBe("provider preflight crashed");
  });

  it("rechecks the current execution policy before every run", async () => {
    let enabled = true;
    const run = vi.fn();
    const availability = vi.fn(async () => enabled
      ? { available: true, detail: "Remote provider ready" }
      : { available: false, detail: "Remote execution is disabled" });
    const host = document.body.appendChild(document.createElement("div"));
    mountRunnableBlock(host, {
      code: "print('private')",
      language: "python",
      runner: createRunner({ availability, language: "python", run })
    });
    await Promise.resolve();
    enabled = false;

    host.querySelector<HTMLButtonElement>(".rcb__button--run")?.click();
    await vi.waitFor(() => expect(host.querySelector(".rcb")?.getAttribute("data-state")).toBe("unavailable"));

    expect(availability).toHaveBeenCalledTimes(2);
    expect(run).not.toHaveBeenCalled();
    expect(host.querySelector(".rcb")?.getAttribute("data-state")).toBe("unavailable");
    expect(host.querySelector(".rcb__notice")?.textContent).toBe("Remote execution is disabled");
    expect(host.querySelector<HTMLElement>(".rcb__console")?.hidden).toBe(true);
  });

  it("refreshes mounted availability without replacing the editor", async () => {
    let enabled = true;
    const host = document.body.appendChild(document.createElement("div"));
    const mounted = mountRunnableBlock(host, {
      code: "print('private')",
      language: "python",
      runner: createRunner({
        availability: async () => enabled
          ? { available: true, detail: "Wandbox ready" }
          : { available: false, detail: "Remote execution is disabled" },
        language: "python"
      })
    });
    await Promise.resolve();
    const editor = host.querySelector(".cm-editor");
    enabled = false;

    await mounted.refreshAvailability();

    expect(host.querySelector(".cm-editor")).toBe(editor);
    expect(host.querySelector(".rcb")?.getAttribute("data-state")).toBe("unavailable");
    expect(host.querySelector<HTMLButtonElement>(".rcb__button--run")?.disabled).toBe(true);
    expect(host.querySelector(".rcb__notice")?.textContent).toBe("Remote execution is disabled");
  });

  it("ignores an older availability response that finishes after a newer policy check", async () => {
    type Complete = (status: { available: boolean; detail: string }) => void;
    const completions: Complete[] = [];
    const availability = vi.fn(async () => await new Promise<{ available: boolean; detail: string }>((resolve) => {
      completions.push(resolve);
    }));
    const host = document.body.appendChild(document.createElement("div"));
    const mounted = mountRunnableBlock(host, {
      code: "print('private')",
      language: "python",
      runner: createRunner({ availability, language: "python" })
    });
    const newest = mounted.refreshAvailability();
    await vi.waitFor(() => {
      expect(completions).toHaveLength(2);
    });

    completions[1]?.({ available: false, detail: "Remote execution is disabled" });
    await newest;
    completions[0]?.({ available: true, detail: "Stale provider response" });
    await Promise.resolve();

    expect(host.querySelector(".rcb")?.getAttribute("data-state")).toBe("unavailable");
    expect(host.querySelector(".rcb__notice")?.textContent).toBe("Remote execution is disabled");
    expect(host.querySelector<HTMLButtonElement>(".rcb__button--run")?.disabled).toBe(true);
  });

  it("disposes editor and runner at most once", async () => {
    const dispose = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    const mounted = mountRunnableBlock(host, {
      code: "console.log('once')",
      language: "javascript",
      runner: createRunner({ dispose })
    });
    await Promise.resolve();

    mounted.dispose();
    mounted.dispose();

    expect(dispose).toHaveBeenCalledOnce();
  });

  it("renders stderr and empty successful output deterministically", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    const runner = createRunner({
      run: vi
        .fn()
        .mockResolvedValueOnce({ durationMs: 2, exitCode: 1, stderr: "compile error\n", stdout: "partial\n" })
        .mockResolvedValueOnce({ durationMs: 2, exitCode: 0, stderr: "", stdout: "" })
    });
    mountRunnableBlock(host, { code: "code", language: "javascript", runner });
    await Promise.resolve();
    const button = host.querySelector<HTMLButtonElement>(".rcb__button--run");
    button?.click();
    await vi.waitFor(() => expect(host.querySelector(".rcb__output")?.textContent).toBe("partial\ncompile error"));
    expect(host.querySelector(".rcb__output")?.textContent).toBe("partial\ncompile error");
    button?.click();
    await vi.waitFor(() => expect(host.querySelector(".rcb__output")?.textContent).toBe("Process finished with no output."));
    expect(host.querySelector(".rcb__output")?.textContent).toBe("Process finished with no output.");
  });

  it("renders HTML inside a trusted container that keeps navigation bounded", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    mountRunnableBlock(host, {
      code: "<h1>Hello</h1>",
      language: "html",
      runner: createRunner({
        language: "html",
        run: async () => ({
          durationMs: 0,
          exitCode: 0,
          preview: { html: "<h1>Hello</h1>", kind: "html", scripts: "blocked" },
          stderr: "",
          stdout: "Preview rendered."
        })
      })
    });
    await Promise.resolve();
    host.querySelector<HTMLButtonElement>(".rcb__button--run")?.click();
    await vi.waitFor(() => expect(host.querySelector(".rcb__preview-frame")).not.toBeNull());

    const frame = host.querySelector<HTMLIFrameElement>('.rcb__preview-frame');
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.srcdoc).toContain("runnable-code-blocks-container");
    expect(frame?.srcdoc).toContain("frame-src 'none'");
    expect(frame?.srcdoc).not.toContain("<h1>Hello</h1>");
    expect(host.querySelector(".rcb__console-meta")?.textContent).toBe("Starting preview…");
    await markPreviewReady(host);
    expect(host.querySelector(".rcb__console-meta")?.textContent).toBe("Preview ready");
  });

  it("allows scripts only for the isolated interactive web preview", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    mountRunnableBlock(host, {
      code: "<button>Run</button>",
      language: "web",
      runner: createRunner({
        language: "web",
        run: async () => ({
          durationMs: 0,
          exitCode: 0,
          preview: { html: "<button>Run</button>", kind: "html", scripts: "isolated" },
          provider: "Interactive browser sandbox",
          stderr: "",
          stdout: ""
        })
      })
    });
    await Promise.resolve();
    host.querySelector<HTMLButtonElement>(".rcb__button--run")?.click();
    await vi.waitFor(() => expect(host.querySelector(".rcb__preview-frame")).not.toBeNull());
    await markPreviewReady(host);

    const frame = host.querySelector<HTMLIFrameElement>(".rcb__preview-frame");
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame?.title).toBe("Interactive code preview");
    expect(host.querySelector<HTMLElement>(".rcb__output")?.hidden).toBe(true);
  });

  it("fits the outer preview frame to the height reported by the isolated result", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    mountRunnableBlock(host, {
      code: "<main>Result</main>",
      language: "web",
      runner: createRunner({
        language: "web",
        run: async () => ({
          durationMs: 0,
          exitCode: 0,
          preview: { html: "<main>Result</main>", kind: "html", scripts: "isolated" },
          stderr: "",
          stdout: ""
        })
      })
    });
    await Promise.resolve();
    host.querySelector<HTMLButtonElement>(".rcb__button--run")?.click();
    await vi.waitFor(() => expect(host.querySelector(".rcb__preview-frame")).not.toBeNull());

    const frame = host.querySelector<HTMLIFrameElement>(".rcb__preview-frame");
    window.dispatchEvent(new MessageEvent("message", {
      data: { sender: "runnable-code-blocks-preview", type: "resize", height: 732 },
      origin: "null",
      source: frame?.contentWindow
    }));
    expect(frame?.style.height).toBe("");

    const tokenSource = frame?.srcdoc.match(/const token = ("[^"]+");/u)?.[1];
    expect(tokenSource).toBeDefined();
    window.dispatchEvent(new MessageEvent("message", {
      data: {
        sender: "runnable-code-blocks-preview",
        type: "resize",
        height: 732,
        token: JSON.parse(tokenSource ?? '""') as string
      },
      origin: "null",
      source: frame?.contentWindow
    }));

    expect(frame?.style.height).toBe("732px");
  });

  it("shows the provider environment that actually completed a fallback run", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    mountRunnableBlock(host, {
      code: "console.log('fallback')",
      language: "javascript",
      runner: createRunner({
        environment: "remote",
        run: async () => ({
          durationMs: 1,
          environment: "browser",
          exitCode: 0,
          provider: "Web Worker fallback",
          stderr: "",
          stdout: "fallback"
        })
      })
    });
    await Promise.resolve();
    host.querySelector<HTMLButtonElement>(".rcb__button--run")?.click();
    await vi.waitFor(() => expect(host.querySelector(".rcb")?.getAttribute("data-state")).toBe("success"));

    expect(host.querySelector(".rcb")?.getAttribute("data-environment")).toBe("browser");
    expect(host.querySelector(".rcb__environment-name")?.textContent).toBe("Browser");
    expect(host.querySelector(".rcb__status")?.getAttribute("title")).toBe("Web Worker fallback");
  });

  it("keeps output hidden until execution starts", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    mountRunnableBlock(host, {
      code: "console.log('quiet')",
      language: "javascript",
      runner: createRunner()
    });
    await Promise.resolve();

    expect(host.querySelector<HTMLElement>(".rcb__console")?.hidden).toBe(true);
    expect(host.querySelector(".rcb__status")?.textContent).toBe("Ready to run");
  });
});

it("copies the edited source and reports clipboard failure without losing edits", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  const mounted = mountRunnableBlock(host, { code: "console.log(1)", language: "javascript", runner: createRunner() });
  const copy = host.querySelector<HTMLButtonElement>(".rcb__actions button");
  copy?.click();
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("console.log(1)"));
  expect(copy?.getAttribute("aria-label")).toBe("Copied");
  await vi.waitFor(() => expect(copy?.getAttribute("aria-label")).toBe("Copy code"), { timeout: 2500 });
  writeText.mockRejectedValueOnce(new Error("denied"));
  copy?.click();
  await vi.waitFor(() => expect(host.querySelector(".rcb__notice")?.textContent).toContain("Select the code"));
  expect(host.querySelector(".cm-content")?.textContent).toContain("console.log(1)");
  mounted.dispose();
  writeText.mockRestore();
});
