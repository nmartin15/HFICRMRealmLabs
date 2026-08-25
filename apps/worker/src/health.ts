import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { healthResponseSchema } from "@realm-labs/contracts";

export function healthStatusPath(url: string | undefined): string {
  return (url ?? "").split("?")[0] ?? "";
}

export function writeHealthResponse(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (req.method === "GET" && healthStatusPath(req.url) === "/health") {
    const body = JSON.stringify(healthResponseSchema.parse({ status: "ok" }));
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
    });
    res.end(body);
    return true;
  }

  res.writeHead(404);
  res.end();
  return false;
}

export function createHealthServer(): Server {
  return createServer((req, res) => {
    writeHealthResponse(req, res);
  });
}
