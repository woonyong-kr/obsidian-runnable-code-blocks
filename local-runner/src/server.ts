import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { EngineNotReadyError, type ExecutionEngine } from "./engine";

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
  return createServer(async (request, response) => {
    setSecurityHeaders(response);
    if (!validHost(request.headers.host) || !authenticated(request, options.token)) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }
    if (request.method === "GET" && request.url === "/v1/capabilities") {
      try {
        sendJson(response, 200, {
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
    if (request.method !== "POST" || request.url !== "/v1/run") {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
    if (active >= (options.maxConcurrent ?? 2)) {
      sendJson(response, 429, { error: "Runner is at its concurrency limit." });
      return;
    }
    let payload: RunPayload;
    try {
      payload = parseRunPayload(await readBody(request));
    } catch (error) {
      sendJson(response, error instanceof SourceTooLargeError ? 413 : 400, { error: errorMessage(error) });
      return;
    }
    active += 1;
    const controller = new AbortController();
    request.once("aborted", () => controller.abort());
    try {
      const result = await options.engine.run(payload.language, payload.code, controller.signal);
      sendJson(response, 200, { ...result, language: payload.language });
    } catch (error) {
      sendJson(response, error instanceof EngineNotReadyError ? 503 : 500, {
        error: errorMessage(error)
      });
    } finally {
      active -= 1;
    }
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
