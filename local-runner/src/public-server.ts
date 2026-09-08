import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { EngineNotReadyError, ExecutionCancelledError, type ExecutionEngine } from "./engine";

const MAX_SOURCE_BYTES = 32_000;
const MAX_BODY_BYTES = 40_000;
const PROTOCOL_VERSION = 1;
const RESULT_CACHE_MS = 30_000;

export interface PublicRunnerServerOptions {
  allowedOrigins: readonly string[];
  engine: ExecutionEngine;
  globalLimitPerHour?: number;
  hostname: string;
  languages?: readonly string[] | null;
  maxConcurrent?: number;
  perIpLimitPerMinute?: number;
  runnerVersion: string;
}

interface CachedJob {
  origin: string;
  expiresAt: number;
  fingerprint: string;
  result: Promise<HttpResult>;
  controller: AbortController;
  state: "running" | "completed" | "cancelled" | "unknown";
}

interface HttpResult {
  body: unknown;
  status: number;
}

export function createPublicRunnerServer(options: PublicRunnerServerOptions): Server {
  const allowedOrigins = new Set(options.allowedOrigins);
  const allowedLanguages = options.languages === null || options.languages === undefined
    ? null
    : new Set(options.languages);
  const perIp = new FixedWindowQuota(60_000);
  const global = new FixedWindowQuota(60 * 60_000);
  const jobs = new Map<string, CachedJob>();
  let active = 0;
  const cancellations = new FixedWindowQuota(60_000);

  return createServer({ requestTimeout: 22_000, headersTimeout: 5_000, connectionsCheckingInterval: 1_000 }, async (request, response) => {
    const origin = request.headers.origin;
    setSecurityHeaders(response, origin !== undefined && allowedOrigins.has(origin) ? origin : null);

    if (!validHost(request.headers.host, options.hostname)) {
      sendJson(response, 421, { error: "Misdirected request" });
      return;
    }
    if (request.method === "GET" && request.url === "/v1/health") {
      sendJson(response, 200, { service: "personal-compiler", status: "online" });
      return;
    }
    if (origin === undefined || !allowedOrigins.has(origin)) {
      sendJson(response, 403, { error: "Origin is not allowed" });
      return;
    }
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }
    if (request.method === "GET" && request.url === "/v1/capabilities") {
      try {
        const available = await options.engine.availableLanguages();
        sendJson(response, 200, {
          cancellation: true,
          languages: filterLanguages(available, allowedLanguages),
          protocolVersion: PROTOCOL_VERSION,
          runnerVersion: options.runnerVersion,
          service: "personal-compiler",
          status: "online"
        });
      } catch {
        sendJson(response, 503, {
          error: "The personal compiler is online, but its container engine is not ready.",
          service: "personal-compiler",
          status: "warming"
        });
      }
      return;
    }
    if (request.method !== "POST" || !["/v1/run", "/v1/cancel"].includes(request.url ?? "")) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    const requestId = request.headers["x-runnable-request-id"];
    if (typeof requestId !== "string" || !isUuid(requestId)) {
      sendJson(response, 400, { error: "X-Runnable-Request-Id must be a UUID" });
      return;
    }
    const client = clientAddress(request);
    const key = requestId;
    pruneJobs(jobs, Date.now());
    if (jobs.has(key) && jobs.get(key)?.origin !== origin) {
      sendJson(response, 403, { error: "Request ID belongs to another origin.", state: "unknown" }); return;
    }
    if (request.url === "/v1/cancel") {
      let job = jobs.get(key);
      if (job === undefined) {
        if (jobs.size >= 4096 || !cancellations.consume(client, 30, Date.now())) {
          sendJson(response, 429, { state: "unknown" });
          return;
        }
        job = {
          origin, controller: new AbortController(), expiresAt: Date.now() + RESULT_CACHE_MS,
          fingerprint: "", result: Promise.resolve(cancelledResult()), state: "cancelled"
        };
        jobs.set(key, job);
      }
      job.controller.abort();
      // An acknowledgement means the engine has finished its cleanup, not just received AbortSignal.
      await job.result;
      sendJson(response, 200, { state: job.state });
      return;
    }
    if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
      sendJson(response, 415, { error: "Content-Type must be application/json" });
      return;
    }

    let payload: RunPayload;
    try {
      payload = parseRunPayload(await readBody(request));
    } catch (error) {
      sendJson(response, error instanceof SourceTooLargeError ? 413 : 400, { error: publicError(error) });
      return;
    }
    if (allowedLanguages !== null && !allowedLanguages.has(payload.language)) {
      sendJson(response, 404, { error: "Language is not enabled" });
      return;
    }

    const fingerprint = createHash("sha256")
      .update(payload.language)
      .update("\0")
      .update(payload.code)
      .digest("hex");
    const now = Date.now();
    pruneJobs(jobs, now);
    const existing = jobs.get(key);
    if (existing !== undefined) {
      if (existing.origin !== origin) { sendJson(response, 403, { error: "Request ID belongs to another origin." }); return; }
      if (existing.state === "cancelled") {
        sendJson(response, 409, cancelledResult().body);
        return;
      }
      if (existing.fingerprint !== fingerprint) {
        sendJson(response, 409, { error: "Request ID was already used for different source" });
        return;
      }
      const result = await existing.result;
      sendJson(response, result.status, result.body);
      return;
    }

    if (jobs.size >= 4096) {
      sendJson(response, 503, { error: "Execution cache is at capacity." });
      return;
    }
    if (!perIp.consume(client, options.perIpLimitPerMinute ?? 6, now)) {
      response.setHeader("Retry-After", "60");
      sendJson(response, 429, { error: "This browser has reached the personal compiler rate limit." });
      return;
    }
    if (!global.consume("global", options.globalLimitPerHour ?? 120, now)) {
      response.setHeader("Retry-After", "3600");
      sendJson(response, 429, { error: "The personal compiler has reached its hourly capacity." });
      return;
    }
    if (active >= (options.maxConcurrent ?? 2)) {
      response.setHeader("Retry-After", "5");
      sendJson(response, 429, { error: "The personal compiler is busy." });
      return;
    }

    active += 1;
    const controller = new AbortController();
    const job: CachedJob = {
      origin, controller, expiresAt: Infinity, fingerprint,
      result: Promise.resolve({ status: 500, body: {} }), state: "running"
    };
    const result = execute(options.engine, payload, controller.signal).then((value) => {
      job.state = value.status === 409 ? "cancelled" : value.status === 200 ? "completed" : "unknown";
      return value;
    }).finally(() => { active -= 1; job.expiresAt = Date.now() + RESULT_CACHE_MS; });
    job.result = result;
    jobs.set(key, job);
    const completed = await result;
    sendJson(response, completed.status, completed.body);
  });
}

