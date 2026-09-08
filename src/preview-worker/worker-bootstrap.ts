import { OUTPUT_LIMITS } from "../output-buffer";

// Runs in the dedicated Worker after Worker DOM hydration; no user code runs on the frame thread.
export const WORKER_BOOTSTRAP = String.raw`
(() => {
  const send = self.postMessage.bind(self);
  const format = value => {
    if (typeof value === "string") return value;
    if (value === undefined) return "undefined";
    try { return JSON.stringify(value); } catch { return String(value); }
  };
  let entries = 0, characters = 0, truncated = false;
  const relay = (level, message) => {
    if (truncated) return;
    if (++entries > ${OUTPUT_LIMITS.entries} || (characters += message.length) > ${OUTPUT_LIMITS.characters}) {
      truncated = true;
      send({rcb:"console", level:"warn", message:${JSON.stringify(OUTPUT_LIMITS.marker)}});
      return;
    }
    send({rcb:"console", level, message});
  };
  for (const level of ["log", "info", "warn", "error"]) console[level] = (...values) => relay(level, values.map(format).join(" "));
  self.parent = {postMessage: data => { if (typeof data?.message === "string") relay(data.type, data.message); }};
  document.addGlobalEventListener("message", event => {
    if (event.data?.rcb === "ping") send({rcb:"pong", challenge:event.data.challenge});
  });
  self.addEventListener("error", event => relay("error", event.message));
  self.addEventListener("unhandledrejection", event => relay("error", format(event.reason)));
  document.documentElement = document.body;
  document.head = document.createElement("head");
  document.body.appendChild(document.head);
  document.readyState = "complete";
  const blocked = () => { throw new Error("This API is disabled in the preview Worker."); };
  for (const name of ["Worker", "SharedWorker", "fetch", "XMLHttpRequest", "WebSocket", "WebSocketStream", "WebTransport", "EventSource", "importScripts"]) {
    Object.defineProperty(self, name, {value: blocked, writable: false, configurable: false});
  }
})();
`;
