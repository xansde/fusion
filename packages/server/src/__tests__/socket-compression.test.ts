/**
 * socket-compression.test.ts — pack indexes (feats-core 2.6 MB, spells-core 1.8 MB
 * of JSON, ~7 MB for the whole sheet) must not cross the tunnel uncompressed.
 *
 * "Carregar o compêndio" was slow and failing on the table's connection because
 * `perMessageDeflate` was off (spec 04, Q3 — "medir antes de decidir"). Measured
 * on the real a_queda packs: the same indexes gzip to ~26% of their size
 * (feats-core 2645 KB -> 661 KB, spells-core 1766 KB -> 467 KB, 7.2 MB -> 1.9 MB
 * for every pack), at 40-55 ms of CPU for the biggest one.
 */

import { describe, it, expect, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { io as ioClient } from "socket.io-client";
import { SocketManager } from "../net/socket-manager.js";

let fastify: FastifyInstance | undefined;
let manager: SocketManager | undefined;

afterEach(async () => {
  await manager?.close();
  await fastify?.close();
  manager = undefined;
  fastify = undefined;
});

async function negotiatedExtensions(): Promise<string> {
  fastify = Fastify({ logger: false }) as unknown as FastifyInstance;
  manager = new SocketManager({
    httpServer: fastify.server,
    logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } as never,
    origin: "*",
  });
  await fastify.listen({ port: 0, host: "127.0.0.1" });
  const address = fastify.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const client = ioClient(`http://127.0.0.1:${String(port)}`, { transports: ["websocket"] });
  try {
    return await new Promise<string>((resolve, reject) => {
      client.io.on("open", () => {
        const ws = (client.io.engine as unknown as { transport: { ws?: { extensions?: string } } }).transport.ws;
        resolve(ws?.extensions ?? "");
      });
      setTimeout(() => reject(new Error("socket did not open")), 5000);
    });
  } finally {
    client.close();
  }
}

describe("socket.io compression", () => {
  it("negotiates permessage-deflate so big compendium answers travel compressed", async () => {
    expect(await negotiatedExtensions()).toContain("permessage-deflate");
  });
});
