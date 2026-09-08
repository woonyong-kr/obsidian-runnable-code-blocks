// @vitest-environment node
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionCancelledError, type ExecutionEngine } from "../src/engine";
import { createPublicRunnerServer } from "../src/public-server";

const ORIGIN = "https://woonyong-kr.github.io";
const REQUEST_ID = "181a37b0-1e5a-4cc7-a5b2-f6e005c04316";
const servers: ReturnType<typeof createPublicRunnerServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => await new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("public runner HTTP boundary", () => {
  it("acknowledges cancellation only after engine cleanup, and never restarts that ID", async () => {
    let stopped = false;
    let finishCleanup: () => void = () => undefined;
    const engine = fakeEngine();
    engine.run.mockImplementation(async (_language: string, _code: string, signal: AbortSignal) =>
      await new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          stopped = true;
          finishCleanup = () => reject(new ExecutionCancelledError());
        }, { once: true });
      }));
    const endpoint = await listen(engine);
    const pending = run(endpoint, REQUEST_ID, "while True: pass", "python");
    await vi.waitFor(() => expect(engine.run.mock.calls).toHaveLength(1));
    let acknowledged = false;
    const cancellation = cancel(endpoint).then((value) => { acknowledged = true; return value; });
    await vi.waitFor(() => expect(stopped).toBe(true));
    expect(acknowledged).toBe(false);
    finishCleanup();
    await expect((await cancellation).json()).resolves.toMatchObject({ state: "cancelled" });
    expect((await pending).status).toBe(409);
    expect((await run(endpoint, REQUEST_ID, "while True: pass", "python")).status).toBe(409);
    expect(engine.run.mock.calls).toHaveLength(1);
  });

  it("can cancel its unguessable request ID after the client network address changes", async () => {
    const engine = fakeEngine();
    engine.run.mockImplementation(async (_language: string, _code: string, signal: AbortSignal) =>
      await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new ExecutionCancelledError()), {once: true})));
    const endpoint = await listen(engine);
    const pending = run(endpoint, REQUEST_ID, "while True: pass", "python");
    await vi.waitFor(() => expect(engine.run.mock.calls).toHaveLength(1));
    const response = await fetch(`${endpoint}/v1/cancel`, { method: "POST", headers: {
      Origin: ORIGIN, "X-Runnable-Request-Id": REQUEST_ID, "CF-Connecting-IP": "203.0.113.40"
    } });
    expect((await response.json() as {state:string}).state).toBe("cancelled");
    expect((await pending).status).toBe(409);
  });

  it("remembers cancellation arriving before a delayed POST", async () => {
    const engine = fakeEngine();
    const endpoint = await listen(engine);
    await expect((await cancel(endpoint)).json()).resolves.toMatchObject({ state: "cancelled" });
    expect((await run(endpoint, REQUEST_ID, "while True: pass", "python")).status).toBe(409);
    expect(engine.run.mock.calls).toHaveLength(0);
  });

  it("does not confirm cancellation when engine cleanup fails", async () => {
    const engine = fakeEngine();
    engine.run.mockImplementation(async (_language: string, _code: string, signal: AbortSignal) =>
      await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("Docker unavailable")), { once: true })));
    const endpoint = await listen(engine);
    const pending = run(endpoint, REQUEST_ID, "source", "python");
    await vi.waitFor(() => expect(engine.run.mock.calls).toHaveLength(1));
    await expect((await cancel(endpoint)).json()).resolves.toMatchObject({ state: "unknown" });
    await pending;
  });

  it("exposes minimal health without opening execution to other origins", async () => {
    const endpoint = await listen(fakeEngine());
    await expect(fetch(`${endpoint}/v1/health`)).resolves.toMatchObject({ status: 200 });
    await expect(fetch(`${endpoint}/v1/capabilities`, { headers: { Origin: "https://example.com" } }))
      .resolves.toMatchObject({ status: 403 });
  });

  it("returns only prepared and explicitly enabled capabilities", async () => {
    const endpoint = await listen(fakeEngine(), { languages: ["java"] });
    const response = await fetch(`${endpoint}/v1/capabilities`, { headers: { Origin: ORIGIN } });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    await expect(response.json()).resolves.toEqual({
      cancellation: true,
      languages: ["java"],
      protocolVersion: 1,
      runnerVersion: "0.1.0",
      service: "personal-compiler",
      status: "online"
    });
  });

  it("answers allowed CORS preflight without starting the engine", async () => {
    const { engine, runMock } = fakeEngineWithMock();
    const endpoint = await listen(engine);
    const response = await fetch(`${endpoint}/v1/run`, {
      headers: { Origin: ORIGIN },
      method: "OPTIONS"
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(runMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before execution", async () => {
    const { engine, runMock } = fakeEngineWithMock();
    const endpoint = await listen(engine);
    const response = await fetch(`${endpoint}/v1/run`, {
      body: "{",
      headers: {
        "Content-Type": "application/json",
        "Origin": ORIGIN,
        "X-Runnable-Request-Id": REQUEST_ID
      },
      method: "POST"
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid JSON" });
    expect(runMock).not.toHaveBeenCalled();
  });

  it("executes through the shared container engine without leaking image details", async () => {
    const endpoint = await listen(fakeEngine());
    const response = await run(endpoint, REQUEST_ID, "class Main {}", "java");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      language: "java",
      provider: "Woon personal compiler · java",
      stdout: "42\n"
    });
  });

  it("deduplicates equal request IDs and rejects conflicting reuse", async () => {
    const { engine, runMock } = fakeEngineWithMock();
    const endpoint = await listen(engine);
    expect((await run(endpoint, REQUEST_ID, "print(42)", "python")).status).toBe(200);
    expect((await run(endpoint, REQUEST_ID, "print(42)", "python")).status).toBe(200);
    expect(runMock).toHaveBeenCalledTimes(1);
    expect((await run(endpoint, REQUEST_ID, "print(43)", "python")).status).toBe(409);
  });

  it("applies per-client quotas before starting another execution", async () => {
    const { engine, runMock } = fakeEngineWithMock();
    const endpoint = await listen(engine, { perIpLimitPerMinute: 1 });
    expect((await run(endpoint, REQUEST_ID, "print(1)", "python")).status).toBe(200);
    expect((await run(endpoint, "281a37b0-1e5a-4cc7-a5b2-f6e005c04316", "print(2)", "python")).status).toBe(429);
    expect(runMock).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized source before execution", async () => {
    const { engine, runMock } = fakeEngineWithMock();
    const endpoint = await listen(engine);
    const response = await run(endpoint, REQUEST_ID, "x".repeat(32_001), "python");
    expect(response.status).toBe(413);
    expect(runMock).not.toHaveBeenCalled();
  });
});

function fakeEngine(): ExecutionEngine & { run: ReturnType<typeof vi.fn> } {
  return fakeEngineWithMock().engine;
}

function fakeEngineWithMock(): {
  engine: ExecutionEngine & { run: ReturnType<typeof vi.fn> };
  runMock: ReturnType<typeof vi.fn>;
} {
  const runMock = vi.fn(async () => ({
    durationMs: 4,
    exitCode: 0,
    provider: "Local container · secret-image-digest",
    stderr: "",
    stdout: "42\n"
  }));
  return {
    engine: {
      availableLanguages: async () => ["python", "java"],
      prepare: async () => undefined,
      run: runMock,
      version: async () => "Docker test"
    },
    runMock
  };
}

async function listen(
  engine: ExecutionEngine,
  overrides: { languages?: string[]; perIpLimitPerMinute?: number } = {}
): Promise<string> {
  const server = createPublicRunnerServer({
    allowedOrigins: [ORIGIN],
    engine,
    hostname: "runner.woonyong.com",
    languages: overrides.languages,
    perIpLimitPerMinute: overrides.perIpLimitPerMinute,
    runnerVersion: "0.1.0"
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(address.port)}`;
}

async function run(endpoint: string, requestId: string, code: string, language: string): Promise<Response> {
  return await fetch(`${endpoint}/v1/run`, {
    body: JSON.stringify({ code, language }),
    headers: {
      "Content-Type": "application/json",
      "Origin": ORIGIN,
      "X-Runnable-Request-Id": requestId
    },
    method: "POST"
  });
}

async function cancel(endpoint: string): Promise<Response> {
  return await fetch(`${endpoint}/v1/cancel`, {
    method: "POST",
    headers: { Origin: ORIGIN, "X-Runnable-Request-Id": REQUEST_ID }
  });
}
