import type { RunnableBlockSpec, RunResult } from "./contracts";
import { BoundedOutput, OUTPUT_LIMITS } from "./output-buffer";
import {
  createRunnableEditor,
  EDITOR_TRAILING_BLANK_LINE_COUNT,
  type RunnableEditor
} from "./editor";
import { appendElement, appendSvgElement } from "./dom";
import { ProviderUnavailableError } from "./runners/provider-errors";

export interface MountedRunnableBlock {
  dispose(): void;
  refreshAvailability(): Promise<void>;
}

function element<K extends keyof HTMLElementTagNameMap>(
  parent: Node,
  name: K,
  className: string,
  text?: string
): HTMLElementTagNameMap[K] {
  return appendElement(parent, name, { className, text });
}

function svgIcon(parent: Node, pathData: string, className: string): SVGSVGElement {
  const icon = appendSvgElement(parent, "svg", className);
  icon.setAttribute("viewBox", "0 0 20 20");
  icon.setAttribute("aria-hidden", "true");
  const path = appendSvgElement(icon, "path");
  path.setAttribute("d", pathData);
  return icon;
}

const COPY_ICON = "M7 6V3h10v11h-3M3 7h10v10H3Z";

function setButtonIcon(button: HTMLButtonElement, label: string, path: string): void {
  button.title = label;
  button.setAttribute("aria-label", label);
  button.replaceChildren();
  svgIcon(button, path, "rcb__button-icon rcb__button-icon--outline");
}

function iconButton(parent: Node, className: string, label: string, path: string): HTMLButtonElement {
  const button = element(parent, "button", `rcb__button ${className}`);
  button.type = "button";
  setButtonIcon(button, label, path);
  return button;
}

function durationLabel(durationMs: number): string {
  if (durationMs >= 1000) return `${(durationMs / 1000).toFixed(2)} s`;
  return `${String(Math.round(durationMs))} ms`;
}

function environmentLabel(environment: RunnableBlockSpec["runner"]["environment"]): string {
  if (environment === "remote") return "Remote";
  if (environment === "local") return "Local";
  return "Browser";
}

function resultText(result: RunResult): string {
  const output = new BoundedOutput();
  if (result.stdout) output.append(result.stdout.trimEnd());
  if (result.stderr) output.append(result.stderr.trimEnd());
  return output.toString();
}

function withTrailingBlankLines(code: string, count = EDITOR_TRAILING_BLANK_LINE_COUNT): string {
  const trailingNewlines = code.match(/\n*$/u)?.[0].length ?? 0;
  return trailingNewlines >= count ? code : code + "\n".repeat(count - trailingNewlines);
}

function withoutTrailingDisplayLines(code: string): string {
  return code.replace(/\n+$/u, "");
}

