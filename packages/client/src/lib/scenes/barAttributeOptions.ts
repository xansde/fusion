/**
 * barAttributeOptions.ts — what the token config's bar dropdown offers.
 *
 * Spec: `06-canvas-e-renderizacao.md` REQ-CNV-090 — the bar reads a dotted
 * path over the actor's `system`. The path used to be free text, which put
 * the system's internal layout ("attributes.hp") in front of the GM. The
 * dropdown inverts that: the candidates are DISCOVERED from the effective
 * actor — every `{ value, max }` pair `readResourceAt` could resolve — and
 * shown under legible names ("HP"), so what you pick is what the bar draws.
 *
 * Discovery mirrors `actorResource.readResourceAt`: own properties only, a
 * leaf is a numeric `value` + numeric `max`. Anything else — scalars, lists,
 * blobs deeper than {@link MAX_DEPTH} — is not a resource a bar can track.
 */

export interface BarAttributeOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Resources live at `system.<group>.<name>` in the 2e systems; one extra
 * level is headroom, not an invitation to index the whole blob.
 */
const MAX_DEPTH = 3;

/** Paths with an agreed table name; anything else gets a prettified segment. */
const KNOWN_LABEL_KEYS: ReadonlyMap<string, string> = new Map([
  ["attributes.hp", "FUSION.Token.Config.BarAttr.attributes.hp"],
  ["resources.focus", "FUSION.Token.Config.BarAttr.resources.focus"],
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isResourcePair(value: unknown): boolean {
  const record = asRecord(value);
  return (
    record !== null && typeof record["value"] === "number" && typeof record["max"] === "number"
  );
}

/**
 * Every dotted path in `system` whose leaf is a `{ value, max }` pair, in
 * stable depth-first key order — so the dropdown is deterministic for a
 * given actor, not dependent on discovery timing.
 */
export function collectResourcePaths(system: unknown): string[] {
  const paths: string[] = [];

  function walk(node: Record<string, unknown>, prefix: string, depth: number): void {
    for (const key of Object.keys(node)) {
      const child = node[key];
      const path = prefix === "" ? key : `${prefix}.${key}`;
      if (isResourcePair(child)) {
        paths.push(path);
      } else if (depth < MAX_DEPTH) {
        const record = asRecord(child);
        if (record) walk(record, path, depth + 1);
      }
    }
  }

  const root = asRecord(system);
  if (root) walk(root, "", 1);
  return paths;
}

function labelFor(path: string, t: (key: string) => string): string {
  const known = KNOWN_LABEL_KEYS.get(path);
  if (known) return t(known);
  const segment = path.split(".").at(-1) ?? path;
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

/**
 * The options for one bar's `<select>`: "no bar" first, then each discovered
 * resource. A saved path that no longer resolves is kept — labelled as
 * unresolved — because silently dropping it from the list would rewrite the
 * token on the next save without the GM ever choosing to.
 */
export function barAttributeOptions(
  system: unknown,
  current: string,
  t: (key: string) => string,
): BarAttributeOption[] {
  const discovered = collectResourcePaths(system);
  const options: BarAttributeOption[] = [
    { value: "", label: t("FUSION.Token.Config.BarAttr.none") },
    ...discovered.map((path) => ({ value: path, label: labelFor(path, t) })),
  ];
  if (current !== "" && !discovered.includes(current)) {
    options.push({
      value: current,
      label: `${current} ${t("FUSION.Token.Config.BarAttr.unresolved")}`,
    });
  }
  return options;
}
