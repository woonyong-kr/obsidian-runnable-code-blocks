import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "../src/runners/http-client";

afterEach(() => vi.useRealTimers());

describe("bounded HTTP response", () => {
  it("keeps the deadline active after headers while the body is stalled", async () => {
    vi.useFakeTimers();
    const fetch_ = vi.fn(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"pending":')); } })));
    const request = fetchWithTimeout(fetch_, "https://example.com", {}, 25).then(response => response.text());
    const assertion = expect(request).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
  });

  it("propagates caller cancellation after response headers", async () => {
    const caller = new AbortController();
    let headers!: () => void;
    const received = new Promise<void>(resolve => { headers = resolve; });
    const fetch_ = vi.fn(async () => { headers(); return new Response(new ReadableStream()); });
    const request = fetchWithTimeout(fetch_, "https://example.com", {}, 1000, caller.signal).then(response => response.text());
    const assertion = expect(request).rejects.toMatchObject({ name: "AbortError" });
    await received;
    caller.abort();
    await assertion;
  });

  it("rejects a body larger than one MiB even without Content-Length", async () => {
    const fetch_ = vi.fn(async () => new Response(new Uint8Array(1_048_577)));
    await expect(fetchWithTimeout(fetch_, "https://example.com", {}, 1000)).rejects.toThrow(/limit|large/iu);
  });

  it("preserves status, headers and a body exactly at the limit", async () => {
    const fetch_ = vi.fn(async () => new Response(new Uint8Array(1_048_576), { status: 429, headers: { "Retry-After": "60" } }));
    const response = await fetchWithTimeout(fetch_, "https://example.com", {}, 1000);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect((await response.arrayBuffer()).byteLength).toBe(1_048_576);
  });
});
