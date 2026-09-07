// @vitest-environment node
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutionEngine } from "../src/engine";
import { createPublicRunnerServer } from "../src/public-server";

const ORIGIN = "https://woonyong-kr.github.io";
const REQUEST_ID = "181a37b0-1e5a-4cc7-a5b2-f6e005c04316";
const servers: ReturnType<typeof createPublicRunnerServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => await new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("public runner HTTP boundary", () => {
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
