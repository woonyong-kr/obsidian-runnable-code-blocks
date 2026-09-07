import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LocalCompanionRunner,
  normalizeLoopbackEndpoint,
  resetLocalCapabilityCache
} from "../src/runners/local-companion-runner";

const TOKEN = "test-token-with-32-safe-characters";

afterEach(() => {
  resetLocalCapabilityCache();
  vi.restoreAllMocks();
});

describe("LocalCompanionRunner", () => {
  it("accepts loopback endpoints and rejects paths or non-loopback hosts", () => {
    expect(normalizeLoopbackEndpoint("http://127.0.0.1:17171")).toBe("http://127.0.0.1:17171");
    expect(normalizeLoopbackEndpoint("http://localhost:17171")).toBe("http://localhost:17171");
    expect(() => normalizeLoopbackEndpoint("https://runner.example.com")).toThrow("127.0.0.1");
    expect(() => normalizeLoopbackEndpoint("http://127.0.0.1:17171/path")).toThrow("경로");
  });

  it("preflights capabilities and returns a validated local result", async () => {
    const fetch_ = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        engine: "Docker 28",
        languages: ["python"],
        protocolVersion: 1,
        runnerVersion: "0.1.0"
      }), { headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        durationMs: 12,
        exitCode: 0,
        language: "python",
        provider: "Local container · python@sha256:test",
        stderr: "",
        stdout: "42\n"
      }), { headers: { "Content-Type": "application/json" } }));
    const runner = new LocalCompanionRunner({
      endpoint: "http://127.0.0.1:17171",
      fetch: fetch_ as typeof fetch,
      language: "python",
      token: TOKEN
    });

    await expect(runner.availability()).resolves.toMatchObject({ available: true });
    await expect(runner.run("print(42)")).resolves.toMatchObject({
      environment: "local",
      exitCode: 0,
      stdout: "42\n"
    });
    expect(fetch_.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ Authorization: `Bearer ${TOKEN}` })
    });
  });

  it("does not expose a runner without a pairing token", async () => {
    const runner = new LocalCompanionRunner({
      endpoint: "http://127.0.0.1:17171",
      language: "java",
      token: ""
    });
    await expect(runner.availability()).resolves.toMatchObject({ available: false });
  });

  it("classifies rejected pre-execution requests separately from ambiguous failures", async () => {
    const rejected = new LocalCompanionRunner({
      endpoint: "http://127.0.0.1:17171",
      fetch: vi.fn(async () => new Response("busy", { status: 429 })),
      language: "python",
      token: TOKEN
    });
    await expect(rejected.run("print(1)")).rejects.toMatchObject({ executionState: "not-started" });

    const ambiguous = new LocalCompanionRunner({
      endpoint: "http://127.0.0.1:17171",
      fetch: vi.fn(async () => new Response("error", { status: 500 })),
      language: "python",
      token: TOKEN
    });
    await expect(ambiguous.run("print(1)")).rejects.toMatchObject({ executionState: "unknown" });
  });
});