export function mountRunnableBlock(host: HTMLElement, spec: RunnableBlockSpec): MountedRunnableBlock {
  const editorInitialCode = withTrailingBlankLines(spec.code);
  host.replaceChildren();
  const root = element(host, "section", "rcb");
  root.dataset.language = spec.language;
  root.dataset.environment = spec.runner.environment;

  const toolbar = element(root, "header", "rcb__toolbar");
  const identity = element(toolbar, "div", "rcb__identity");
  const languageIcon = element(identity, "span", "rcb__file-icon");
  svgIcon(languageIcon, "M7.25 5 3 10l4.25 5M12.75 5 17 10l-4.25 5", "rcb__icon");
  element(identity, "strong", "rcb__language", spec.language);
  const environment = element(identity, "span", "rcb__environment");
  element(environment, "span", "rcb__environment-dot");
  const environmentName = element(environment, "span", "rcb__environment-name");
  environmentName.textContent = environmentLabel(spec.runner.environment);

  const actions = element(toolbar, "div", "rcb__actions");
  const status = element(actions, "span", "rcb__status rcb__sr-only", "Checking runner availability");
  status.setAttribute("aria-live", "polite");
  const copyButton = iconButton(actions, "rcb__button--secondary", "Copy code", COPY_ICON);
  const resetButton = iconButton(actions, "rcb__button--secondary rcb__button--reset", "Reset", "M3 3v5h5M3 8a7 7 0 1 1 0 5");
  resetButton.hidden = true;
  const runButton = element(actions, "button", "rcb__button rcb__button--run");
  runButton.type = "button";
  runButton.disabled = true;
  runButton.title = "Run (⌘/Ctrl+Enter)";
  runButton.setAttribute("aria-label", "Run code");
  const runIcon = svgIcon(runButton, "M6.5 4.75v10.5L15 10 6.5 4.75Z", "rcb__button-icon rcb__button-icon--run");
  const runningIcon = svgIcon(runButton, "M10 3.25a6.75 6.75 0 1 1-5.4 2.7", "rcb__button-icon rcb__button-icon--running");
  runningIcon.setAttribute("hidden", "");

  const retryButton = iconButton(actions, "rcb__button--secondary rcb__button--retry", "Check again", "M17 3v5h-5M17 8a7 7 0 1 0 0 5");
  retryButton.hidden = true;
  const stopButton = iconButton(actions, "rcb__button--secondary rcb__button--stop", "Stop", "M4 4h12v12H4Z");
  stopButton.hidden = true;
  const editorHost = element(root, "div", "rcb__editor");
  const editingHint = element(root, "div", "rcb__editing-hint", "Temporary edits · Copy code to keep your changes.");
  editingHint.hidden = true;
  const notice = element(root, "div", "rcb__notice");
  notice.hidden = true;
  const consolePanel = element(root, "section", "rcb__console");
  consolePanel.hidden = true;
  const consoleHeader = element(consolePanel, "header", "rcb__console-header");
  const consoleTitle = element(consoleHeader, "span", "rcb__console-title", "Output");
  const consoleMeta = element(consoleHeader, "span", "rcb__console-meta", "");
  const diagnostics = element(consolePanel, "details", "rcb__details");
  element(diagnostics, "summary", "", "Execution details");
  const diagnosticText = element(diagnostics, "div", "rcb__diagnostic-text");
  const output = element(consolePanel, "pre", "rcb__output", "");
  output.setAttribute("aria-label", "Execution output");
  output.setAttribute("role", "log");
  const preview = element(consolePanel, "div", "rcb__preview");
  preview.hidden = true;

  const lifecycle = { disposed: false };
  let running = false;
  let executionId = 0;
  let previewActive = false;
  let retryAt = 0;
  let retryTimer: number | undefined;
  root.dataset.state = "checking";
  let available = false;
  let availabilityDetail = "";
  let availabilityRequest = 0;
  let checkingAvailability = false;
  let disposePreview: () => void = () => undefined;
  let executionController: AbortController | null = null;

  const setDirty = (dirty: boolean) => {
    resetButton.hidden = !dirty;
    editingHint.hidden = !dirty;
    setButtonIcon(copyButton, "Copy code", COPY_ICON);
    root.dataset.dirty = dirty ? "true" : "false";
  };

  const setRunning = (value: boolean) => {
    runButton.disabled = value || !available || Date.now() < retryAt;
    stopButton.hidden = !value && !previewActive;
    retryButton.disabled = value || checkingAvailability || Date.now() < retryAt;
    resetButton.disabled = value;
    runButton.setAttribute("aria-busy", value ? "true" : "false");
    root.setAttribute("aria-busy", value ? "true" : "false");
    runIcon.toggleAttribute("hidden", value);
    runningIcon.toggleAttribute("hidden", !value);
    runButton.setAttribute("aria-label", value ? "Running code" : "Run code");
    runButton.title = value ? "Running code" : "Run (⌘/Ctrl+Enter)";
  };

  const applyAvailabilityState = () => {
    runButton.disabled = running || !available || Date.now() < retryAt;
    retryButton.hidden = available && Date.now() >= retryAt;
    retryButton.disabled = running || checkingAvailability || Date.now() < retryAt;
    status.title = availabilityDetail;
    status.setAttribute("aria-label", available
      ? `Ready to run. ${availabilityDetail}`
      : `Runner unavailable. ${availabilityDetail}`);
    environment.title = availabilityDetail;
    notice.hidden = available;
    notice.textContent = available ? "" : availabilityDetail;
    if (!available) {
      root.dataset.state = "unavailable";
      status.textContent = "Runner unavailable";
    } else if (!running && ["checking", "unavailable"].includes(root.dataset.state ?? "")) {
      root.dataset.state = "idle";
      status.textContent = "Ready to run";
    }
  };

  const refreshAvailability = async (signal?: AbortSignal): Promise<boolean> => {
    if (Date.now() < retryAt || lifecycle.disposed) return false;
    const request = ++availabilityRequest;
    checkingAvailability = true;
    retryButton.disabled = true;
    try {
      const runnerStatus = await spec.runner.availability({ signal });
      if (lifecycle.disposed || signal?.aborted === true || request !== availabilityRequest) return false;
      available = runnerStatus.available;
      availabilityDetail = runnerStatus.detail;
    } catch (error) {
      if (lifecycle.disposed || signal?.aborted === true || request !== availabilityRequest) return false;
      available = false;
      availabilityDetail = error instanceof Error ? error.message : String(error);
    }
    checkingAvailability = false;
    applyAvailabilityState();
    return available;
  };

  const run = async () => {
    if (lifecycle.disposed || running || !available || Date.now() < retryAt) return;
    running = true;
    const id = ++executionId;
    const controller = new AbortController();
    executionController = controller;
    const current = () => !lifecycle.disposed && id === executionId && !controller.signal.aborted;
    previewActive = false;
    setRunning(true);
    root.dataset.state = "running";
    status.textContent = "Running code";
    disposePreview();
    preview.replaceChildren();
    preview.hidden = true;
    try {
      if (!await refreshAvailability(controller.signal) || !current()) {
        if (current()) consolePanel.hidden = true;
        return;
      }
      root.dataset.environment = spec.runner.environment;
      environmentName.textContent = environmentLabel(spec.runner.environment);
      consolePanel.hidden = false;
      consoleTitle.textContent = "Output";
      diagnosticText.textContent = availabilityDetail;
      consoleMeta.textContent = "Running…";
      consoleMeta.title = availabilityDetail;
      output.hidden = false;
      output.textContent = "Waiting for result…";
      const result = await spec.runner.run(
        withoutTrailingDisplayLines(editor.getValue()),
        { signal: controller.signal, onCancellation: (state) => {
          // Stop advances the generation once. A new Run/Reset/dispose invalidates this acknowledgement.
          if (lifecycle.disposed || executionId !== id + 1 || root.dataset.state !== "cancelled") return;
          if (state === "pending") {
            consoleMeta.textContent = "Cancelling"; output.textContent = "Requesting server cancellation…"; return;
          }
          consoleMeta.textContent = state === "cancelled" ? "Cancelled" : state === "completed" ? "Already completed" : "Cancellation unconfirmed";
          output.textContent = state === "cancelled" ? "Server execution cancelled; container removed."
            : state === "completed" ? "The server execution had already completed."
            : "Stopped waiting. Server cancellation could not be confirmed; its execution limit still applies.";
        } }
      );
      if (!current()) return;
      const resultEnvironment = result.environment ?? spec.runner.environment;
      root.dataset.environment = resultEnvironment;
      environmentName.textContent = environmentLabel(resultEnvironment);
      const outcome = result.exitCode === 0 ? "Success" : "Failed";
      const duration = durationLabel(result.durationMs);
      const finalizeResult = () => {
        root.dataset.state = result.exitCode === 0 ? "success" : "error";
        status.textContent = `${outcome} in ${duration}`;
        status.title = result.provider ?? availabilityDetail;
        status.setAttribute("aria-label", status.textContent);
        consoleMeta.textContent = outcome;
        diagnosticText.textContent = `${duration} · ${result.provider ?? availabilityDetail}`;
        consoleMeta.title = result.provider ?? "";
      };
      const text = resultText(result);
      output.hidden = result.preview !== undefined && text === "";
      output.textContent = text || (result.preview === undefined ? "Process finished with no output." : "");
      if (result.preview !== undefined) {
        const previewLogs = new BoundedOutput();
        let flushPending = false;
        let previewFailed = false;
        status.textContent = "Starting interactive preview";
        consoleMeta.textContent = "Starting preview…";
        const previewHandle = renderPreview(preview, result.preview, ({ message, type }) => {
          if (!current()) return;
          if (type === "ready") return;
          previewLogs.append(message);
          output.hidden = false;
          if (!flushPending) {
            flushPending = true;
            queueMicrotask(() => {
              flushPending = false;
              if (current()) output.textContent = previewLogs.toString();
            });
          }
          if (type === "error") {
            previewFailed = true;
            root.dataset.state = "error";
            status.textContent = "Interactive preview reported an error";
            consoleMeta.textContent = "Runtime error · interactive browser sandbox";
          }
        });
        previewActive = true;
        disposePreview = () => { previewHandle.dispose(); previewActive = false; };
        await previewHandle.ready;
        if (current() && !previewFailed) {
          finalizeResult();
          status.textContent = "Preview ready";
          status.setAttribute("aria-label", "Preview ready");
          consoleMeta.textContent = "Preview ready";
        }
      } else {
        finalizeResult();
      }
    } catch (error) {
      if (!current()) return;
      if (error instanceof ProviderUnavailableError && error.executionState === "not-started") {
        retryAt = Date.now() + (error.retryAfterMs ?? 0);
        window.clearTimeout(retryTimer);
        if (retryAt > Date.now()) retryTimer = window.setTimeout(() => {
          if (!lifecycle.disposed) applyAvailabilityState();
        }, Math.min(2_147_483_647, retryAt - Date.now()));
        available = false;
        availabilityDetail = error.retryAfterMs ? `${error.message} Try again in ${String(Math.ceil(error.retryAfterMs / 1000))} seconds.` : error.message;
        consolePanel.hidden = true;
        applyAvailabilityState();
        return;
      }
      root.dataset.state = "error";
      status.textContent = "Runner error";
      consoleMeta.textContent = "Runner error";
      output.hidden = false;
      output.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      if (id === executionId) {
        executionController = null;
        running = false;
        if (!lifecycle.disposed) setRunning(false);
      }
    }
  };

  stopButton.addEventListener("click", () => {
    executionId += 1;
    availabilityRequest += 1;
    checkingAvailability = false;
    executionController?.abort();
    executionController = null;
    disposePreview();
    preview.hidden = true;
    running = false;
    setRunning(false);
    root.dataset.state = "cancelled";
    status.textContent = "Cancelled";
    consolePanel.hidden = false;
    consoleMeta.textContent = "Cancelled";
    output.hidden = false;
    output.textContent = spec.runner.environment !== "browser"
      ? "Stopped waiting for the execution response."
      : "Execution or preview stopped.";
  });
  retryButton.addEventListener("click", () => { if (!running && !checkingAvailability) void refreshAvailability(); });

  const editor: RunnableEditor = createRunnableEditor(
    editorHost,
    editorInitialCode,
    spec.language,
    () => void run(),
    (value) => setDirty(value !== editorInitialCode)
  );
  copyButton.addEventListener("click", () => {
    copyButton.disabled = true;
    void Promise.resolve().then(() => navigator.clipboard.writeText(withoutTrailingDisplayLines(editor.getValue()))).then(() => {
      if (!lifecycle.disposed) { setButtonIcon(copyButton, "Copied", "M4 10l4 4 8-8"); status.textContent = "Code copied"; }
    }).catch(() => {
      if (!lifecycle.disposed) { notice.hidden = false; notice.textContent = "Copy unavailable. Select the code and copy it with your keyboard."; }
    }).finally(() => { if (!lifecycle.disposed) copyButton.disabled = false; });
  });
  runButton.addEventListener("click", () => { void run(); });
  resetButton.addEventListener("click", () => {
    if (running) return;
    executionId += 1;
    editor.setValue(editorInitialCode);
    root.dataset.environment = spec.runner.environment;
    environmentName.textContent = environmentLabel(spec.runner.environment);
    root.dataset.state = "checking";
    applyAvailabilityState();
    output.textContent = "";
    output.hidden = false;
    disposePreview();
    setRunning(false);
    disposePreview = () => undefined;
    preview.replaceChildren();
    preview.hidden = true;
    consoleTitle.textContent = "Output";
    consoleMeta.textContent = "";
    diagnosticText.textContent = "";
    diagnostics.open = false;
    consoleMeta.title = "";
    consolePanel.hidden = true;
    setDirty(false);
    editor.focus();
  });

  void refreshAvailability();

  return {
    dispose: () => {
      if (lifecycle.disposed) return;
      lifecycle.disposed = true;
      executionId += 1;
      window.clearTimeout(retryTimer);
      executionController?.abort();
      disposePreview();
      editor.destroy();
      spec.runner.dispose?.();
      root.remove();
    },
    refreshAvailability: async () => { if (!running) await refreshAvailability(); }
  };
}

