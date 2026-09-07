import { App, Plugin, PluginSettingTab, SecretComponent, type SettingDefinitionItem } from "obsidian";
import type { ExecutionOrder } from "./runner-composition";
import { supportedLanguagesDescription } from "./supported-languages";

export interface RunnableCodeBlocksSettings {
  executionOrder: ExecutionOrder;
  localExecutionEnabled: boolean;
  localRunnerEndpoint: string;
  remoteExecutionEnabled: boolean;
}

export const LOCAL_RUNNER_SECRET_ID = "runnable-code-blocks-local-runner-token";
const DEFAULT_LOCAL_RUNNER_ENDPOINT = "http://127.0.0.1:17171";

export const DEFAULT_SETTINGS: RunnableCodeBlocksSettings = {
  executionOrder: "private-first",
  localExecutionEnabled: false,
  localRunnerEndpoint: DEFAULT_LOCAL_RUNNER_ENDPOINT,
  remoteExecutionEnabled: true
};

export function normalizeSettings(value: unknown): RunnableCodeBlocksSettings {
  const stored = isRecord(value) ? value : {};
  return {
    executionOrder: stored.executionOrder === "browser-first" || stored.executionOrder === "private-first"
      ? "private-first"
      : stored.executionOrder === "remote-first"
        ? "remote-first"
        : DEFAULT_SETTINGS.executionOrder,
    localExecutionEnabled: typeof stored.localExecutionEnabled === "boolean"
      ? stored.localExecutionEnabled
      : DEFAULT_SETTINGS.localExecutionEnabled,
    localRunnerEndpoint: normalizeLocalEndpoint(stored.localRunnerEndpoint),
    remoteExecutionEnabled: typeof stored.remoteExecutionEnabled === "boolean"
      ? stored.remoteExecutionEnabled
      : DEFAULT_SETTINGS.remoteExecutionEnabled
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
        desc: "Paste the token printed by the local runner. It is stored in Obsidian SecretStorage, not plugin data.json.",
        visible: () => this.#plugin.settings.localExecutionEnabled,
        render: (setting) => {
          new SecretComponent(this.app, setting.controlEl)
            .setValue(this.app.secretStorage.getSecret(LOCAL_RUNNER_SECRET_ID) ?? "")
            .onChange((value) => {
              this.app.secretStorage.setSecret(LOCAL_RUNNER_SECRET_ID, value.trim());
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
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")) {
      return "Use an http://127.0.0.1 or http://localhost endpoint.";
    }
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return "Remove credentials, paths, query parameters, and fragments.";
    }
    return undefined;
  } catch {
    return "Enter a valid loopback URL.";
  }
}
