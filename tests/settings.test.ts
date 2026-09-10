import { App, SecretComponent, Setting, type Plugin, type SettingGroup } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  LOCAL_RUNNER_SECRET_ID,
  normalizeSettings,
  RunnableCodeBlocksSettingTab,
  type RunnableCodeBlocksSettings
} from "../src/settings";

describe("normalizeSettings", () => {
  it("uses safe defaults for missing or malformed data", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings([])).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ executionOrder: "unknown", localRunnerEndpoint: "https://example.com", remoteExecutionEnabled: "yes" }))
      .toEqual(DEFAULT_SETTINGS);
  });

  it("preserves the old private-first value as browser-first", () => {
    expect(normalizeSettings({ executionOrder: "private-first", remoteExecutionEnabled: false }))
      .toEqual({ ...DEFAULT_SETTINGS, executionOrder: "private-first", remoteExecutionEnabled: false });
  });

  it("accepts current settings", () => {
    expect(normalizeSettings({ executionOrder: "browser-first", localExecutionEnabled: true, localRunnerEndpoint: "http://localhost:17171", remoteExecutionEnabled: true }))
      .toEqual({
        ...DEFAULT_SETTINGS,
        executionOrder: "private-first",
        localExecutionEnabled: true,
        localRunnerEndpoint: "http://localhost:17171",
        remoteExecutionEnabled: true
      });
  });

  it("preserves selected and cleared secret references while retaining the legacy default", () => {
    expect(normalizeSettings({}).localRunnerSecretId).toBe(LOCAL_RUNNER_SECRET_ID);
    expect(normalizeSettings({ localRunnerSecretId: "chosen-runner" }).localRunnerSecretId).toBe("chosen-runner");
    expect(normalizeSettings({ localRunnerSecretId: "" }).localRunnerSecretId).toBe("");
  });

  it.each(["kotlinCompilerPath", "javaPath"])("keeps legacy %s users local-only until the companion is paired", (key) => {
    expect(normalizeSettings({ [key]: "/local/compiler" })).toEqual({
      ...DEFAULT_SETTINGS,
      localExecutionEnabled: true,
      remoteExecutionEnabled: false
    });
  });

  it("preserves explicit execution choices when legacy paths remain", () => {
    expect(normalizeSettings({ kotlinCompilerPath: "/local/compiler", localExecutionEnabled: false,
      remoteExecutionEnabled: true, executionOrder: "remote-first" })).toEqual({
      ...DEFAULT_SETTINGS,
      executionOrder: "remote-first"
    });
    expect(normalizeSettings({ kotlinCompilerPath: " ", javaPath: null })).toEqual(DEFAULT_SETTINGS);
  });
});

describe("RunnableCodeBlocksSettingTab", () => {
  function createTab() {
    const settings: RunnableCodeBlocksSettings = { ...DEFAULT_SETTINGS };
    const saveSettings = vi.fn(async () => undefined);
    const plugin = { saveSettings, settings } as unknown as Plugin & {
      saveSettings(): Promise<void>;
      settings: RunnableCodeBlocksSettings;
    };
    return { saveSettings, settings, tab: new RunnableCodeBlocksSettingTab(new App(), plugin) };
  }

  it("selects a secret by name without exposing or overwriting its value", async () => {
    const { tab, settings, saveSettings } = createTab();
    tab.app.secretStorage.setSecret(LOCAL_RUNNER_SECRET_ID, "existing-token-value");
    tab.app.secretStorage.setSecret("chosen-runner", "chosen-token-value");
    const setSecret = vi.spyOn(tab.app.secretStorage, "setSecret");
    const setValue = vi.spyOn(SecretComponent.prototype, "setValue");
    let select: ((value: string) => unknown) | undefined;
    const change = vi.spyOn(SecretComponent.prototype, "onChange").mockImplementation(function (this: SecretComponent, callback) {
      select = callback;
      return this;
    });
    try {
      const definition = tab.getSettingDefinitions().find(item => "name" in item && item.name === "Pairing token");
      if (!definition || !("render" in definition) || !definition.render) throw new Error("Missing secret selector");
      definition.render(new Setting(document.createElement("div")), {} as SettingGroup);
      expect(setValue).toHaveBeenCalledWith(LOCAL_RUNNER_SECRET_ID);
      await select?.("chosen-runner");
      expect(settings).toMatchObject({ localRunnerSecretId: "chosen-runner" });
      expect(saveSettings).toHaveBeenCalledOnce();
      expect(setSecret).not.toHaveBeenCalled();
      expect(tab.app.secretStorage.getSecret(LOCAL_RUNNER_SECRET_ID)).toBe("existing-token-value");
    } finally {
      setSecret.mockRestore(); setValue.mockRestore(); change.mockRestore();
    }
  });

  it("describes the shared language catalog and both execution controls", () => {
    const { tab } = createTab();

    expect(tab.getSettingDefinitions().map((definition) =>
      "name" in definition ? definition.name : undefined
    )).toEqual([
      "Supported languages",
      "Local runner",
      "Local runner endpoint",
      "Pairing token",
      "Remote execution",
      "Provider order"
    ]);
    expect(tab.getControlValue("localExecutionEnabled")).toBe(false);
    expect(tab.getControlValue("localRunnerEndpoint")).toBe("http://127.0.0.1:17171");
    expect(tab.getControlValue("remoteExecutionEnabled")).toBe(true);
    expect(tab.getControlValue("executionOrder")).toBe("private-first");
    expect(tab.getControlValue("unknown")).toBeUndefined();
  });

  it("persists only valid control values", async () => {
    const { saveSettings, settings, tab } = createTab();

    await tab.setControlValue("localExecutionEnabled", true);
    await tab.setControlValue("localRunnerEndpoint", "http://localhost:19191");
    await tab.setControlValue("remoteExecutionEnabled", false);
    await tab.setControlValue("executionOrder", "remote-first");
    await tab.setControlValue("executionOrder", "invalid");
    await tab.setControlValue("unknown", true);

    expect(settings).toEqual({
      ...DEFAULT_SETTINGS,
      executionOrder: "remote-first",
      localExecutionEnabled: true,
      localRunnerEndpoint: "http://localhost:19191",
      remoteExecutionEnabled: false
    });
    expect(saveSettings).toHaveBeenCalledTimes(4);
  });
});