async function execute(engine: ExecutionEngine, payload: RunPayload, signal: AbortSignal): Promise<HttpResult> {
  try {
    const result = await engine.run(payload.language, payload.code, signal);
    return {
      body: {
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        ...(result.failureReason === undefined ? {} : {failureReason: result.failureReason}),
        language: payload.language,
        provider: `Woon personal compiler · ${payload.language}`,
        stderr: result.stderr,
        stdout: result.stdout
      },
      status: 200
    };
  } catch (error) {
    if (error instanceof ExecutionCancelledError) return cancelledResult();
    if (error instanceof EngineNotReadyError) {
      return { body: { error: "This language runtime is not prepared yet." }, status: 503 };
    }
    return { body: { error: "The personal compiler could not complete this execution." }, status: 500 };
  }
}

class FixedWindowQuota {
  readonly #entries = new Map<string, { count: number; startsAt: number }>();
  readonly #windowMs: number;

  constructor(windowMs: number) {
    this.#windowMs = windowMs;
  }

  consume(key: string, limit: number, now: number): boolean {
    const existing = this.#entries.get(key);
    if (existing === undefined || now - existing.startsAt >= this.#windowMs) {
      this.#entries.set(key, { count: 1, startsAt: now });
      return true;
    }
    if (existing.count >= limit) return false;
    existing.count += 1;
    return true;
  }
}

function filterLanguages(available: string[], allowed: ReadonlySet<string> | null): string[] {
  return available.filter((language) => allowed === null || allowed.has(language)).sort();
}

function validHost(value: string | undefined, expected: string): boolean {
  if (value === undefined) return false;
  const hostname = value.replace(/^\[/u, "").split(/[\]:]/u, 1)[0]?.toLowerCase();
  return hostname === expected || hostname === "127.0.0.1" || hostname === "localhost";
}

function clientAddress(request: IncomingMessage): string {
  const forwarded = request.headers["cf-connecting-ip"];
  if (typeof forwarded === "string" && isIP(forwarded) !== 0) return forwarded;
  return request.socket.remoteAddress ?? "unknown";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

function setSecurityHeaders(response: ServerResponse, origin: string | null): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  response.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Vary", "Origin");
  if (origin !== null) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Runnable-Request-Id");
    response.setHeader("Access-Control-Max-Age", "600");
    response.setHeader("Access-Control-Expose-Headers", "Retry-After");
  }
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
    if (size > MAX_BODY_BYTES) throw new SourceTooLargeError();
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

function publicError(error: unknown): string {
  if (error instanceof SourceTooLargeError) return error.message;
  return error instanceof SyntaxError ? "Invalid JSON" : error instanceof Error ? error.message : "Invalid request";
}

function cancelledResult(): HttpResult {
  return { status: 409, body: { error: "Execution cancelled.", state: "cancelled" } };
}

function pruneJobs(jobs: Map<string, CachedJob>, now: number): void {
  for (const [key, value] of jobs) {
    if (value.expiresAt <= now) jobs.delete(key);
  }
}

interface RunPayload {
  code: string;
  language: string;
}

class SourceTooLargeError extends Error {
  constructor() {
    super("Source exceeds 32000 bytes.");
    this.name = "SourceTooLargeError";
  }
}
