export type ExecutionState = "not-started" | "unknown";

export class ProviderUnavailableError extends Error {
  readonly executionState: ExecutionState;

  constructor(message: string, executionState: ExecutionState) {
    super(message);
    this.name = "ProviderUnavailableError";
    this.executionState = executionState;
  }
}

export function unknownRemoteFailure(provider: string, cause: unknown): ProviderUnavailableError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new ProviderUnavailableError(
    `${provider} 응답을 확인하지 못했습니다. 중복 실행을 막기 위해 다른 fallback을 실행하지 않습니다. ${detail}`,
    "unknown"
  );
}
