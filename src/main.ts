import { MarkdownRenderChild, Plugin } from "obsidian";
import { fenceForLanguage } from "./contracts";
import { obsidianFetch } from "./obsidian-fetch";
import { createRunnerRegistry } from "./runner-composition";
import type { RunnerRegistry } from "./runner-registry";
import {
  DEFAULT_SETTINGS,
  LOCAL_RUNNER_SECRET_ID,
  RunnableCodeBlocksSettingTab,
  normalizeSettings,
  type RunnableCodeBlocksSettings
} from "./settings";
import { mountRunnableBlock, type MountedRunnableBlock } from "./ui";

class RunnableRenderChild extends MarkdownRenderChild {
  #mounted: MountedRunnableBlock | null = null;
  #embed: Element | null = null;
  readonly #onUnload: (child: RunnableRenderChild) => void;

  constructor(containerEl: HTMLElement, onUnload: (child: RunnableRenderChild) => void) {
    super(containerEl);
    this.#onUnload = onUnload;
  }

  mount(source: string, language: string, registry: RunnerRegistry): void {
    const runner = registry.create(language);
    if (runner === null) throw new Error(`Missing registered runner for ${language}`);
    const embed = this.containerEl.closest(".cm-embed-block");
    this.#mounted = mountRunnableBlock(this.containerEl, { code: source, language, runner }, embed ? {
      onEditSource: () => embed.querySelector<HTMLElement>(":scope > .embed-actions .edit-block-button")?.click()
    } : {});
    this.#embed = embed;
    embed?.classList.add("rcb-embed");
  }

  override onunload(): void {
    this.#mounted?.dispose();
    this.#mounted = null;
    if (!this.#embed?.querySelector(".rcb__button--source")) this.#embed?.classList.remove("rcb-embed");
    this.#embed = null;
    this.#onUnload(this);
  }

  async refreshAvailability(): Promise<void> {
    await this.#mounted?.refreshAvailability();
  }
}

export default class RunnableCodeBlocksPlugin extends Plugin {
  override settings: RunnableCodeBlocksSettings = { ...DEFAULT_SETTINGS };
  readonly #renderChildren = new Set<RunnableRenderChild>();

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new RunnableCodeBlocksSettingTab(this.app, this));
    const registry = createRunnerRegistry(() => ({
      executionOrder: this.settings.executionOrder,
      fetch: obsidianFetch,
      localExecutionEnabled: this.settings.localExecutionEnabled,
      localRunnerEndpoint: this.settings.localRunnerEndpoint,
      localRunnerToken: this.app.secretStorage.getSecret(LOCAL_RUNNER_SECRET_ID) ?? "",
      remoteExecutionEnabled: this.settings.remoteExecutionEnabled
    }));

    for (const language of registry.languages()) {
      this.registerMarkdownCodeBlockProcessor(
        fenceForLanguage(language),
        (source, element, context) => {
          const child = new RunnableRenderChild(element, (unloaded) => this.#renderChildren.delete(unloaded));
          this.#renderChildren.add(child);
          child.mount(source, language, registry);
          context.addChild(child);
        }
      );
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    await Promise.all([...this.#renderChildren].map(async (child) => await child.refreshAvailability()));
  }
}
