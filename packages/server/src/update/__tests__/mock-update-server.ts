/**
 * A local Fastify server standing in for "GitHub Releases" during tests
 * (M6/B5 test brief: "NUNCA bater no GitHub real em teste"). Serves a
 * `latest-<channel>.json` manifest (matching manifest-client.ts's direct
 * manifest shape) plus a fake binary artifact with a matching SHA-256, so
 * the full check -> download -> verify flow can be exercised end-to-end
 * against `manifestUrl`/asset URLs pointing at `http://127.0.0.1:<port>/...`
 * instead of the real internet.
 */

import Fastify, { type FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import type { UpdateManifest } from "../manifest-client.js";

export interface MockUpdateServerOptions {
  /** Manifest to serve at /latest-<channel>.json (channel taken from manifest.channel). */
  manifest: UpdateManifest;
  /** Fake binary bytes served at each platform entry's URL (keyed by the artifact's path suffix). */
  artifacts?: Record<string, Buffer>;
}

export interface MockUpdateServer {
  fastify: FastifyInstance;
  baseUrl: string;
  manifestUrl: string;
  close: () => Promise<void>;
}

/** Compute the SHA-256 a given artifact buffer would need in the manifest. */
export function sha256Of(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Start a local mock update server. Routes:
 *   GET /latest-<channel>.json  — the manifest as-is.
 *   GET /artifacts/<name>       — raw bytes from `artifacts[name]`.
 */
export async function startMockUpdateServer(
  options: MockUpdateServerOptions,
): Promise<MockUpdateServer> {
  const { manifest, artifacts = {} } = options;

  const fastify = Fastify({ logger: false });

  fastify.get(`/latest-${manifest.channel}.json`, () => manifest);

  for (const [name, bytes] of Object.entries(artifacts)) {
    fastify.get(`/artifacts/${name}`, (_request, reply) => {
      void reply.header("Content-Type", "application/octet-stream").send(bytes);
    });
  }

  await fastify.listen({ port: 0, host: "127.0.0.1" });
  const address = fastify.server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const baseUrl = `http://127.0.0.1:${String(port)}`;

  return {
    fastify,
    baseUrl,
    manifestUrl: `${baseUrl}/latest-${manifest.channel}.json`,
    close: () => fastify.close(),
  };
}
