import { parseRunnableFence } from "./contracts";
import { createRunnerRegistry, type RunnerCompositionOptions } from "./runner-composition";
import { RunnerRegistry, UnavailableRunner } from "./runner-registry";
import type { FetchLike } from "./runners/http-client";
import { normalizePublicRunnerEndpoint } from "./runners/personal-compiler-runner";
import { mountRunnableBlock, type MountedRunnableBlock } from "./ui";
import { appendElement } from "./dom";

export interface StaticWebRunnerOptions {
  fetch: FetchLike;
  personalCompilerEndpoint?: string;
  remoteExecutionEnabled?: boolean;
}

export function createStaticWebRunnerRegistry(options: StaticWebRunnerOptions): RunnerRegistry {
  const endpoint = normalizeOptionalEndpoint(options.personalCompilerEndpoint);
  const composition: RunnerCompositionOptions = {
    executionOrder: "private-first",
    fetch: options.fetch,
    personalCompilerEnabled: endpoint !== undefined,
    personalCompilerEndpoint: endpoint,
    remoteExecutionEnabled: options.remoteExecutionEnabled ?? true
  };
  return createRunnerRegistry(composition);
}

function fenceFromCodeElement(code: HTMLElement): string | null {
  for (const className of code.classList) {
    if (className.startsWith("language-")) return className.slice("language-".length);
  }
  return null;
}

export function enhanceRunnableCodeBlocks(
  root: ParentNode,
  registry: RunnerRegistry
): MountedRunnableBlock[] {
  const mounted: MountedRunnableBlock[] = [];
  for (const code of root.querySelectorAll<HTMLElement>("pre > code")) {
    const fence = fenceFromCodeElement(code);
    const language = fence === null ? null : parseRunnableFence(fence);
    if (language === null) continue;
    const pre = code.parentElement;
    if (pre === null) continue;
    const parent = pre.parentElement;
    if (parent === null) continue;
    const host = appendElement(parent, "div");
    pre.replaceWith(host);
    const runner =
      registry.create(language) ??
      new UnavailableRunner(
        language,
        "browser",
        `${language} has no browser runner in this build.`
      );
    mounted.push(mountRunnableBlock(host, { code: code.textContent, language, runner }));
  }
  return mounted;
}

function normalizeOptionalEndpoint(value: string | undefined): string | undefined {
  const endpoint = value?.trim();
  return endpoint === undefined || endpoint === "" ? undefined : normalizePublicRunnerEndpoint(endpoint);
}
