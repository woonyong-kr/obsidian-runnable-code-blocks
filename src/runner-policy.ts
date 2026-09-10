import type { CodeRunner, RunContext } from "./contracts";
import { RunnerRegistry } from "./runner-registry";
import type { FetchLike } from "./runners/http-client";
import { ProviderUnavailableError } from "./runners/provider-errors";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "./supported-languages";

export type ExecutionOrder = "private-first" | "remote-first";

export interface RunnerCompositionOptions {
  executionOrder?: ExecutionOrder;
  fetch?: FetchLike;
  localExecutionEnabled?: boolean;
  localRunnerEndpoint?: string;
  localRunnerToken?: string;
  personalCompilerEnabled?: boolean;
  personalCompilerEndpoint?: string;
  remoteExecutionEnabled?: boolean;
}

export type RunnerCompositionOptionsSource =
  | RunnerCompositionOptions
  | (() => RunnerCompositionOptions);

type ComposeRunner = (language: SupportedLanguage, options: RunnerCompositionOptions) => CodeRunner;

export function createPolicyRunnerRegistry(options: RunnerCompositionOptionsSource, compose: ComposeRunner): RunnerRegistry {
  const registry = new RunnerRegistry();
  for (const language of SUPPORTED_LANGUAGES) {
    registry.register(language.id, () => typeof options === "function"
      ? new PolicyAwareRunner(language, options, compose)
      : compose(language, options));
  }
  return registry;
}

class PolicyAwareRunner implements CodeRunner {
  readonly language: string;
  readonly #definition: SupportedLanguage;
  readonly #options: () => RunnerCompositionOptions;
  readonly #compose: ComposeRunner;
  #policy: RunnerCompositionOptions | null = null;
  #runner: CodeRunner | null = null;
  #ready: CodeRunner | null = null;

  constructor(definition: SupportedLanguage, options: () => RunnerCompositionOptions, compose: ComposeRunner) {
    this.language = definition.id;
    this.#definition = definition;
    this.#options = options;
    this.#compose = compose;
  }

  get environment(): CodeRunner["environment"] {
    return this.#current().environment;
  }

  async availability(context?: RunContext) {
    const runner = this.#current();
    const status = await runner.availability(context);
    this.#ready = status.available && runner === this.#runner ? runner : null;
    return status;
  }

  async run(code: string, context?: RunContext) {
    const runner = this.#current();
    if (this.#ready !== runner) {
      const status = await runner.availability(context);
      if (!status.available) {
        throw new ProviderUnavailableError(status.detail, "not-started");
      }
    }
    this.#ready = null;
    return await runner.run(code, context);
  }

  dispose(): void {
    this.#runner?.dispose?.();
    this.#runner = null;
    this.#policy = null;
    this.#ready = null;
  }

  #current(): CodeRunner {
    const policy = this.#options();
    if (this.#runner === null || this.#policy === null || !samePolicy(this.#policy, policy)) {
      this.#runner?.dispose?.();
      this.#runner = this.#compose(this.#definition, policy);
      this.#policy = { ...policy };
      this.#ready = null;
    }
    return this.#runner;
  }
}

function samePolicy(left: RunnerCompositionOptions, right: RunnerCompositionOptions): boolean {
  return left.executionOrder === right.executionOrder &&
    left.fetch === right.fetch &&
    left.localExecutionEnabled === right.localExecutionEnabled &&
    left.localRunnerEndpoint === right.localRunnerEndpoint &&
    left.localRunnerToken === right.localRunnerToken &&
    left.personalCompilerEnabled === right.personalCompilerEnabled &&
    left.personalCompilerEndpoint === right.personalCompilerEndpoint &&
    left.remoteExecutionEnabled === right.remoteExecutionEnabled;
}
