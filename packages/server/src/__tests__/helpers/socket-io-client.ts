/**
 * socket-io-client.ts — what `import ... from "socket.io-client"` resolves to
 * in the server's tests (resolve.alias in vitest.config.ts).
 *
 * socket.io-client caches one Manager per origin (`http://127.0.0.1:<port>`)
 * at module level and hands it to the next `io()` for that origin. The server
 * project keeps a worker's modules from one test file to the next
 * (vitest.isolation.ts), so a file whose server got the same free port as an
 * earlier file's could be handed that file's dead Manager — and its first
 * connect hung until the hook timed out (CI, run 39756331667). Every client a
 * test opens is meant to be a fresh connection anyway: `forceNew` always.
 */
import { io as cachedIo } from "socket.io-client/debug";

export * from "socket.io-client/debug";

export const io: typeof cachedIo = (...args: unknown[]) => {
  const [uri, opts] = args as [unknown, unknown];
  if (typeof uri === "object" && uri !== null)
    return cachedIo({ ...(uri as object), forceNew: true });
  return cachedIo(uri as string, { ...((opts as object | undefined) ?? {}), forceNew: true });
};
export const connect = io;
export default io;
