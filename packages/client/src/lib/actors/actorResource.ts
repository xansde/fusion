/**
 * actorResource.ts — the one place the client reads a `{ value, max }` resource
 * out of an Actor's `system` blob by dotted path.
 *
 * Spec: `06-canvas-e-renderizacao.md` REQ-CNV-090 (the token resource bar reads
 * the attribute named by `bar1.attribute` / `bar2.attribute` as a dotted path
 * over `system`), `28-hub-do-jogador.md` REQ-HUB-044 (the Comitiva panel shows
 * each member's HP).
 *
 * Why a shared module instead of one reader per surface: the token bar, the
 * Comitiva panel and the combat tracker all answer the same question over the
 * same blob. Three copies means three different answers the day a system stores
 * HP somewhere new — and the divergence shows up as a canvas that disagrees
 * with the panel next to it, which is the worst kind of bug at a table.
 *
 * The path is FREE TEXT: it comes from a field a GM types in the token config,
 * not from a validated schema. Every failure mode therefore returns `null`
 * instead of throwing — an unresolvable path is a bar that is not drawn
 * (REQ-CNV-090), not a crashed canvas.
 */

/** A resource pair as stored by the 2e systems: current, maximum, temporary. */
export interface ResourcePair {
  readonly value: number;
  readonly max: number;
  /** Temporary hit points (or equivalent); 0 when the block carries none. */
  readonly temp: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * Resolve `path` (dot-separated) over `system` and read the `{ value, max }`
 * pair stored there.
 *
 * Returns `null` — never throws — when:
 *   - `system` is absent or is not an object;
 *   - `path` is blank or has an empty segment (`"a..b"`, `".a"`);
 *   - any segment is missing, or is an own property that is not an object;
 *   - the leaf does not carry a numeric `value` AND a numeric `max`.
 *
 * `max <= 0` is returned as-is: whether that means "no bar" is the caller's
 * policy (REQ-CNV-090 says it is, for the token bar), not the reader's.
 *
 * Only OWN properties are walked, so a path like `"__proto__.foo"` or
 * `"constructor.prototype"` resolves to nothing instead of reaching into
 * `Object.prototype`.
 */
export function readResourceAt(system: unknown, path: string): ResourcePair | null {
  if (path.trim() === "") return null;

  const segments = path.split(".");
  let cursor = asRecord(system);
  if (!cursor) return null;

  for (const segment of segments) {
    if (segment === "") return null;
    if (!Object.hasOwn(cursor, segment)) return null;
    const next = asRecord(cursor[segment]);
    if (!next) return null;
    cursor = next;
  }

  const value = cursor["value"];
  const max = cursor["max"];
  if (typeof value !== "number" || typeof max !== "number") return null;

  const temp = cursor["temp"];
  return { value, max, temp: typeof temp === "number" ? temp : 0 };
}
