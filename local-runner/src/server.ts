import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { createAsyncHttpServer } from "./http-server";
import { EngineNotReadyError, ExecutionCancelledError, type ExecutionEngine } from "./engine";

const MAX_SOURCE_BYTES = 256_000;
const PROTOCOL_VERSION = 1;

export interface RunnerServerOptions {
  engine: ExecutionEngine;
  maxConcurrent?: number;
  runnerVersion: string;
  token: string;
}

export function createRunnerServer(options: RunnerServerOptions): Server {
  let active = 0;
  const jobs = new Map<string, {
    fingerprint: string; controller: AbortController; expiresAt: number;
    state: "running" | "completed" | "cancelled" | "unknown";
    done: Promise<{ status: number; body: unknown }>;
  }>();
  return createAsyncHttpServer(async (request, response) => {
    setSecurityHeaders(response);
    if (!validHost(request.headers.host) || !authenticated(request, options.token)) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    if (request.method === "GET" && request.url === "/v1/capabilities") {
      try {
        sendJson(response, 200, {
          cancellation: true,
          engine: await options.engine.version(),
          languages: await options.engine.availableLanguages(),
          protocolVersion: PROTOCOL_VERSION,
          runnerVersion: options.runnerVersion
        });
      } catch (error) {
        sendJson(response, 503, { error: errorMessage(error) });
      }
      return;
    }
    if (request.method !== "POST" || !["/v1/run", "/v1/cancel"].includes(request.url ?? "")) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    for (const [id, job] of jobs) if (job.expiresAt <= Date.now()) jobs.delete(id);
    const id = request.headers["x-runnable-request-id"];
    if (id !== undefined && (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id))) {
      sendJson(response, 400, { error: "Invalid request ID" }); return;
    }
    if (request.url === "/v1/cancel") {
      if (id === undefined) { sendJson(response, 400, { error: "Request ID required" }); return; }
      let job = jobs.get(id);
      if (job === undefined) {
        if (jobs.size >= 4096) { sendJson(response, 429, { state: "unknown" }); return; }
        job = { fingerprint: "", controller: new AbortController(), expiresAt: Date.now() + 30_000,
          state: "cancelled", done: Promise.resolve({ status: 409, body: { state: "cancelled" } }) };
        jobs.set(id, job);
      }
      job.controller.abort();
      await job.done;
      sendJson(response, 200, { state: job.state }); return;
    }
    let payload: RunPayload;
    try {
      payload = parseRunPayload(await readBody(request));
    } catch (error) {
      sendJson(response, error instanceof SourceTooLargeError ? 413 : 400, { error: errorMessage(error) });
      return;
    }
    const fingerprint = createHash("sha256").update(payload.language).update("\0").update(payload.code).digest("hex");
    const existing = id === undefined ? undefined : jobs.get(id);
    if (existing) {
      if (existing.state === "cancelled") { sendJson(response, 409, { state: "cancelled" }); return; }
      if (existing.fingerprint !== fingerprint) { sendJson(response, 409, { error: "Conflicting request ID" }); return; }
      const result = await existing.done;
      sendJson(response, result.status, result.body); return;
    }
    if (active >= (options.maxConcurrent ?? 2) || jobs.size >= 4096) {
      sendJson(response, 429, { error: "Runner is at its concurrency limit." }); return;
    }
    active += 1;
    const controller = new AbortController();
    const disconnect = () => { if (!response.writableEnded) controller.abort(); };
    // Legacy clients have no cancellation ID. Their response socket closing is the cancellation signal.
    if (id === undefined) response.once("close", disconnect);
    const job: NonNullable<ReturnType<typeof jobs.get>> = {
      controller, fingerprint, expiresAt: Infinity, state: "running", done: Promise.resolve({ status: 500, body: {} })
    };
    job.done = (async () => {
      try {
        const result = await options.engine.run(payload.language, payload.code, controller.signal);
        job.state = "completed";
        return { status: 200, body: { ...result, language: payload.language } };
      } catch (error) {
        job.state = error instanceof ExecutionCancelledError ? "cancelled" : "unknown";
        return { status: job.state === "cancelled" ? 409 : error instanceof EngineNotReadyError ? 503 : 500,
          body: { error: errorMessage(error), state: job.state } };
      } finally {
        active -= 1; job.expiresAt = Date.now() + 30_000;
        response.removeListener("close", disconnect);
      }
    })();
    if (id !== undefined) jobs.set(id, job);
    const result = await job.done;
    sendJson(response, result.status, result.body);
  });
}

function authenticated(request: IncomingMessage, token: string): boolean {
  const authorization = request.headers.authorization;
  if (authorization === undefined || !authorization.startsWith("Bearer ")) return false;
  const presented = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(token);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

function validHost(value: string | undefined): boolean {
  if (value === undefined) return false;
  const host = value.split(":", 1)[0]?.toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'none'");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  if (response.headersSent || response.destroyed) return;
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of request) {
    const chunk = Buffer.from(value as Uint8Array);
    size += chunk.length;
    if (size > MAX_SOURCE_BYTES) throw new SourceTooLargeError();
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseRunPayload(body: string): RunPayload {
  const value = JSON.parse(body) as unknown;
  if (typeof value !== "object" || value === null) throw new Error("Expected a JSON object.");
  const record = value as Record<string, unknown>;
  if (typeof record.language !== "string" || !/^[a-z][a-z0-9-]*$/u.test(record.language)) {
    throw new Error("Invalid language.");
  }
  if (typeof record.code !== "string") throw new Error("Invalid code.");
  if (Buffer.byteLength(record.code, "utf8") > MAX_SOURCE_BYTES) throw new SourceTooLargeError();
  return { code: record.code, language: record.language };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface RunPayload {
  code: string;
  language: string;
}

class SourceTooLargeError extends Error {
  constructor() {
    super("Source exceeds 256000 bytes.");
    this.name = "SourceTooLargeError";
  }
}

export function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}
