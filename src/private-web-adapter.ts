import type { FetchLike } from "./runners/http-client";
import { browserRunners, personalCompilerRunner } from "./private-runner-composition";
import { createPolicyRunnerRegistry } from "./runner-policy";
import { UnavailableRunner } from "./runner-registry";

export interface PrivateWebRunnerOptions {
  fetch: FetchLike;
  personalCompilerEndpoint?: string;
}

// This entry intentionally has no imports of public providers or the localhost companion.
export function createPrivateWebRunnerRegistry(options: PrivateWebRunnerOptions | (() => PrivateWebRunnerOptions)) {
  return createPolicyRunnerRegistry(() => {
    const current = typeof options === "function" ? options() : options;
    return { fetch: current.fetch, personalCompilerEndpoint: current.personalCompilerEndpoint, personalCompilerEnabled: true };
  }, (language, policy) => browserRunners(language)[0]
    ?? personalCompilerRunner(language, policy)
    ?? new UnavailableRunner(language.id, "browser", `${language.label} is not configured for this website.`));
}
