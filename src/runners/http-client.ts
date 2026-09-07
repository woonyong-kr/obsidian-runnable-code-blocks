export type FetchLike = typeof fetch;

export const unavailableFetch: FetchLike = async () => {
  throw new TypeError("No HTTP adapter is configured for this environment.");
};

// A Response is returned only after its bounded body has been consumed. Callers
// retain the Fetch API while cancellation/deadlines cover the whole response.
export async function fetchWithTimeout(
  fetch_: FetchLike,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  const timeout = () => controller.abort(new DOMException("HTTP response deadline exceeded", "TimeoutError"));
  if (signal?.aborted === true) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = window.setTimeout(timeout, Math.max(0, timeoutMs));
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let rejectAborted: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    rejectAborted = () => reject(controller.signal.reason instanceof Error ? controller.signal.reason : new DOMException("HTTP request aborted", "AbortError"));
    controller.signal.addEventListener("abort", rejectAborted, { once: true });
    if (controller.signal.aborted) rejectAborted();
  });
  const consume = async () => {
    controller.signal.throwIfAborted();
    const response = await fetch_(input, { ...init, signal: controller.signal });
    if (controller.signal.aborted) {
      await response.body?.cancel();
      controller.signal.throwIfAborted();
    }
    if (response.body === null) return response;
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        controller.signal.throwIfAborted();
        const chunk = await reader.read();
        controller.signal.throwIfAborted();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1_048_576) throw new RangeError("HTTP response exceeds the 1 MiB limit");
        chunks.push(chunk.value);
      }
      const body = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
      void reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
  };
  try {
    return await Promise.race([consume(), aborted]);
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectAborted);
    if (controller.signal.aborted) void reader?.cancel().catch(() => undefined);
  }
}
