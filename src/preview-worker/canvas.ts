// Executed after Worker DOM hydration, on the author Worker only.
// Native rendering never dispatches author method calls on the frame thread.
interface CanvasState {
  element: HTMLCanvasElement;
  surface: OffscreenCanvas;
  id: string;
  dirty: boolean;
  pending: boolean;
  scheduled: boolean;
  context?: object;
  kind?: string;
}

const states = new Map<HTMLCanvasElement, CanvasState>();
const send = self.postMessage.bind(self);
const snapshot = self.createImageBitmap.bind(self);
const maxPixels = 1_048_576;
const dimension = (value: string | null, fallback: number) => value === null || !/^\d+$/u.test(value) ? fallback : Number(value);
const size = (element: HTMLCanvasElement) => [dimension(element.getAttribute("width"), 300), dimension(element.getAttribute("height"), 150)] as const;

function validateSize(width: number, height: number, own?: CanvasState): void {
  let pixels = width * height;
  for (const state of states.values()) if (state !== own) pixels += state.surface.width * state.surface.height;
  if (width > 2_048 || height > 2_048 || width * height > maxPixels || pixels > 4 * maxPixels) {
    throw new RangeError("Canvas size limit: 2048 per side, 1 megapixel per canvas, 4 megapixels per preview.");
  }
}

function changed(state: CanvasState): void {
  state.dirty = true;
  if (state.pending || state.scheduled) return;
  state.scheduled = true;
  // Coalesce one JavaScript turn's drawing. createImageBitmap preserves the backing store,
  // so an incremental drawing is not erased when its previous frame is presented.
  queueMicrotask(() => {
    state.scheduled = false;
    if (state.pending || !state.dirty || !state.surface.width || !state.surface.height) return;
    state.pending = true;
    state.dirty = false;
    void snapshot(state.surface).then(bitmap => {
      send({rcb: "canvas", id: state.id, bitmap}, [bitmap]);
    }).catch((error: unknown) => {
      state.pending = false;
      console.error(error instanceof Error ? error.message : "Canvas presentation failed.");
    });
  });
}

const workerDocument = document as Document & { addGlobalEventListener: typeof self.addEventListener };
workerDocument.addGlobalEventListener("message", (event: MessageEvent<{rcb?: string; id?: string}>) => {
  if (event.data.rcb !== "canvas-ack") return;
  for (const state of states.values()) if (state.id === event.data.id) {
    state.pending = false;
    if (state.dirty) changed(state);
    break;
  }
});

function surfaceFor(element: HTMLCanvasElement): CanvasState {
  const existing = states.get(element);
  if (existing) return existing;
  if (states.size >= 8) throw new RangeError("Canvas count limit: 8 per preview.");
  const [width, height] = size(element);
  validateSize(width, height);
  // Worker DOM reflects these properties with a non-configurable zero default.
  // Instance accessors supply the browser's 300x150 default and route resizes through validation.
  for (const key of ["width", "height"] as const) Object.defineProperty(element, key, {
    configurable: true,
    get() { return size(element)[key === "width" ? 0 : 1]; },
    set(value: number) { element.setAttribute(key, String(value >>> 0)); }
  });
  const id = `rcb-canvas-${Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, "0")).join("")}`;
  const state = {element, surface: new OffscreenCanvas(width, height), id, dirty: false, pending: false, scheduled: false};
  element.classList.add(id);
  states.set(element, state);
  return state;
}

const nativeSetAttribute = HTMLCanvasElement.prototype.setAttribute; // eslint-disable-line @typescript-eslint/unbound-method -- Called with its original element below.
const nativeRemoveAttribute = HTMLCanvasElement.prototype.removeAttribute; // eslint-disable-line @typescript-eslint/unbound-method -- Called with its original element below.
HTMLCanvasElement.prototype.setAttribute = function(name, value) {
  const state = states.get(this);
  const key = name.toLowerCase();
  if (state && (key === "width" || key === "height")) {
    const [width, height] = size(this);
    const next = dimension(value, key === "width" ? 300 : 150);
    validateSize(key === "width" ? next : width, key === "height" ? next : height, state);
    state.surface[key] = next;
    changed(state);
  }
  nativeSetAttribute.call(this, name, value);
};
HTMLCanvasElement.prototype.removeAttribute = function(name) {
  const key = name.toLowerCase();
  if (states.has(this) && (key === "width" || key === "height")) this.setAttribute(key, key === "width" ? "300" : "150");
  nativeRemoveAttribute.call(this, name);
};
// DOM canvas inputs to drawImage/texImage2D refer to the native Worker surface.
const unwrap = (value: unknown) => value instanceof HTMLCanvasElement ? surfaceFor(value).surface : value;
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value(this: HTMLCanvasElement, kind: string, options?: unknown) {
  if (!["2d", "webgl", "webgl2", "bitmaprenderer"].includes(kind)) return null;
  const state = surfaceFor(this);
  if (state.context) return state.kind === kind ? state.context : null;
  const context = state.surface.getContext(kind as OffscreenRenderingContextId, options);
  if (!context) return null;
  const methods = new Map<PropertyKey, unknown>();
  state.context = new Proxy(context, {
    get(target, key) {
      if (key === "canvas") return state.element;
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      if (!methods.has(key)) methods.set(key, (...args: unknown[]) => {
        const result: unknown = Reflect.apply(value, target, args.map(unwrap));
        changed(state);
        return result;
      });
      return methods.get(key);
    },
    set(target, key, value: unknown) { const result = Reflect.set(target, key, value, target); changed(state); return result; }
  });
  state.kind = kind;
  return state.context;
}});

export {};
