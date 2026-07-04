// A local HTTP sink for webhook/Slack assertions — mirrors the pattern in
// apps/api/src/modules/integrations/{delivery,slack}.integration.test.ts. The
// created webhook/Slack connection POSTs here and the test asserts receipt. The
// API server (a separate process) reaches it over 127.0.0.1.

import { createServer, type IncomingMessage, type Server } from "node:http";

export interface SinkRequest {
  headers: IncomingMessage["headers"];
  body: string;
}

export interface Sink {
  /** URL to hand to the webhook/Slack connection under test. */
  url: string;
  /** Every request received so far. */
  requests: SinkRequest[];
  /** Set the HTTP status the sink returns (default 200). */
  setStatus: (code: number) => void;
  /** Resolve once a received request matches `predicate` (polls the buffer). */
  waitForRequest: (predicate: (r: SinkRequest) => boolean, timeoutMs?: number) => Promise<SinkRequest>;
  close: () => Promise<void>;
}

export async function startSink(): Promise<Sink> {
  const requests: SinkRequest[] = [];
  let status = 200;

  const server: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      requests.push({ headers: req.headers, body });
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: status < 400 }));
    });
  });

  await new Promise<void>((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("e2e sink failed to bind");
  }
  const port = address.port;

  return {
    url: `http://127.0.0.1:${port}/hook`,
    requests,
    setStatus: (code) => {
      status = code;
    },
    async waitForRequest(predicate, timeoutMs = 25_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = requests.find(predicate);
        if (found) {
          return found;
        }
        if (Date.now() > deadline) {
          throw new Error(`e2e sink: no matching request within ${timeoutMs}ms`);
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    },
    close: () => new Promise((resolvePromise) => server.close(() => resolvePromise())),
  };
}
