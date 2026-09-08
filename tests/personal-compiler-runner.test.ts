import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizePublicRunnerEndpoint,
  PersonalCompilerRunner,
  resetPersonalCompilerCapabilityCache
} from "../src/runners/personal-compiler-runner";

afterEach(() => {
  resetPersonalCompilerCapabilityCache();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("PersonalCompilerRunner", () => {
  it("cancels the same server request without source and reports only the server acknowledgement", async () => {
    const controller = new AbortController();
    const cancellation = vi.fn();
    const fetch_ = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if ((input as string).endsWith("/v1/cancel")) return json({ state: "cancelled" });
      return await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason as Error), { once: true }));
    });
    const runner = new PersonalCompilerRunner({ endpoint: "https://runner.example.com", fetch: fetch_, language: "java" });
    const pending = runner.run("private test source", { signal: controller.signal, onCancellation: cancellation });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetch_).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    await vi.waitFor(() => expect(cancellation).toHaveBeenCalledWith("cancelled"));
    expect(fetch_).toHaveBeenCalledTimes(2);
    const cancelInit = fetch_.mock.calls[1]?.[1];
    expect(cancelInit?.body).toBeUndefined();
    expect(cancelInit?.signal?.aborted).toBe(false);
    expect(cancelInit?.headers).toEqual(fetch_.mock.calls[0]?.[1]?.headers);
  });

  it("does not retry an expired execution deadline", async () => {
    vi.useFakeTimers();
    const fetch_ = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason as Error), { once: true });
    }));
    const runner = new PersonalCompilerRunner({ endpoint: "https://runner.example.com", fetch: fetch_, language: "java" });
    const assertion = expect(runner.run("source")).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(22_000);
    await assertion;
    expect(fetch_.mock.calls.filter(([url]) => (url as string).endsWith("/v1/run"))).toHaveLength(1);
    expect(fetch_.mock.calls.filter(([url]) => (url as string).endsWith("/v1/cancel"))).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4_000);
  });

  it("preserves rate-limit metadata without retrying the code", async () => {
    const fetch_ = vi.fn(async () => new Response('{"error":"busy"}', { status: 429, headers: { "Retry-After": "60" } }));
    const runner = new PersonalCompilerRunner({ endpoint: "https://runner.example.com", fetch: fetch_, language: "java" });
    await expect(runner.run("source")).rejects.toMatchObject({ retryAfterMs: 60_000, executionState: "not-started" });
    expect(fetch_).toHaveBeenCalledOnce();
  });

  it.each(["{broken", "x".repeat(1_048_577)])("does not retry an invalid response (%#)", async (body) => {
    const fetch_ = vi.fn(async () => new Response(body));
    const runner = new PersonalCompilerRunner({ endpoint: "https://runner.example.com", fetch: fetch_, language: "java" });
    await expect(runner.run("source")).rejects.toThrow();
    expect(fetch_).toHaveBeenCalledOnce();
  });
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
