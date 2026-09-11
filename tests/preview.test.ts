import { expect, it, vi } from "vitest";
import { renderPreview } from "../src/preview";

it.each([
  ["ready", "ready"],
  ["error", "Preview failed"],
  ["timeout", "Interactive preview did not become ready within 5 seconds."],
  ["dispose", "Interactive preview was disposed before it became ready."],
])("settles preview readiness once after %s and releases its listener", async (outcome, expected) => {
  vi.useFakeTimers();
  const host = document.body.appendChild(document.createElement("div"));
  const onMessage = vi.fn();
  const handle = renderPreview(host, { kind: "html", html: "<p>Preview</p>", scripts: "isolated" }, onMessage);
  const result = handle.ready.then(() => "ready", (error: unknown) => error instanceof Error ? error.message : String(error));
  const frame = host.querySelector("iframe");
  expect(frame).not.toBeNull();
  const token: unknown = JSON.parse(frame?.srcdoc.match(/const token = ("[^"]+");/u)?.[1] ?? "null");
  expect(typeof token).toBe("string");
  const send = (type: string, messageToken: unknown = token) => window.dispatchEvent(new MessageEvent("message", {
    source: frame?.contentWindow, origin: "null",
    data: { sender: type === "error" ? "runnable-code-blocks-preview" : "runnable-code-blocks-container", type, token: messageToken, message: "Preview failed" },
  }));
  try {
    send("preview-ready", "wrong-token");
    if (outcome === "ready") send("preview-ready");
    else if (outcome === "error") send("error");
    else if (outcome === "timeout") await vi.advanceTimersByTimeAsync(5_000);
    else handle.dispose();
    expect(await result).toBe(expected);

    handle.dispose();
    handle.dispose();
    send("preview-ready");
    await vi.advanceTimersByTimeAsync(500);
    expect(host.querySelector("iframe")).toBeNull();
    const messages = onMessage.mock.calls.length;
    send("error");
    expect(onMessage).toHaveBeenCalledTimes(messages);
    expect(await result).toBe(expected);
  } finally {
    handle.dispose();
    await vi.advanceTimersByTimeAsync(500);
    vi.useRealTimers();
    host.remove();
  }
});
