import type { CodeRunner } from "./contracts";
import { createRemoteRunner } from "./remote-runner-factory";
import { RunnerRegistry, UnavailableRunner } from "./runner-registry";
import { FallbackRunner } from "./runners/fallback-runner";
import { LocalCompanionRunner, DEFAULT_LOCAL_RUNNER_ENDPOINT } from "./runners/local-companion-runner";
import type { SupportedLanguage } from "./supported-languages";
import { browserRunners, personalCompilerRunner } from "./private-runner-composition";
import { createPolicyRunnerRegistry, type RunnerCompositionOptions, type RunnerCompositionOptionsSource } from "./runner-policy";
export type { ExecutionOrder, RunnerCompositionOptions, RunnerCompositionOptionsSource } from "./runner-policy";

export function createRunnerRegistry(options: RunnerCompositionOptionsSource = {}): RunnerRegistry {
  return createPolicyRunnerRegistry(options, composeLanguageRunner);
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
  const personalCompiler = personalCompilerRunner(language, options);
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
