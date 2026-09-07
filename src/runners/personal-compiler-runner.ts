import type { CodeRunner, RunContext, RunResult, RunnerAvailability } from "../contracts";
import { fetchWithTimeout, type FetchLike, unavailableFetch } from "./http-client";
import { ProviderUnavailableError } from "./provider-errors";

const PROTOCOL_VERSION = 1;
const CAPABILITY_CACHE_MS = 3_000;
const OFFLINE_DETAIL = "개인 컴파일러가 잠시 쉬고 있어요. Java·Kotlin 등 일부 언어는 운영 비용을 줄이기 위해 개발자의 개인 실행 서버에서 처리됩니다. 서버가 다시 온라인이 되면 별도 설정 없이 실행할 수 있어요. JavaScript·TypeScript·브라우저 예제는 계속 실행됩니다.";
const capabilityCache = new Map<string, { expiresAt: number; value: Promise<CapabilitiesResponse> }>();
let fetchSequence = 0;
let fetchIds = new WeakMap<FetchLike, number>();

interface CapabilitiesResponse {
  languages: string[];
  protocolVersion: number;
  runnerVersion: string;
  service: "personal-compiler";
  status: "online";
}

interface PublicRunResponse {
  durationMs: number;
  exitCode: number;
  language: string;
  provider: string;
  stderr: string;
  stdout: string;
}

interface PublicErrorResponse {
  error?: string;
}

export interface PersonalCompilerOptions {
  endpoint: string;
  fetch?: FetchLike;
  language: string;
}

export class PersonalCompilerRunner implements CodeRunner {
  readonly environment = "remote" as const;
  readonly language: string;
  readonly #endpoint: string;
  readonly #fetch: FetchLike;

  constructor(options: PersonalCompilerOptions) {
    this.language = options.language;
    this.#endpoint = normalizePublicRunnerEndpoint(options.endpoint);
    this.#fetch = options.fetch ?? unavailableFetch;
  }

  async availability(): Promise<RunnerAvailability> {
    try {
      const capabilities = await cachedCapabilities(this.#endpoint, this.#fetch);
      if (!capabilities.languages.includes(this.language)) {
        return {
          available: false,
          detail: `개인 컴파일러는 온라인이지만 ${this.language} runtime을 아직 준비하지 않았어요.`
        };
      }
      return {
        available: true,
        detail: `Personal compiler ${capabilities.runnerVersion} · isolated container · network disabled`
      };
    } catch {
      return { available: false, detail: OFFLINE_DETAIL };
    }
  }

  async run(code: string, context?: RunContext): Promise<RunResult> {
    const requestId = crypto.randomUUID();
    let response: Response;
    try {
      response = await requestWithOneRetry(
        this.#fetch,
        `${this.#endpoint}/v1/run`,
        {
          body: JSON.stringify({ code, language: this.language }),
          headers: {
            "Content-Type": "application/json",
            "X-Runnable-Request-Id": requestId
          },
          method: "POST"
        },
        context?.signal
      );
    } catch {
      throw new ProviderUnavailableError(OFFLINE_DETAIL, "not-started");
    }
    if (!response.ok) {
      const detail = await publicError(response);
      if (response.status === 429) {
        throw new ProviderUnavailableError(
          "개인 컴파일러가 현재 다른 실행을 처리 중이에요. 잠시 후 다시 실행해 주세요.",
          "not-started"
        );
      }
      if ([403, 404, 409, 413, 503].includes(response.status)) {
        throw new ProviderUnavailableError(detail, "not-started");
      }
      throw new ProviderUnavailableError(detail, "unknown");
    }
    const value = await response.json() as unknown;
    if (!isPublicRunResponse(value, this.language)) {
      throw new ProviderUnavailableError("개인 컴파일러가 유효한 실행 결과를 반환하지 않았습니다.", "unknown");
    }
    return {
      durationMs: value.durationMs,
      environment: "remote",
      exitCode: value.exitCode,
      provider: value.provider,
      stderr: value.stderr,
      stdout: value.stdout
    };
  }
}

export function normalizePublicRunnerEndpoint(value: string): string {
  const url = new URL(value.trim());
  const localDevelopment = url.protocol === "http:"
    && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  if ((!localDevelopment && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("Public runner endpoint는 HTTPS 주소여야 합니다.");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Public runner endpoint에는 인증 정보, 경로, query, fragment를 넣을 수 없습니다.");
  }
  return url.origin;
}

export function resetPersonalCompilerCapabilityCache(): void {
  capabilityCache.clear();
  fetchIds = new WeakMap<FetchLike, number>();
  fetchSequence = 0;
}

async function cachedCapabilities(endpoint: string, fetch_: FetchLike): Promise<CapabilitiesResponse> {
  const key = `${endpoint}\n${String(fetchId(fetch_))}`;
  const now = Date.now();
  const cached = capabilityCache.get(key);
  if (cached !== undefined && cached.expiresAt > now) return await cached.value;
  const value = fetchCapabilities(endpoint, fetch_);
  capabilityCache.set(key, { expiresAt: now + CAPABILITY_CACHE_MS, value });
  try {
    return await value;
  } catch (error) {
    capabilityCache.delete(key);
    throw error;
  }
}

function fetchId(fetch_: FetchLike): number {
  const existing = fetchIds.get(fetch_);
  if (existing !== undefined) return existing;
  fetchSequence += 1;
  fetchIds.set(fetch_, fetchSequence);
  return fetchSequence;
}

async function fetchCapabilities(endpoint: string, fetch_: FetchLike): Promise<CapabilitiesResponse> {
  const response = await fetchWithTimeout(fetch_, `${endpoint}/v1/capabilities`, {}, 2_500);
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  const value = await response.json() as unknown;
  if (!isCapabilitiesResponse(value)) throw new Error("invalid capability response");
  return value;
}

async function requestWithOneRetry(
  fetch_: FetchLike,
  input: string,
  init: RequestInit,
  signal?: AbortSignal
): Promise<Response> {
  try {
    return await fetchWithTimeout(fetch_, input, init, 22_000, signal);
  } catch (firstError) {
    if (signal?.aborted === true) throw firstError;
    return await fetchWithTimeout(fetch_, input, init, 22_000, signal);
  }
}

async function publicError(response: Response): Promise<string> {
  try {
    const value = await response.json() as PublicErrorResponse;
    if (typeof value.error === "string" && value.error.trim() !== "") return value.error;
  } catch {
    // Fall through to the status-only message.
  }
  return `Personal compiler HTTP ${String(response.status)}`;
}

function isCapabilitiesResponse(value: unknown): value is CapabilitiesResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.protocolVersion === PROTOCOL_VERSION
    && record.service === "personal-compiler"
    && record.status === "online"
    && typeof record.runnerVersion === "string"
    && Array.isArray(record.languages)
    && record.languages.every((language) => typeof language === "string");
}

function isPublicRunResponse(value: unknown, language: string): value is PublicRunResponse {
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
