import { afterEach, describe, expect, it, vi } from "vitest";
import { App, MarkdownRenderChild, Plugin, type PluginManifest } from "obsidian";
import RunnableCodeBlocksPlugin from "../src/main";

const manifest: PluginManifest = {
  author: "Test",
  description: "Test manifest",
  id: "runnable-code-blocks",
  minAppVersion: "1.0.0",
  name: "Runnable Code Blocks",
  version: "0.0.0"
};

function createPlugin(): RunnableCodeBlocksPlugin {
  return new RunnableCodeBlocksPlugin(new App(), manifest);
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("Obsidian plugin boundary", () => {
  it("normalizes settings and registers the complete runnable fence catalog", async () => {
    vi.spyOn(Plugin.prototype, "loadData").mockResolvedValue({
      executionOrder: "private-first",
      remoteExecutionEnabled: false
    });
    const register = vi.spyOn(Plugin.prototype, "registerMarkdownCodeBlockProcessor");
    const addSettingTab = vi.spyOn(Plugin.prototype, "addSettingTab");
    const plugin = createPlugin();

    await plugin.onload();

    expect(plugin.settings).toEqual({
      executionOrder: "private-first",
      localExecutionEnabled: false,
      localRunnerEndpoint: "http://127.0.0.1:17171",
      remoteExecutionEnabled: false
    });
    expect(register).toHaveBeenCalledTimes(24);
    expect(register.mock.calls.map(([fence]) => fence)).toContain("run-react");
    expect(addSettingTab).toHaveBeenCalledOnce();
  });

  it("refreshes mounted blocks after settings save and forgets unloaded children", async () => {
    vi.spyOn(Plugin.prototype, "loadData").mockResolvedValue({
      executionOrder: "browser-first",
      remoteExecutionEnabled: false
    });
    const register = vi.spyOn(Plugin.prototype, "registerMarkdownCodeBlockProcessor");
    const saveData = vi.spyOn(Plugin.prototype, "saveData").mockResolvedValue();
    const plugin = createPlugin();
    await plugin.onload();
    const processor = register.mock.calls.find(([fence]) => fence === "run-html")?.[1];
    expect(processor).toBeDefined();
    const embed = document.body.appendChild(document.createElement("div"));
    embed.className = "cm-embed-block";
    const element = embed.appendChild(document.createElement("div"));
    const renderChild: { current: MarkdownRenderChild | null } = { current: null };
    await processor?.("<button>Hello</button>", element, {
      addChild(value) { renderChild.current = value; },
      docId: "test-document",
      frontmatter: null,
      getSectionInfo: () => null,
      sourcePath: "test.md"
    });
    await vi.waitFor(() => {
      expect(element.querySelector(".rcb__button--run")).not.toBeNull();
    });
    expect(embed.classList.contains("rcb-embed")).toBe(true);

    // Obsidian appends its edit control after the postprocessor mounts.
    const hostActions = embed.appendChild(document.createElement("div"));
    hostActions.className = "embed-actions";
    const nativeEdit = hostActions.appendChild(document.createElement("button"));
    nativeEdit.className = "edit-block-button";
    const editSource = vi.fn();
    nativeEdit.addEventListener("click", editSource);
    const actions = Array.from(element.querySelectorAll<HTMLButtonElement>(".rcb__actions button"));
    expect(actions.filter(button => !button.hidden).map(button => button.getAttribute("aria-label")).slice(0, 3))
      .toEqual(["Edit source", "Copy code", "Run code"]);
    actions[0]?.click();
    expect(editSource).toHaveBeenCalledOnce();

    plugin.settings.remoteExecutionEnabled = true;
    await plugin.saveSettings();
    expect(saveData).toHaveBeenLastCalledWith(plugin.settings);

    renderChild.current?.onunload();
    await plugin.saveSettings();
    expect(element.querySelector(".rcb")).toBeNull();
    expect(embed.classList.contains("rcb-embed")).toBe(false);
  });
});