interface PreviewMessage {
  message: string;
  type: "error" | "info" | "log" | "ready" | "warn";
}

interface PreviewHandle {
  dispose(): void;
  ready: Promise<void>;
}

const PREVIEW_HEIGHT_MINIMUM = 1;
const PREVIEW_HEIGHT_MAXIMUM = 10_000;

function renderPreview(
  host: HTMLElement,
  preview: NonNullable<RunResult["preview"]>,
  onMessage: (message: PreviewMessage) => void
): PreviewHandle {
  host.replaceChildren();
  const frame = appendElement(host, "iframe");
  const token = crypto.randomUUID();
  frame.className = "rcb__preview-frame";
  frame.dataset.scripts = preview.scripts;
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute(
    "allow",
    "camera 'none'; display-capture 'none'; geolocation 'none'; microphone 'none'; payment 'none'; usb 'none'"
  );
  frame.setAttribute("title", preview.scripts === "isolated" ? "Interactive code preview" : "Code preview");
  let rejectReady: (error: Error) => void = () => undefined;
  let resolveReady: () => void = () => undefined;
  let readySettled = false;
  let disposing = false;
  let removalTimer: number | undefined;
  const remove = () => { window.clearTimeout(removalTimer); window.removeEventListener("message", receiveMessage); frame.remove(); };
  const ready = new Promise<void>((resolve, reject) => {
    rejectReady = reject;
    resolveReady = resolve;
  });
  const readyTimeout = window.setTimeout(() => {
    if (readySettled) return;
    readySettled = true;
    rejectReady(new Error("Interactive preview did not become ready within 5 seconds."));
  }, 5_000);
  const receiveMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== frame.contentWindow || event.origin !== "null") return;
    if (typeof event.data !== "object" || event.data === null) return;
    const data = event.data as Record<string, unknown>;
    if (disposing) {
      if (data.sender === "runnable-code-blocks-container" && data.type === "stopped" && data.token === token) remove();
      return;
    }
    if (data.sender === "runnable-code-blocks-container" && data.type === "ready" && data.token === token) {
      frame.contentWindow?.postMessage({
        html: preview.html,
        scripts: preview.scripts,
        sender: "runnable-code-blocks-host",
        token
      }, "*");
      return;
    }
    if (
      data.sender === "runnable-code-blocks-container"
      && data.type === "preview-ready"
      && data.token === token
    ) {
      if (!readySettled) {
        readySettled = true;
        window.clearTimeout(readyTimeout);
        resolveReady();
      }
      return;
    }
    if (data.sender !== "runnable-code-blocks-preview" || data.token !== token) return;
    if (data.type === "resize" && typeof data.height === "number") {
      const height = previewHeight(data.height);
      if (height !== undefined) frame.style.height = `${String(height)}px`;
      return;
    }
    if (typeof data.message !== "string" || !isPreviewMessageType(data.type)) return;
    onMessage({ message: data.message.slice(0, 16_000), type: data.type });
    if (data.type === "error" && !readySettled) {
      readySettled = true; window.clearTimeout(readyTimeout); rejectReady(new Error(data.message));
    }
  };
  window.addEventListener("message", receiveMessage);
  frame.srcdoc = previewContainerDocument(token);
  host.hidden = false;
  return {
    dispose: () => {
      if (disposing) return;
      disposing = true;
      if (!readySettled) {
        readySettled = true;
        window.clearTimeout(readyTimeout);
        rejectReady(new Error("Interactive preview was disposed before it became ready."));
      }
      frame.hidden = true;
      frame.contentWindow?.postMessage({ sender: "runnable-code-blocks-stop", token }, "*");
      removalTimer = window.setTimeout(remove, 500);
    },
    ready
  };
}

