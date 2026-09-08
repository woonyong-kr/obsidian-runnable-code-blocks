import type { RunContext } from "../contracts";
import { fetchWithTimeout, type FetchLike } from "./http-client";

/** A separate, source-free request: the aborted execution signal must not cancel this acknowledgement. */
export async function cancelHttpExecution(
  fetch_: FetchLike, endpoint: string, headers: Record<string, string>, context?: RunContext
): Promise<void> {
  context?.onCancellation?.("pending");
  let state: "cancelled" | "completed" | "unknown" = "unknown";
  try {
    const response = await fetchWithTimeout(fetch_, `${endpoint}/v1/cancel`, { method: "POST", headers, keepalive: true }, 4_000);
    const body = await response.json() as { state?: unknown };
    if (response.ok && (body.state === "cancelled" || body.state === "completed")) state = body.state;
  } catch {
    // Offline, old servers, or failed container cleanup cannot confirm cancellation.
  }
  context?.onCancellation?.(state);
}
