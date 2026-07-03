/**
 * Detect whether this process is running as a Node SEA (Single Executable
 * Application) build (M6/B5 gate — design doc §2.1 point 3: "apply SÓ FAZ
 * SENTIDO quando rodando como SEA").
 *
 * `node:sea`'s `isSea()` is always importable (the module exists on any
 * Node 22 runtime) but only meaningfully returns `true` inside an actual SEA
 * blob — a plain `node dist/index.js` dev boot returns `false`. Wrapped in
 * try/catch purely for defensiveness (older Node runtimes without
 * `node:sea` at all, e.g. if this ever runs under a much older engine) —
 * never throws.
 */
export async function isRunningAsSea(): Promise<boolean> {
  try {
    const sea = await import("node:sea");
    return sea.isSea();
  } catch {
    return false;
  }
}
