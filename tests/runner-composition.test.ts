import { afterEach, describe, expect, it, vi } from "vitest";
import { resetWandboxCompilerCache } from "../src/runners/wandbox-runner";
import { resetPersonalCompilerCapabilityCache } from "../src/runners/personal-compiler-runner";
import { composeLanguageRunner, createRunnerRegistry } from "../src/runner-composition";
import { SUPPORTED_LANGUAGES, supportedLanguage } from "../src/supported-languages";
import { normalizeSettings } from "../src/settings";

afterEach(() => {
  resetWandboxCompilerCache();
  resetPersonalCompilerCapabilityCache();
});

describe("runner composition", () => {
  it("does not upload legacy Kotlin source when the local companion is unpaired", async () => {
    const fetch_ = vi.fn();
    const settings = normalizeSettings({ kotlinCompilerPath: "/local/kotlinc", javaPath: "/local/java" });
    const runner = createRunnerRegistry(() => ({ ...settings, fetch: fetch_ })).create("kotlin");
    if (runner === null) throw new Error("Kotlin runner is not registered");
    await expect(runner.availability()).resolves.toMatchObject({ available: false });
    await expect(runner.run('println("migration check")')).rejects.toMatchObject({ executionState: "not-started" });
    expect(fetch_).not.toHaveBeenCalled();
    runner.dispose?.();
  });

  it("registers every language from the declarative catalog", () => {
    const registry = createRunnerRegistry();
    expect(registry.languages()).toEqual(SUPPORTED_LANGUAGES.map(({ id }) => id).sort());
    expect(SUPPORTED_LANGUAGES.map(({ id }) => registry.create(id)?.language)).toEqual(
      SUPPORTED_LANGUAGES.map(({ id }) => id)
    );
  });

  it.each(["private-first", "remote-first"] as const)("uses %s order before executing source once", async (executionOrder) => {
    const requests: string[] = [];
    const fetch_ = vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : input.toString();
      requests.push(url);
      const body = url.includes("wandbox") ? [] : url.endsWith("capabilities")
        ? { languages: ["java"], protocolVersion: 1, runnerVersion: "test", service: "personal-compiler", status: "online" }
        : { durationMs: 1, exitCode: 0, language: "java", provider: "personal", stderr: "", stdout: "executed" };
      return new Response(JSON.stringify(body));
    });
    const runner = createRunnerRegistry({ executionOrder, personalCompilerEnabled: true, personalCompilerEndpoint: "https://runner.example.com", fetch: fetch_ }).create("java");
    await expect(runner?.availability()).resolves.toMatchObject({ available: true });
    await expect(runner?.run("source")).resolves.toMatchObject({ stdout: "executed" });
    expect(requests[0]).toContain(executionOrder === "private-first" ? "runner.example.com" : "wandbox");
    expect(requests.filter(url => url.endsWith("/v1/run"))).toHaveLength(1);
    expect(requests.filter(url => url.includes("compile.json"))).toHaveLength(0);
  });

  it("provides browser-only previews even when remote execution is disabled", async () => {
    const html = supportedLanguage("html");
    if (html === null) throw new Error("html missing");
    const runner = composeLanguageRunner(html, { remoteExecutionEnabled: false });
    await expect(runner.availability()).resolves.toMatchObject({ available: true });
  });

  it("provides an isolated interactive web preview without remote execution", async () => {
    const web = supportedLanguage("web");
    if (web === null) throw new Error("web missing");
    const runner = composeLanguageRunner(web, { remoteExecutionEnabled: false });
    await expect(runner.availability()).resolves.toMatchObject({ available: true });
    await expect(runner.run("<button>Run</button>")).resolves.toMatchObject({
      preview: { scripts: "isolated" }
    });
  });

  it("provides an isolated TypeScript web preview without remote execution", async () => {
    const webTypeScript = supportedLanguage("web-ts");
    if (webTypeScript === null) throw new Error("web-ts missing");
    const runner = composeLanguageRunner(webTypeScript, { remoteExecutionEnabled: false });
    await expect(runner.availability()).resolves.toMatchObject({ available: true });
  });

  it("provides a bundled React JSX and TSX preview without remote execution", async () => {
    const react = supportedLanguage("react");
    if (react === null) throw new Error("react missing");
    const runner = composeLanguageRunner(react, { remoteExecutionEnabled: false });
    await expect(runner.availability()).resolves.toMatchObject({ available: true });
    await expect(runner.run("export default function App() { return <p>Hello</p>; }")).resolves.toMatchObject({
      exitCode: 0,
      preview: { scripts: "isolated" }
    });
  });

  it("makes non-browser languages explicitly unavailable in private web mode", async () => {
    const python = supportedLanguage("python");
    if (python === null) throw new Error("python missing");
    const runner = composeLanguageRunner(python, { remoteExecutionEnabled: false });
    await expect(runner.availability()).resolves.toMatchObject({ available: false });
  });

  it("uses the optional local companion before remote execution in private-first mode", async () => {
    const java = supportedLanguage("java");
    if (java === null) throw new Error("java missing");
    const fetch_ = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        engine: "Docker 28",
        languages: ["java"],
        protocolVersion: 1,
        runnerVersion: "0.1.0"
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        durationMs: 8,
        exitCode: 0,
        language: "java",
        provider: "Local container · java@sha256:test",
        stderr: "",
        stdout: "local-ok\n"
      })));
    const runner = composeLanguageRunner(java, {
      executionOrder: "private-first",
      fetch: fetch_ as typeof fetch,
      localExecutionEnabled: true,
      localRunnerEndpoint: "http://127.0.0.1:17171",
      localRunnerToken: "test-token-with-32-safe-characters"
    });

    await expect(runner.availability()).resolves.toMatchObject({ available: true });
    await expect(runner.run("class Main {}"))
      .resolves.toMatchObject({ environment: "local", stdout: "local-ok\n" });
    expect(fetch_).toHaveBeenCalledTimes(2);
  });

  it("uses the public personal compiler without enabling third-party providers", async () => {
    const java = supportedLanguage("java");
    if (java === null) throw new Error("java missing");
    const fetch_ = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        languages: ["java"],
        protocolVersion: 1,
        runnerVersion: "0.1.0",
        service: "personal-compiler",
        status: "online"
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        durationMs: 8,
        exitCode: 0,
        language: "java",
        provider: "Woon personal compiler · java",
        stderr: "",
        stdout: "public-ok\n"
      })));
    const runner = composeLanguageRunner(java, {
      executionOrder: "private-first",
      fetch: fetch_ as typeof fetch,
      personalCompilerEnabled: true,
      personalCompilerEndpoint: "https://runner.woonyong.com",
      remoteExecutionEnabled: false
    });

    await expect(runner.availability()).resolves.toMatchObject({ available: true });
    await expect(runner.run("class Main {}"))
      .resolves.toMatchObject({ environment: "remote", stdout: "public-ok\n" });
    expect(fetch_).toHaveBeenCalledTimes(2);
  });

  it("applies a changed execution policy to runners that are already mounted", async () => {
    const policy = { remoteExecutionEnabled: true };
    const registry = createRunnerRegistry(() => policy);
    const runner = registry.create("python");
    if (runner === null) throw new Error("python runner missing");

    policy.remoteExecutionEnabled = false;

    await expect(runner.availability()).resolves.toMatchObject({ available: false });
    await expect(runner.run("print('private')")).rejects.toThrow("provider");
  });

  it("uses one policy snapshot for remote preflight and execution", async () => {
    const json = (value: unknown) => new Response(JSON.stringify(value), {
      headers: { "Content-Type": "application/json" }
    });
    const fetch_ = vi.fn()
      .mockResolvedValueOnce(json([{ language: "Python", name: "cpython-3.13.8", version: "3.13.8" }]))
      .mockResolvedValueOnce(json({ program_output: "remote-ok\n", status: "0" }));
    const registry = createRunnerRegistry(() => ({ fetch: fetch_ as typeof fetch }));
    const runner = registry.create("python");
    if (runner === null) throw new Error("python runner missing");

    await expect(runner.run("print('remote-ok')")).resolves.toMatchObject({
      provider: "Wandbox · cpython-3.13.8",
      stdout: "remote-ok\n"
    });
  });
});
