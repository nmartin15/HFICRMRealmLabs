import { afterEach, describe, expect, it } from "vitest";
import { createHealthServer } from "./health.js";

describe("worker health endpoint", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it("returns ok on GET /health", async () => {
    const server = createHealthServer();
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    close = () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected tcp address");
    }

    const res = await fetch(`http://127.0.0.1:${address.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("returns 404 for other paths", async () => {
    const server = createHealthServer();
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    close = () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected tcp address");
    }

    const res = await fetch(`http://127.0.0.1:${address.port}/`);
    expect(res.status).toBe(404);
  });
});
