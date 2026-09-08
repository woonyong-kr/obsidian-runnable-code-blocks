import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/** Node does not await request listeners; always handle rejected async requests. */
export function createAsyncHttpServer(
  handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>
): Server {
  return createServer({ requestTimeout: 22_000, headersTimeout: 5_000, connectionsCheckingInterval: 1_000 }, (request, response) => {
    void Promise.resolve().then(() => handler(request, response)).catch(() => {
      if (response.destroyed || response.writableEnded) return;
      if (response.headersSent) {
        response.destroy();
        return;
      }
      response.writeHead(500, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ error: "Internal server error" }));
    });
  });
}
