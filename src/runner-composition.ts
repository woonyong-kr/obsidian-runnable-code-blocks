import type { CodeRunner, RunContext } from "./contracts";
import { createRemoteRunner } from "./remote-runner-factory";
import { RunnerRegistry, UnavailableRunner } from "./runner-registry";
import { BrowserPreviewRunner } from "./runners/browser-preview-runner";
import { FallbackRunner } from "./runners/fallback-runner";
import type { FetchLike } from "./runners/http-client";
import { BrowserJavaScriptRunner } from "./runners/javascript-runner";
import { LocalCompanionRunner, DEFAULT_LOCAL_RUNNER_ENDPOINT } from "./runners/local-companion-runner";
import { PersonalCompilerRunner } from "./runners/personal-compiler-runner";
import { BrowserTypeScriptRunner } from "./runners/typescript-runner";
import { ProviderUnavailableError } from "./runners/provider-errors";
import {
  SUPPORTED_LANGUAGES,
  type BrowserAdapterId,
  type SupportedLanguage
} from "./supported-languages";

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

export function createRunnerRegistry(options: RunnerCompositionOptionsSource = {}): RunnerRegistry {
  const registry = new RunnerRegistry();
  for (const language of SUPPORTED_LANGUAGES) {
    registry.register(language.id, () => typeof options === "function"
      ? new PolicyAwareRunner(language, options)
      : composeLanguageRunner(language, options));
  }
  return registry;
}

class PolicyAwareRunner implements CodeRunner {
  readonly language: string;
  readonly #definition: SupportedLanguage;
  readonly #options: () => RunnerCompositionOptions;
  #policy: RunnerCompositionOptions | null = null;
  #runner: CodeRunner | null = null;
  #ready: CodeRunner | null = null;

  constructor(definition: SupportedLanguage, options: () => RunnerCompositionOptions) {
    this.language = definition.id;
    this.#definition = definition;
    this.#options = options;
  }

  get environment(): CodeRunner["environment"] {
    return this.#current().environment;
  }

  async availability() {
    const runner = this.#current();
    const status = await runner.availability();
    this.#ready = status.available && runner === this.#runner ? runner : null;
    return status;
  }

  async run(code: string, context?: RunContext) {
    const runner = this.#current();
    if (this.#ready !== runner) {
      const status = await runner.availability();
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
      this.#runner = composeLanguageRunner(this.#definition, policy);
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

export function composeLanguageRunner(
  language: SupportedLanguage,
  options: RunnerCompositionOptions = {}
): CodeRunner {
  const remote = options.remoteExecutionEnabled === false ? null : createRemoteRunner(language, options.fetch);
  const browser = browserRunners(language);
  const local = options.localExecutionEnabled === true && language.localAdapter !== undefined
    ? new LocalCompanionRunner({
        endpoint: options.localRunnerEndpoint ?? DEFAULT_LOCAL_RUNNER_ENDPOINT,
        fetch: options.fetch,
        language: language.id,
        token: options.localRunnerToken ?? ""
      })
    : null;
  if (options.personalCompilerEnabled && !options.personalCompilerEndpoint?.trim()) {
    throw new Error("An explicit personal compiler endpoint is required.");
  }
  const personalCompiler = options.personalCompilerEnabled === true && options.personalCompilerEndpoint && language.localAdapter !== undefined
    ? new PersonalCompilerRunner({
        endpoint: options.personalCompilerEndpoint,
        fetch: options.fetch,
        language: language.id
      })
    : null;
  const privateRunners = [
    ...browser,
    ...(local === null ? [] : [local]),
    ...(personalCompiler === null ? [] : [personalCompiler])
  ];
  const ordered = options.executionOrder === "private-first"
    ? [...privateRunners, ...(remote === null ? [] : [remote])]
    : [...(remote === null ? [] : [remote]), ...privateRunners];
  if (ordered.length === 0) {
    return new UnavailableRunner(
      language.id,
      "browser",
      `${language.label} 실행 provider가 이 환경에 구성되지 않았습니다.`
    );
  }
  const only = ordered[0];
  return ordered.length === 1 && only !== undefined ? only : new FallbackRunner(language.id, ordered);
}

function browserRunners(language: SupportedLanguage): CodeRunner[] {
  return language.browserAdapter === undefined
    ? []
    : [BROWSER_FACTORIES[language.browserAdapter]()];
}

const BROWSER_FACTORIES: Record<BrowserAdapterId, () => CodeRunner> = {
  "css-preview": () => new BrowserPreviewRunner("css"),
  "html-preview": () => new BrowserPreviewRunner("html"),
  "javascript-worker": () => new BrowserJavaScriptRunner(),
  "react-preview": () => new BrowserPreviewRunner("react"),
  "typescript-worker": () => new BrowserTypeScriptRunner(),
  "web-preview": () => new BrowserPreviewRunner("web"),
  "web-ts-preview": () => new BrowserPreviewRunner("web-ts")
};
