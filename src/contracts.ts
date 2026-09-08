const RUNNABLE_PREFIX = "run-";

export type RunnerEnvironment = "browser" | "local" | "remote";

export interface RunnerAvailability {
  available: boolean;
  reason?: "offline" | "unsupported" | "misconfigured";
  detail: string;
}

export interface RunResult {
  durationMs: number;
  environment?: RunnerEnvironment;
  exitCode: number;
  failureReason?: "timeout" | "output-limit" | "out-of-memory" | "process-exit";
  provider?: string;
  preview?: {
    html: string;
    kind: "html";
    scripts: "blocked" | "isolated";
  };
  stderr: string;
  stdout: string;
}

export interface RunContext {
  signal?: AbortSignal;
  onCancellation?: (state: "pending" | "cancelled" | "completed" | "unknown") => void;
}

export function executionFailureReason(value: unknown): RunResult["failureReason"] {
  switch (value) {
    case "timeout": case "output-limit": case "out-of-memory": case "process-exit": return value;
    default: return undefined;
  }
}

export interface CodeRunner {
  readonly environment: RunnerEnvironment;
  readonly language: string;
  availability(context?: RunContext): Promise<RunnerAvailability>;
  run(code: string, context?: RunContext): Promise<RunResult>;
  dispose?(): void;
}

export interface RunnableBlockSpec {
  code: string;
  language: string;
  runner: CodeRunner;
}

export function parseRunnableFence(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized.startsWith(RUNNABLE_PREFIX)) return null;
  const language = normalized.slice(RUNNABLE_PREFIX.length);
  return /^[a-z][a-z0-9+#-]*$/.test(language) ? language : null;
}

export function fenceForLanguage(language: string): string {
  const parsed = parseRunnableFence(`${RUNNABLE_PREFIX}${language}`);
  if (parsed === null) throw new Error(`Invalid runnable language: ${language}`);
  return `${RUNNABLE_PREFIX}${parsed}`;
}
