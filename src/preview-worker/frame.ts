import { OUTPUT_LIMITS } from "../output-buffer";
import { upgrade } from "@ampproject/worker-dom/dist/amp-production/main.mjs";

interface Payload { html: string; source: string; dom: string }

/** Trusted frame entry point. User JavaScript is passed only to a dedicated Worker. */
export function start(payload: Payload): void {
  const NativeWorker = Worker;
  let worker: Worker | undefined;
  let stopped = false;
  let lastHeartbeat = performance.now();
  let challenge: string | undefined;
  let storedCharacters = 0;
  let windowStarted = performance.now();
  let messages = 0;
  let domMessages = 0;
  let bytes = 0;
  let nodes = 0;
  let entries = 0;
  let characters = 0;
  let truncated = false;
  const canvasFrames = new Map<string, ImageBitmap>();
  const canvasSizes = new Map<string, number>();
  let canvasTimer: number | undefined;
  const send = (type: string, message: string) => parent.postMessage({ sender: "runnable-code-blocks-preview", type, message }, "*");
  const stop = (message?: string) => {
    if (stopped) return;
    stopped = true;
    worker?.terminate();
    window.clearInterval(watchdog);
    window.clearTimeout(canvasTimer);
    for (const bitmap of canvasFrames.values()) bitmap.close();
    canvasFrames.clear();
    if (message) send("error", message);
    parent.postMessage({ sender: "runnable-code-blocks-preview", type: "stopped" }, "*");
  };
  const watchdog = window.setInterval(() => {
    if (performance.now() - lastHeartbeat > 2_000) {
      stop("Preview stopped: its Worker did not respond within 2 seconds. Edit the code and run again.");
    } else if (worker && challenge === undefined) {
      challenge = crypto.randomUUID();
      worker.postMessage({ rcb: "ping", challenge });
    }
  }, 250);
  addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source === parent && typeof event.data === "object" && event.data !== null && (event.data as {sender?: unknown}).sender === "runnable-code-blocks-stop") {
      if (stopped) parent.postMessage({ sender: "runnable-code-blocks-preview", type: "stopped" }, "*");
      else stop();
    }
  });
  addEventListener("pagehide", () => stop(), { once: true });
  // Block navigation and forms even when a Worker event listener cannot synchronously preventDefault.
  document.addEventListener("click", (event) => {
    if ((event.target as Element | null)?.closest("a")) event.preventDefault();
  }, true);
  document.addEventListener("submit", (event) => event.preventDefault(), true);

  // Worker DOM dispatches the full listener chain in its Worker. Forward each native event once,
  // even when React registers both capture and bubble listeners on the same container.
  let installingListeners = false;
  const relayedEvents = new WeakSet<Event>();
  const nativeAdd = EventTarget.prototype.addEventListener; // eslint-disable-line @typescript-eslint/unbound-method -- Called below with the original EventTarget as receiver.
  const nativeRemove = EventTarget.prototype.removeEventListener; // eslint-disable-line @typescript-eslint/unbound-method -- Called below with the original EventTarget as receiver.
  const listenerWrappers = new WeakMap<EventListenerOrEventListenerObject, EventListener>();
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (installingListeners && listener !== null) {
      const original = listener;
      const wrapper: EventListener = event => {
        if (relayedEvents.has(event)) return;
        relayedEvents.add(event);
        if (typeof original === "function") original.call(this, event); else original.handleEvent(event);
      };
      listenerWrappers.set(original, wrapper);
      listener = wrapper;
    }
    nativeAdd.call(this, type, listener, options);
  };
  EventTarget.prototype.removeEventListener = function(type, listener, options) {
    nativeRemove.call(this, type, listener === null ? null : listenerWrappers.get(listener) ?? listener, options);
  };

  const presentCanvases = () => {
    canvasTimer = undefined;
    if (stopped) return;
    for (const [id, bitmap] of canvasFrames) {
      const canvas = root.querySelector(`canvas.${id}`);
      if (!(canvas instanceof HTMLCanvasElement)) continue;
      if (canvas instanceof HTMLCanvasElement) {
        if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
        if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        context?.clearRect(0, 0, canvas.width, canvas.height);
        context?.drawImage(bitmap, 0, 0);
      }
      bitmap.close();
      canvasFrames.delete(id);
      worker?.postMessage({rcb: "canvas-ack", id});
    }
  };

  // Validate and bound the transport before Worker DOM consumes any mutation.
  class GuardedWorker extends NativeWorker {
    #receive: ((event: MessageEvent) => void) | null = null;
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      // This is the native termination handle, kept outside the user Worker.
      worker = this; // eslint-disable-line @typescript-eslint/no-this-alias -- Native Worker handle is retained for termination.
      if (typeof url === "string") URL.revokeObjectURL(url);
      super.addEventListener("error", (event) => { event.preventDefault(); stop(event.message); });
      super.addEventListener("message", (event: MessageEvent<unknown>) => {
        if (typeof event.data !== "object" || event.data === null) return;
        const data = event.data as Record<string, unknown>;
        if (stopped) { if (data.bitmap instanceof ImageBitmap) data.bitmap.close(); return; }
        if (performance.now() - windowStarted > 1_000) { windowStarted = performance.now(); messages = 0; domMessages = 0; bytes = 0; }
        if (++messages > 1_000) { stop("Preview stopped: message rate limit exceeded."); return; }
        if (data.rcb === "canvas") {
          const bitmap = data.bitmap;
          if (!(bitmap instanceof ImageBitmap)) { stop("Preview stopped: invalid canvas frame."); return; }
          const id = data.id;
          const pixels = bitmap.width * bitmap.height;
          const total = [...canvasSizes.values()].reduce((sum, value) => sum + value, 0) - (canvasSizes.get(String(id)) ?? 0) + pixels;
          if (typeof id !== "string" || !/^rcb-canvas-[0-9a-f]{32}$/u.test(id)
            || bitmap.width > 2_048 || bitmap.height > 2_048 || pixels > 1_048_576 || total > 4_194_304
            || (!canvasSizes.has(id) && canvasSizes.size >= 8) || canvasFrames.has(id)) {
            bitmap.close(); stop("Preview stopped: canvas resource limit exceeded."); return;
          }
          canvasSizes.set(id, pixels);
          canvasFrames.set(id, bitmap);
          // One in-flight bitmap per canvas, at most 30 presentations/second.
          canvasTimer ??= window.setTimeout(presentCanvases, 34);
          return;
        }
        if (data.rcb === "pong") {
          if (challenge !== undefined && data.challenge === challenge) { challenge = undefined; lastHeartbeat = performance.now(); }
          return;
        }
        if (data.rcb === "ready") { send("ready", "Preview ready"); return; }
        if (data.rcb === "console") {
          if (truncated || typeof data.message !== "string") return;
          if (++entries > OUTPUT_LIMITS.entries || (characters += data.message.length) > OUTPUT_LIMITS.characters) {
            truncated = true; send("warn", OUTPUT_LIMITS.marker); return;
          }
          send(data.level === "error" ? "error" : "log", data.message); return;
        }
        if (![2, 3].includes(data[12] as number)) return;
        const created = data[37];
        const mutations = data[36];
        const strings = data[41];
        if (!(created instanceof ArrayBuffer) || !(mutations instanceof ArrayBuffer)
          || created.byteLength + mutations.byteLength > 131_072
          || !Array.isArray(strings) || strings.length > 5_000 || !strings.every((s) => typeof s === "string")) {
          stop("Preview stopped: invalid DOM message."); return;
        }
        if (created.byteLength % 10 !== 0 || mutations.byteLength % 2 !== 0) { stop("Preview stopped: invalid DOM message."); return; }
        const operations = new Uint16Array(mutations);
        let cursor = 0;
        while (cursor < operations.length) {
          const type = operations[cursor];
          const length = type === 0 || type === 3 ? 5 : type === 1 ? 3 : type === 5 ? 2
            : type === 2 ? 6 + (operations[cursor + 4] ?? NaN) + (operations[cursor + 5] ?? NaN)
            : type === 4 ? 4 + 2 * (operations[cursor + 2] ?? NaN) + 6 * (operations[cursor + 3] ?? NaN) : NaN;
          cursor += length;
          if (!Number.isFinite(cursor) || cursor > operations.length) { stop("Preview stopped: unsupported or invalid DOM mutation."); return; }
        }
        const size = created.byteLength + mutations.byteLength + strings.reduce((n: number, s: string) => n + s.length * 2, 0);
        nodes += created.byteLength / 10;
        bytes += size;
        storedCharacters += strings.reduce((n: number, s: string) => n + s.length, 0);
        if (++domMessages > 200 || size > 131_072 || bytes > 1_048_576 || nodes > 5_000 || storedCharacters > 1_048_576) {
          stop("Preview stopped: DOM update limit exceeded."); return;
        }
        try { this.#receive?.(event); } catch { stop("Preview stopped: invalid DOM mutation."); }
      });
    }
    override get onmessage(): ((event: MessageEvent) => void) | null { return this.#receive; }
    override set onmessage(value: ((event: MessageEvent) => void) | null) { this.#receive = value; }
  }
  window.Worker = GuardedWorker;

  const root = document.createElement("div");
  root.id = "rcb-worker-root";
  const initial = new DOMParser().parseFromString(payload.html, "text/html");
  root.replaceChildren(...initial.head.childNodes, ...initial.body.childNodes);
  document.body.append(root);
  const safeTag = (node: Element) => !["SCRIPT", "IFRAME", "FRAME", "FRAMESET", "OBJECT", "EMBED", "BASE", "META", "LINK"].includes(node.tagName.toUpperCase());
  const safeAttribute = (name: string, value: string | null) => {
    const key = name.toLowerCase();
    if (key.startsWith("on") || ["srcdoc", "nonce", "is", "http-equiv", "formaction", "action", "target"].includes(key)) return false;
    if (["src", "href", "xlink:href", "poster", "background"].includes(key)) return value === null || /^(?:#|data:image\/)/u.test(value);
    return !["srcset", "ping"].includes(key);
  };
  for (const node of root.querySelectorAll("*")) {
    if (!safeTag(node)) { node.remove(); continue; }
    for (const attribute of [...node.attributes]) if (!safeAttribute(attribute.name, attribute.value)) node.removeAttribute(attribute.name);
  }
  const propertyNames = new Set(["value", "checked", "selected", "disabled", "multiple", "muted", "selectedIndex"]);
  void upgrade(root, Promise.resolve([payload.dom, payload.source]), {
    authorURL: "runnable-preview.js",
    // An offscreen iframe may never receive rAF until its first DOM update gives it a height.
    mutationPump: (flush: () => void) => window.setTimeout(() => {
      if (stopped) return;
      installingListeners = true;
      try { flush(); } catch { stop("Preview stopped: invalid DOM mutation."); }
      finally { installingListeners = false; }
      if (canvasFrames.size > 0) canvasTimer ??= window.setTimeout(presentCanvases, 34);
    }, 0),
    // No generic object method calls, storage, or author script execution on the frame thread.
    executorsAllowed: [0, 1, 2, 3, 4, 5],
    sanitizer: {
      sanitize: safeTag,
      setAttribute: (node: Element, name: string, value: string | null) => {
        if (!safeAttribute(name, value)) return;
        if (node instanceof HTMLCanvasElement && ["width", "height"].includes(name.toLowerCase())
          && value !== null && (!/^\d+$/u.test(value) || Number(value) > 2_048)) value = "0";
        if (value === null) node.removeAttribute(name); else node.setAttribute(name, value);
      },
      setProperty: (node: Element, name: string, value: string) => {
        if (propertyNames.has(name)) Reflect.set(node, name, ["checked", "selected", "disabled", "multiple", "muted"].includes(name) ? value === "true" : value);
      }
    }
  }).catch(() => stop("Preview Worker could not start."));
}
