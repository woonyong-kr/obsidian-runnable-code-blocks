import type { CodeRunner, RunContext, RunResult, RunnerAvailability } from "../contracts";
import { fetchWithTimeout, type FetchLike, unavailableFetch } from "./http-client";
import { ProviderUnavailableError, unknownRemoteFailure } from "./provider-errors";

const PROTOCOL_VERSION = 1;
const CAPABILITY_CACHE_MS = 3_000;
const capabilityCache = new Map<string, { expiresAt: number; value: Promise<CapabilitiesResponse> }>();

interface CapabilitiesResponse {
  engine: string;
  languages: string[];
  protocolVersion: number;
  runnerVersion: string;
}

interface LocalRunResponse {
  durationMs: number;
  exitCode: number;
  language: string;
  provider: string;
  stderr: string;
  stdout: string;
}

export interface LocalCompanionOptions {
  endpoint: string;
  fetch?: FetchLike;
  language: string;
  token: string;
}

export class LocalCompanionRunner implements CodeRunner {
  readonly environment = "local" as const;
  readonly language: string;
  readonly #endpoint: string;
  readonly #fetch: FetchLike;
  readonly #token: string;

  constructor(options: LocalCompanionOptions) {
    this.language = options.language;
    this.#endpoint = normalizeLoopbackEndpoint(options.endpoint);
    this.#fetch = options.fetch ?? unavailableFetch;
    this.#token = options.token.trim();
  }

  async availability(): Promise<RunnerAvailability> {
    if (this.#token.length < 16) {
      return { available: false, detail: "Local runner pairing token이 설정되지 않았습니다." };
    }
    try {
      const capabilities = await cachedCapabilities(this.#endpoint, this.#token, this.#fetch);
      if (!capabilities.languages.includes(this.language)) {
        return { available: false, detail: `Local runner가 ${this.language} image를 제공하지 않습니다.` };
      }
      return {
        available: true,
        detail: `Local runner ${capabilities.runnerVersion} · ${capabilities.engine} · network disabled`
      };
    } catch (error) {
      return {
        available: false,
        detail: `Local runner preflight 실패: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async run(code: string, context?: RunContext): Promise<RunResult> {
    const requestId = crypto.randomUUID();
    let response: Response;
    try {
      response = await fetchWithTimeout(
        this.#fetch,
        `${this.#endpoint}/v1/run`,
        {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.#token}`,
            "Content-Type": "application/json",
            "X-Runnable-Request-Id": requestId
          },
          body: JSON.stringify({ code, language: this.language })
        },
        20_000,
        context?.signal
      );
    } catch (error) {
      throw unknownRemoteFailure("Local runner", error);
    }
    if (!response.ok) {
      const message = `Local runner HTTP ${String(response.status)}`;
      if ([401, 403, 404, 409, 413, 429, 503].includes(response.status)) {
        throw new ProviderUnavailableError(message, "not-started");
      }
      throw new ProviderUnavailableError(message, "unknown");
    }
    const value = await response.json() as unknown;
    if (!isLocalRunResponse(value, this.language)) {
      throw new ProviderUnavailableError("Local runner가 유효한 실행 결과를 반환하지 않았습니다.", "unknown");
    }
    return {
      durationMs: value.durationMs,
      environment: "local",
      exitCode: value.exitCode,
      provider: value.provider,
      stderr: value.stderr,
      stdout: value.stdout
    };
  }
}

export function normalizeLoopbackEndpoint(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
    throw new Error("Local runner endpoint는 http://127.0.0.1 또는 http://localhost만 허용합니다.");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Local runner endpoint에는 인증 정보, 경로, query, fragment를 넣을 수 없습니다.");
  }
  return url.origin;
}

export function resetLocalCapabilityCache(): void {
  capabilityCache.clear();
}

async function cachedCapabilities(endpoint: string, token: string, fetch_: FetchLike): Promise<CapabilitiesResponse> {
  const key = `${endpoint}\n${token}`;
  const now = Date.now();
  const cached = capabilityCache.get(key);
  if (cached !== undefined && cached.expiresAt > now) return await cached.value;
  const value = fetchCapabilities(endpoint, token, fetch_);
  capabilityCache.set(key, { expiresAt: now + CAPABILITY_CACHE_MS, value });
  try {
    return await value;
  } catch (error) {
    capabilityCache.delete(key);
    throw error;
  }
}

async function fetchCapabilities(endpoint: string, token: string, fetch_: FetchLike): Promise<CapabilitiesResponse> {
  const response = await fetchWithTimeout(fetch_, `${endpoint}/v1/capabilities`, {
    headers: { "Authorization": `Bearer ${token}` }
  }, 2_000);
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  const value = await response.json() as unknown;
  if (!isCapabilitiesResponse(value)) throw new Error("invalid capability response");
  return value;
}

function isCapabilitiesResponse(value: unknown): value is CapabilitiesResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.protocolVersion === PROTOCOL_VERSION
    && typeof record.runnerVersion === "string"
    && typeof record.engine === "string"
    && Array.isArray(record.languages)
    && record.languages.every((language) => typeof language === "string");
}

function isLocalRunResponse(value: unknown, language: string): value is LocalRunResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.language === language
    && typeof record.provider === "string"
    && typeof record.stdout === "string"
    && typeof record.stderr === "string"
    && typeof record.durationMs === "number"
    && Number.isFinite(record.durationMs)
    && typeof record.exitCode === "number"
    && Number.isInteger(record.exitCode);
}
