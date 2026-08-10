/**
 * barAttributeOptions.ts — what the token config's bar dropdown offers.
 *
 * Spec: `06-canvas-e-renderizacao.md` REQ-CNV-090 — the bar reads a dotted
 * path over the actor's `system`. The path used to be free text, which put
 * the system's internal layout ("attributes.hp") in front of the GM. The
 * dropdown inverts that: legible names ("HP", "Pontos de heroísmo") for the
 * resources the table actually plays with.
 *
 * Two sources feed the list:
 *
 * 1. The CANONICAL table resources — HP, hero points, focus points — are
 *    always offered. The 2e systems store them with rule-supplied maxima
 *    (hero points cap at 3; the focus pool max is derived), so demanding a
 *    stored `{ value, max }` pair would hide exactly the resources the sheet
 *    itself shows. Whether a pick draws a bar stays `resolveTokenBarValue`'s
 *    decision (a non-caster's focus pool is 0 → bar absent, truthfully).
 *
 * 2. Extra pools DISCOVERED on the effective actor: every `{ value, max }`
 *    pair in `system`, with `derived.X` canonicalized to `attributes.X` —
 *    the alias `resolveTokenBarValue` already prefers — so one resource never
 *    shows up twice under two spellings.
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

/**
 * Always offered, in this order. Keys double as the i18n suffix — the label
 * for `attributes.hp` is `FUSION.Token.Config.BarAttr.attributes.hp`.
 */
const CANONICAL_PATHS: readonly string[] = [
  "attributes.hp",
  "resources.heroPoints",
  "resources.focusPoints",
];

const CANONICAL_SET: ReadonlySet<string> = new Set(CANONICAL_PATHS);

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
 * The derivation pipeline mirrors `attributes.X` at `derived.X` and the bar
 * reads the derived twin first — so a pool found under `derived.` is OFFERED
 * under its `attributes.` name, keeping one resource one option.
 */
function canonicalize(path: string): string {
  return path.startsWith("derived.") ? "attributes." + path.slice("derived.".length) : path;
}

/**
 * Every dotted path in `system` whose leaf is a stored `{ value, max }` pair,
 * canonicalized and deduplicated, in stable depth-first key order — so the
 * dropdown is deterministic for a given actor.
 */
export function collectResourcePaths(system: unknown): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];

  function walk(node: Record<string, unknown>, prefix: string, depth: number): void {
    for (const key of Object.keys(node)) {
      const child = node[key];
      const path = prefix === "" ? key : `${prefix}.${key}`;
      if (isResourcePair(child)) {
        const canonical = canonicalize(path);
        if (!seen.has(canonical)) {
          seen.add(canonical);
          paths.push(canonical);
        }
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
  const key = `FUSION.Token.Config.BarAttr.${path}`;
  const translated = t(key);
  if (translated !== key) return translated;
  const segment = path.split(".").at(-1) ?? path;
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

/**
 * The options for one bar's `<select>`: "no bar", the canonical resources,
 * then discovered extras. A saved path that resolves nowhere is kept —
 * labelled as unresolved — because silently dropping it from the list would
 * rewrite the token on the next save without the GM ever choosing to.
 */
export function barAttributeOptions(
  system: unknown,
  current: string,
  t: (key: string) => string,
): BarAttributeOption[] {
  const extras = collectResourcePaths(system).filter((path) => !CANONICAL_SET.has(path));
  const offered = [...CANONICAL_PATHS, ...extras];
  const options: BarAttributeOption[] = [
    { value: "", label: t("FUSION.Token.Config.BarAttr.none") },
    ...offered.map((path) => ({ value: path, label: labelFor(path, t) })),
  ];
  if (current !== "" && !offered.includes(current)) {
    options.push({
      value: current,
      label: `${current} ${t("FUSION.Token.Config.BarAttr.unresolved")}`,
    });
  }
  return options;
}
