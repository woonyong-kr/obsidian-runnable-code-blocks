import { normalizeLoopbackEndpoint, DEFAULT_LOCAL_RUNNER_ENDPOINT } from "./runners/local-companion-runner";
import { App, Plugin, PluginSettingTab, SecretComponent, type SettingDefinitionItem } from "obsidian";
import type { ExecutionOrder } from "./runner-composition";
import { supportedLanguagesDescription } from "./supported-languages";

export interface RunnableCodeBlocksSettings {
  executionOrder: ExecutionOrder;
  localExecutionEnabled: boolean;
  localRunnerEndpoint: string;
  localRunnerSecretId: string;
  remoteExecutionEnabled: boolean;
}

export const LOCAL_RUNNER_SECRET_ID = "runnable-code-blocks-local-runner-token";

export const DEFAULT_SETTINGS: RunnableCodeBlocksSettings = {
  executionOrder: "private-first",
  localExecutionEnabled: false,
  localRunnerEndpoint: DEFAULT_LOCAL_RUNNER_ENDPOINT,
  localRunnerSecretId: LOCAL_RUNNER_SECRET_ID,
  remoteExecutionEnabled: true
};

export function normalizeSettings(value: unknown): RunnableCodeBlocksSettings {
  const stored = isRecord(value) ? value : {};
  const legacyLocalCompiler = [stored.kotlinCompilerPath, stored.javaPath]
    .some((path) => typeof path === "string" && path.trim().length > 0);
  return {
    executionOrder: stored.executionOrder === "browser-first" || stored.executionOrder === "private-first"
      ? "private-first"
      : stored.executionOrder === "remote-first"
        ? "remote-first"
        : DEFAULT_SETTINGS.executionOrder,
    localExecutionEnabled: typeof stored.localExecutionEnabled === "boolean"
      ? stored.localExecutionEnabled
      : legacyLocalCompiler || DEFAULT_SETTINGS.localExecutionEnabled,
    localRunnerEndpoint: normalizeLocalEndpoint(stored.localRunnerEndpoint),
    localRunnerSecretId: typeof stored.localRunnerSecretId === "string"
      && /^[a-z0-9-]*$/u.test(stored.localRunnerSecretId)
      ? stored.localRunnerSecretId : LOCAL_RUNNER_SECRET_ID,
    remoteExecutionEnabled: typeof stored.remoteExecutionEnabled === "boolean"
      ? stored.remoteExecutionEnabled
      : !legacyLocalCompiler && DEFAULT_SETTINGS.remoteExecutionEnabled
  };
}

type RunnableSettingKey = keyof RunnableCodeBlocksSettings;

export class RunnableCodeBlocksSettingTab extends PluginSettingTab {
  readonly #plugin: Plugin & {
    settings: RunnableCodeBlocksSettings;
    saveSettings(): Promise<void>;
  };

  constructor(app: App, plugin: Plugin & { settings: RunnableCodeBlocksSettings; saveSettings(): Promise<void> }) {
    super(app, plugin);
    this.#plugin = plugin;
  }

  override getSettingDefinitions(): SettingDefinitionItem<RunnableSettingKey>[] {
    return [
      {
        name: "Supported languages",
        desc: supportedLanguagesDescription()
      },
      {
        name: "Local runner",
        desc: "Use the optional loopback companion on desktop. It runs digest-pinned containers with network and resource limits; the plugin never installs runtimes.",
        control: {
          defaultValue: DEFAULT_SETTINGS.localExecutionEnabled,
          key: "localExecutionEnabled",
          type: "toggle"
        }
      },
      {
        name: "Local runner endpoint",
        desc: "Only a loopback HTTP endpoint is accepted. The default companion listens on 127.0.0.1 and is never exposed to the LAN or internet.",
        visible: () => this.#plugin.settings.localExecutionEnabled,
        control: {
          defaultValue: DEFAULT_SETTINGS.localRunnerEndpoint,
          key: "localRunnerEndpoint",
          placeholder: DEFAULT_LOCAL_RUNNER_ENDPOINT,
          type: "text",
          validate: (value) => validateLocalEndpoint(value)
        }
      },
      {
        name: "Pairing token",
        desc: "Select or create a secret containing the local runner token. Only its name is saved in plugin settings; the token stays in Obsidian SecretStorage.",
        visible: () => this.#plugin.settings.localExecutionEnabled,
        render: (setting) => {
          new SecretComponent(this.app, setting.controlEl)
            .setValue(this.#plugin.settings.localRunnerSecretId)
            .onChange((value) => {
              this.#plugin.settings.localRunnerSecretId = value;
              void this.#plugin.saveSettings();
            });
        }
      },
      {
        name: "Remote execution",
        desc: "Wandbox, Kotlin Playground, SwiftFiddle, and DartPad can receive source code. Disable this for browser/local-only execution.",
        control: {
          defaultValue: DEFAULT_SETTINGS.remoteExecutionEnabled,
          key: "remoteExecutionEnabled",
          type: "toggle"
        }
      },
      {
        name: "Provider order",
        desc: "Private first uses browser or local execution before uploading source. Remote first preserves the public Wiki order.",
        control: {
          defaultValue: DEFAULT_SETTINGS.executionOrder,
          key: "executionOrder",
          options: {
            "private-first": "Browser/local → remote",
            "remote-first": "Remote → browser/local"
          },
          type: "dropdown"
        }
      }
    ];
  }

  override getControlValue(key: string): unknown {
    if (
      key === "executionOrder"
      || key === "localExecutionEnabled"
      || key === "localRunnerEndpoint"
      || key === "remoteExecutionEnabled"
    ) {
      return this.#plugin.settings[key];
    }
    return undefined;
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "localExecutionEnabled" && typeof value === "boolean") {
      this.#plugin.settings.localExecutionEnabled = value;
    } else if (key === "localRunnerEndpoint" && typeof value === "string" && validateLocalEndpoint(value) === undefined) {
      this.#plugin.settings.localRunnerEndpoint = new URL(value.trim()).origin;
    } else if (key === "remoteExecutionEnabled" && typeof value === "boolean") {
      this.#plugin.settings.remoteExecutionEnabled = value;
    } else if (key === "executionOrder" && (value === "remote-first" || value === "private-first")) {
      this.#plugin.settings.executionOrder = value;
    } else {
      return;
    }
    await this.#plugin.saveSettings();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLocalEndpoint(value: unknown): string {
  if (typeof value !== "string" || validateLocalEndpoint(value) !== undefined) {
    return DEFAULT_LOCAL_RUNNER_ENDPOINT;
  }
  return new URL(value.trim()).origin;
}

function validateLocalEndpoint(value: string): string | undefined {
  try { normalizeLoopbackEndpoint(value); return undefined; }
  catch (error) { return error instanceof Error ? error.message : "Enter a valid loopback URL."; }
}
