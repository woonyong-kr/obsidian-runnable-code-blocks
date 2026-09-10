import type { CodeRunner } from "./contracts";
import type { RunnerCompositionOptions } from "./runner-policy";
import { UnavailableRunner } from "./runner-registry";
import { BrowserPreviewRunner } from "./runners/browser-preview-runner";
import { BrowserJavaScriptRunner } from "./runners/javascript-runner";
import { BrowserTypeScriptRunner } from "./runners/typescript-runner";
import { PersonalCompilerRunner } from "./runners/personal-compiler-runner";
import type { BrowserAdapterId, SupportedLanguage } from "./supported-languages";

export function browserRunners(language: SupportedLanguage): CodeRunner[] {
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

export function personalCompilerRunner(language: SupportedLanguage, options: RunnerCompositionOptions): CodeRunner | null {
  if (!options.personalCompilerEnabled || language.localAdapter === undefined) return null;
  try {
    if (!options.personalCompilerEndpoint?.trim()) throw new Error("An explicit personal compiler endpoint is required.");
    return new PersonalCompilerRunner({ endpoint: options.personalCompilerEndpoint, fetch: options.fetch, language: language.id });
  } catch (error) {
    return new UnavailableRunner(language.id, "remote", error instanceof Error ? error.message : "Invalid personal compiler configuration.", "misconfigured");
  }
}