function previewContainerDocument(token: string): string {
  const serializedToken = JSON.stringify(token);
  const entryLimit = String(OUTPUT_LIMITS.entries);
  const characterLimit = String(OUTPUT_LIMITS.characters);
  const truncationMarker = JSON.stringify(OUTPUT_LIMITS.marker);
  return `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; connect-src 'none'; frame-src 'none'; img-src data: blob:; media-src data: blob:; object-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; worker-src blob:">
<style>html,body{border:0;margin:0;width:100%}#preview{border:0;display:block;min-height:1px;width:100%}</style>
</head><body><script>
(() => {
  const token = ${serializedToken};
  const entryLimit = ${entryLimit};
  const characterLimit = ${characterLimit};
  const truncationMarker = ${truncationMarker};
  let preview = null;
  const minimumHeight = ${String(PREVIEW_HEIGHT_MINIMUM)};
  const maximumHeight = ${String(PREVIEW_HEIGHT_MAXIMUM)};
  const previewHeight = (value) => {
    if (!Number.isFinite(value)) return null;
    return Math.min(maximumHeight, Math.max(minimumHeight, Math.ceil(value)));
  };
  let entries = 0;
  let characters = 0;
  let relayClosed = false;
  addEventListener("message", (event) => {
    const data = event.data;
    if (event.source === parent && data?.sender === "runnable-code-blocks-host" && data.token === token) {
      if (
        preview !== null
        || typeof data.html !== "string"
        || data.html.length > 2000000
        || (data.scripts !== "blocked" && data.scripts !== "isolated")
      ) return;
      preview = document.createElement("iframe");
      preview.id = "preview";
      preview.title = data.scripts === "isolated" ? "Interactive code result" : "Code result";
      preview.setAttribute("sandbox", "allow-scripts");
      preview.setAttribute("referrerpolicy", "no-referrer");
      preview.setAttribute(
        "allow",
        "camera 'none'; display-capture 'none'; geolocation 'none'; microphone 'none'; payment 'none'; usb 'none'"
      );
      if (data.scripts === "blocked") preview.addEventListener("load", () => {
        parent.postMessage({ sender: "runnable-code-blocks-container", type: "preview-ready", token }, "*");
      }, { once: true });
      preview.srcdoc = data.html;
      document.body.replaceChildren(preview);
      return;
    }
    if (event.source === parent && data?.sender === "runnable-code-blocks-stop" && data.token === token) {
      preview?.contentWindow.postMessage({sender: "runnable-code-blocks-stop"}, "*"); return;
    }
    if (preview === null || event.source !== preview.contentWindow || event.origin !== "null") return;
    if (typeof data !== "object" || data === null || data.sender !== "runnable-code-blocks-preview") return;
    if (data.type === "ready") {
      parent.postMessage({ sender: "runnable-code-blocks-container", type: "preview-ready", token }, "*");
    }
    if (data.type === "stopped") {
      parent.postMessage({ sender: "runnable-code-blocks-container", type: "stopped", token }, "*"); return;
    }
    if (data.type === "resize" && typeof data.height === "number") {
      const height = previewHeight(data.height);
      if (height === null) return;
      preview.style.height = height + "px";
      parent.postMessage({ sender: data.sender, type: data.type, height, token }, "*");
      return;
    }
    if (!["error", "info", "log", "ready", "warn"].includes(data.type) || typeof data.message !== "string") return;
    if (relayClosed) return;
    const message = data.message.slice(0, 16000);
    if (entries >= entryLimit || characters + message.length > characterLimit) {
      relayClosed = true;
      parent.postMessage({
        sender: data.sender,
        type: "warn",
        message: truncationMarker,
        token
      }, "*");
      return;
    }
    entries += 1;
    characters += message.length;
    parent.postMessage({ sender: data.sender, type: data.type, message, token }, "*");
  });
  parent.postMessage({ sender: "runnable-code-blocks-container", type: "ready", token }, "*");
})();
</script></body></html>`;
}

function previewHeight(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Math.min(PREVIEW_HEIGHT_MAXIMUM, Math.max(PREVIEW_HEIGHT_MINIMUM, Math.ceil(value)));
}

function isPreviewMessageType(value: unknown): value is PreviewMessage["type"] {
  return value === "error" || value === "info" || value === "log" || value === "ready" || value === "warn";
}
