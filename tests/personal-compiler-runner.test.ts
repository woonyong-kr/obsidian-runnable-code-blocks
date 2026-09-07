import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizePublicRunnerEndpoint,
  PersonalCompilerRunner,
  resetPersonalCompilerCapabilityCache
} from "../src/runners/personal-compiler-runner";

afterEach(() => {
  resetPersonalCompilerCapabilityCache();
  vi.restoreAllMocks();
});

describe("PersonalCompilerRunner", () => {
  it("accepts HTTPS origins and rejects paths or insecure public hosts", () => {
    expect(normalizePublicRunnerEndpoint("https://runner.woonyong.com")).toBe("https://runner.woonyong.com");
    expect(normalizePublicRunnerEndpoint("http://127.0.0.1:17172")).toBe("http://127.0.0.1:17172");
    expect(() => normalizePublicRunnerEndpoint("http://runner.woonyong.com")).toThrow("HTTPS");
    expect(() => normalizePublicRunnerEndpoint("https://runner.woonyong.com/v1")).toThrow("경로");
  });

  it("preflights capabilities and returns a sanitized remote result", async () => {
    const fetch_ = vi.fn()
      .mockResolvedValueOnce(json({
        languages: ["java", "kotlin"],
        protocolVersion: 1,
        runnerVersion: "0.1.0",
        service: "personal-compiler",
        status: "online"
      }))
      .mockResolvedValueOnce(json({
        durationMs: 48,
        exitCode: 0,
        language: "java",
        provider: "Woon personal compiler · java",
        stderr: "",
        stdout: "Hello\n"
      }));
    const runner = new PersonalCompilerRunner({
      endpoint: "https://runner.woonyong.com",
      fetch: fetch_ as typeof fetch,
      language: "java"
    });

    await expect(runner.availability()).resolves.toMatchObject({ available: true });
    await expect(runner.run("class Main {}"))
      .resolves.toMatchObject({ environment: "remote", exitCode: 0, stdout: "Hello\n" });
    expect(fetch_.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({ "X-Runnable-Request-Id": expect.any(String) as string }),
      method: "POST"
    });
  });

  it("explains the personal compiler model when the machine is offline", async () => {
    const runner = new PersonalCompilerRunner({
      endpoint: "https://runner.woonyong.com",
      fetch: vi.fn(async () => { throw new TypeError("network offline"); }),
      language: "kotlin"
    });

    await expect(runner.availability()).resolves.toMatchObject({
      available: false,
      detail: expect.stringContaining("운영 비용") as string
    });
  });

  it("retries a transport failure with the same idempotency key", async () => {
    const fetch_ = vi.fn()
      .mockRejectedValueOnce(new TypeError("connection reset"))
      .mockResolvedValueOnce(json({
        durationMs: 5,
        exitCode: 0,
        language: "python",
        provider: "Woon personal compiler · python",
        stderr: "",
        stdout: "42\n"
      }));
    const runner = new PersonalCompilerRunner({
      endpoint: "https://runner.woonyong.com",
      fetch: fetch_ as typeof fetch,
      language: "python"
    });

    await expect(runner.run("print(42)")).resolves.toMatchObject({ stdout: "42\n" });
    const firstHeaders = fetch_.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const secondHeaders = fetch_.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(firstHeaders["X-Runnable-Request-Id"]).toBe(secondHeaders["X-Runnable-Request-Id"]);
  });

  it("keeps rejected capacity failures safe for a later manual retry", async () => {
    const runner = new PersonalCompilerRunner({
      endpoint: "https://runner.woonyong.com",
      fetch: vi.fn(async () => json({ error: "busy" }, 429)),
      language: "java"
    });
    await expect(runner.run("class Main {}")).rejects.toMatchObject({
      executionState: "not-started",
      message: expect.stringContaining("다른 실행") as string
    });
  });
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status
  });
}
