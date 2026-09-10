// @vitest-environment node
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { ExecutionEngine } from "../src/engine.mjs";
import { createRunnerServer } from "../src/server.mjs";
import { createAsyncHttpServer } from "../src/http-server.mjs";

const TOKEN = "test-token-with-32-safe-characters";
const servers: ReturnType<typeof createRunnerServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => await new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("local runner HTTP boundary", () => {
  it("returns a bounded error for a rejected request and accepts the next request", async () => {
    const server = createAsyncHttpServer(async (request, response) => {
      await Promise.resolve();
      if (request.url === "/fail") throw new Error("Private internal detail");
      response.end("Recovered");
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    const endpoint = `http://127.0.0.1:${String(address.port)}`;
    const failed = await fetch(`${endpoint}/fail`);
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "Internal server error" });
    expect(await (await fetch(`${endpoint}/healthy`)).text()).toBe("Recovered");
  });

  it("requires authentication and returns prepared capabilities", async () => {
    const endpoint = await listen(fakeEngine());
    await expect(fetch(`${endpoint}/v1/capabilities`)).resolves.toMatchObject({ status: 401 });
    const response = await fetch(`${endpoint}/v1/capabilities`, { headers: authHeaders() });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      cancellation: true,
      engine: "Docker test",
      languages: ["python"],
      protocolVersion: 1,
      runnerVersion: "0.1.0"
    });
  });

  it("executes validated source through the engine and returns its boundary", async () => {
    const engine = fakeEngine();
    const endpoint = await listen(engine);
    const response = await fetch(`${endpoint}/v1/run`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ code: "print(42)", language: "python" })
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      language: "python",
      provider: "Local container · test",
      stdout: "42\n"
    });
  });

  it("rejects invalid and oversized requests before execution", async () => {
    const endpoint = await listen(fakeEngine());
    const invalid = await fetch(`${endpoint}/v1/run`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ code: "x", language: "../../shell" })
    });
    expect(invalid.status).toBe(400);

    const oversized = await fetch(`${endpoint}/v1/run`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ code: "x".repeat(256_001), language: "python" })
    });
    expect(oversized.status).toBe(413);
  });
});

function fakeEngine(): ExecutionEngine {
  return {
    availableLanguages: async () => ["python"],
    prepare: async () => undefined,
    run: async () => ({
      durationMs: 4,
      exitCode: 0,
      provider: "Local container · test",
      stderr: "",
      stdout: "42\n"
    }),
    version: async () => "Docker test"
  };
}

async function listen(engine: ExecutionEngine): Promise<string> {
  const server = createRunnerServer({ engine, runnerVersion: "0.1.0", token: TOKEN });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${String(address.port)}`;
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${TOKEN}` };
}
