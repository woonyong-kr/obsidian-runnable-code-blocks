import type { RunResult } from "./contracts";
import { appendElement } from "./dom";
import { OUTPUT_LIMITS } from "./output-buffer";

interface PreviewMessage {
  message: string;
  type: "error" | "info" | "log" | "ready" | "warn" | "stopped";
}

interface PreviewHandle {
  dispose(): void;
  ready: Promise<void>;
}

const PREVIEW_HEIGHT_MINIMUM = 1;
const PREVIEW_HEIGHT_MAXIMUM = 10_000;

export function renderPreview(
  host: HTMLElement,
  preview: NonNullable<RunResult["preview"]>,
  onMessage: (message: PreviewMessage) => void
): PreviewHandle {
  const ownerWindow = host.ownerDocument.defaultView ?? window;
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
  const remove = () => { ownerWindow.clearTimeout(removalTimer); ownerWindow.removeEventListener("message", receiveMessage); frame.remove(); };
  const ready = new Promise<void>((resolve, reject) => {
    rejectReady = reject;
    resolveReady = resolve;
  });
  const settleReady = (error?: Error) => {
    if (readySettled) return;
    readySettled = true;
    ownerWindow.clearTimeout(readyTimeout);
    if (error) rejectReady(error);
    else resolveReady();
  };
  const readyTimeout = ownerWindow.setTimeout(() => {
    settleReady(new Error("Interactive preview did not become ready within 5 seconds."));
  }, 5_000);
  const receiveMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== frame.contentWindow || event.origin !== "null") return;
    if (typeof event.data !== "object" || event.data === null) return;
    const data = event.data as Record<string, unknown>;
    if (data.token !== token) return;
    if (disposing) {
      if (data.sender === "runnable-code-blocks-container" && data.type === "stopped") remove();
      return;
    }
    if (data.sender === "runnable-code-blocks-container" && data.type === "ready") {
      frame.contentWindow?.postMessage({
        html: preview.html,
        scripts: preview.scripts,
        sender: "runnable-code-blocks-host",
        token
      }, "*");
      return;
    }
    if (data.sender === "runnable-code-blocks-container" && data.type === "preview-ready") {
      settleReady();
      return;
    }
    if (data.sender === "runnable-code-blocks-container" && data.type === "stopped") {
      onMessage({ message: "", type: "stopped" });
      return;
    }
    if (data.sender !== "runnable-code-blocks-preview") return;
    if (data.type === "resize" && typeof data.height === "number") {
      const height = previewHeight(data.height);
      if (height !== undefined) frame.style.height = `${String(height)}px`;
      return;
    }
    if (typeof data.message !== "string" || !isPreviewMessageType(data.type)) return;
    onMessage({ message: data.message.slice(0, 16_000), type: data.type });
    if (data.type === "error") settleReady(new Error(data.message));
  };
  ownerWindow.addEventListener("message", receiveMessage);
  frame.srcdoc = previewContainerDocument(token, window.origin);
  host.hidden = false;
  return {
    dispose: () => {
      if (disposing) return;
      disposing = true;
      settleReady(new Error("Interactive preview was disposed before it became ready."));
      frame.hidden = true;
      frame.contentWindow?.postMessage({ sender: "runnable-code-blocks-stop", token }, "*");
      removalTimer = ownerWindow.setTimeout(remove, 500);
    },
    ready
  };
}

function previewContainerDocument(token: string, controllerOrigin: string): string {
  const serializedToken = JSON.stringify(token);
  const serializedControllerOrigin = JSON.stringify(controllerOrigin);
  const entryLimit = String(OUTPUT_LIMITS.entries);
  const characterLimit = String(OUTPUT_LIMITS.characters);
  const truncationMarker = JSON.stringify(OUTPUT_LIMITS.marker);
  return `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; connect-src 'none'; frame-src 'none'; img-src data: blob:; media-src data: blob:; object-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; worker-src blob:">
<style>html,body{border:0;margin:0;width:100%}#preview{border:0;display:block;min-height:1px;width:100%}</style>
</head><body><script>
(() => {
  const token = ${serializedToken};
  const expectedControllerOrigin = ${serializedControllerOrigin};
  let controllerSource = null;
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
    // A module loaded in Obsidian's main window can control a frame in a popout.
    // postMessage identifies that module's window, not the frame's DOM parent.
    if (data?.sender === "runnable-code-blocks-host" && data.token === token) {
      if (
        controllerSource !== null
        || event.source === null
        || event.origin !== expectedControllerOrigin
        || preview !== null
        || typeof data.html !== "string"
        || data.html.length > 2000000
        || (data.scripts !== "blocked" && data.scripts !== "isolated")
      ) return;
      controllerSource = event.source;
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
    if (controllerSource !== null && event.source === controllerSource
      && event.origin === expectedControllerOrigin
      && data?.sender === "runnable-code-blocks-stop" && data.token === token) {
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
