import { describe, expect, it, vi } from "vitest";
import { composeLanguageRunner, createRunnerRegistry } from "../src/runner-composition";
import { SUPPORTED_LANGUAGES, supportedLanguage } from "../src/supported-languages";

describe("runner composition", () => {
  it("registers every language from the declarative catalog", () => {
    const registry = createRunnerRegistry();
    expect(registry.languages()).toEqual(SUPPORTED_LANGUAGES.map(({ id }) => id).sort());
    expect(SUPPORTED_LANGUAGES.map(({ id }) => registry.create(id)?.language)).toEqual(
      SUPPORTED_LANGUAGES.map(({ id }) => id)
    );
  });

  it("keeps provider order configurable without changing Markdown", async () => {
    const html = supportedLanguage("html");
    if (html === null) throw new Error("html missing");
    const browserFirst = composeLanguageRunner(html, { executionOrder: "private-first" });
    await expect(browserFirst.availability()).resolves.toMatchObject({ available: true });
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
