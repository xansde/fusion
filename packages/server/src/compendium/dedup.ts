/**
 * Cross-system document dedup for the mundo misto (pf2e + sf2e composite
 * system, DEC-SF2-07-bis, spec 18).
 *
 * Two documents from DIFFERENT source systems (e.g. one from `systems/pf2e`,
 * one from `systems/sf2e`) are the SAME item — and must appear only ONCE in
 * the composite world's compendium index — when they share:
 *   - the same `type` (Foundry document subtype, e.g. "feat", "action"),
 *   - the same slug (derived from `name`),
 *   - the same normalized mechanics: `traits`, `actionType`/`actions`/
 *     `category`, `prerequisites`, and `rules` (with every
 *     `@UUID[Compendium.<system>...]` reference neutralized so a rule that
 *     only differs by pointing at its own system's namespace still counts as
 *     identical).
 *
 * `description`, `system.publication`, `img`, `_id`, `folder`, `_stats`,
 * `sort` and `ownership` are ALWAYS ignored — they vary by design between the
 * two vendor extractions of the same rule text (see
 * `.fusion-build/sf2e-nivel3/mundo-misto/desenho.md` §1 and
 * `.fusion-build/sf2e-nivel3/mundo-misto/dedup.md`).
 *
 * This module is PURE (no file I/O, no CompendiumService dependency) so it
 * can be unit-tested directly against fixture documents. `CompendiumService`
 * wires it in `_ensureDedupIndex()`.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The minimal shape this module needs from a loaded compendium document. */
export interface DedupDoc {
  _id: string;
  name?: unknown;
  type?: unknown;
  system?: unknown;
}

/** One pack's worth of raw documents, keyed by the pack's own Fusion id. */
export interface DedupPackInput {
  packId: string;
  systemId: string;
  docs: DedupDoc[];
}

/** `${packId}\u0000${docId}` — the key used throughout this module. */
export type DocKey = string;

export interface DedupResult {
  /**
   * Documents that must NOT appear in the composite world's index/search —
   * they are the LOSING duplicate of a fused pair. Empty when fewer than 2
   * distinct systemIds are present (a pure pf2e or pure sf2e world never
   * loses a document — REQ from the task: "mundos pf2e e sf2e puros não
   * mudam").
   */
  hidden: Set<DocKey>;
  /**
   * Losing document key → its canonical (winning) document key. Used to
   * redirect any resolution of the hidden doc's own uuid/sourceId (grant
   * items, cross-pack search, `compendium:get`) to the surviving copy.
   */
  aliasTo: Map<DocKey, DocKey>;
  /**
   * Canonical document key → the OTHER systemIds that were merged into it
   * (i.e. every systemId whose homonym was hidden in favor of this one). Used
   * to show "origin" on a fused index entry (`index.mergedFromSystems`).
   */
  mergedFromSystems: Map<DocKey, string[]>;
}

const EMPTY_RESULT: DedupResult = {
  hidden: new Set(),
  aliasTo: new Map(),
  mergedFromSystems: new Map(),
};

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export function slugify(name: unknown): string {
  const raw = typeof name === "string" ? name : "";
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Neutralizes `@UUID[Compendium.<systemId>.<pack>.<DocType>.<id>]` references
 * inside rule text/JSON so a rule that differs ONLY by pointing at its own
 * system's compendium namespace (pf2e vs sf2e) normalizes identically. The
 * per-copy document id is also stripped (each system's importer run assigns
 * its own opaque Foundry `_id`, so it carries no mechanical signal).
 */
function neutralizeUuidRefs(str: string): string {
  return str.replace(
    /@UUID\[Compendium\.(pf2e|sf2e)\.([a-z0-9-]+)\.(Item|Actor|JournalEntry)\.[A-Za-z0-9]+\]/g,
    (_m, _sys: string, pack: string, docType: string) =>
      `@UUID[Compendium.*.${pack.replace(/^(pf2e|sf2e)[-.]?/, "")}.${docType}.*]`,
  );
}

function deepNeutralize(value: unknown): unknown {
  if (typeof value === "string") return neutralizeUuidRefs(value);
  if (Array.isArray(value)) return value.map(deepNeutralize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj).sort()) {
      out[key] = deepNeutralize(obj[key]);
    }
    return out;
  }
  return value;
}

function normalizePrerequisites(value: unknown): unknown {
  if (!Array.isArray(value)) return value ?? null;
  const normalized: unknown[] = (value as unknown[]).map((p) => {
    if (p && typeof p === "object") {
      const v = (p as Record<string, unknown>)["value"];
      if (typeof v === "string") return v.trim().toLowerCase();
    }
    return p;
  });
  return normalized.sort((a, b) => {
    const sa = typeof a === "string" ? a : JSON.stringify(a);
    const sb = typeof b === "string" ? b : JSON.stringify(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  });
}

/**
 * Builds the fingerprint used to decide "same item": `type` + slug(name) +
 * normalized mechanics. Two documents with an identical fingerprint (from
 * different systems) fuse into one.
 */
export function mechanicsFingerprint(doc: DedupDoc): string {
  const sys = (doc.system && typeof doc.system === "object" ? doc.system : {}) as Record<
    string,
    unknown
  >;
  const traitsRaw = sys["traits"];
  const traitsValue =
    traitsRaw && typeof traitsRaw === "object"
      ? (traitsRaw as Record<string, unknown>)["value"]
      : undefined;
  const traits = Array.isArray(traitsValue) ? [...(traitsValue as string[])].sort() : null;

  const mech = {
    type: doc.type ?? null,
    slug: slugify(doc.name),
    level: sys["level"] ?? sys["rank"] ?? null,
    traits,
    actionType: sys["actionType"] ?? null,
    actions: sys["actions"] ?? null,
    category: sys["category"] ?? null,
    prerequisites: normalizePrerequisites(sys["prerequisites"]),
    rules: deepNeutralize(sys["rules"] ?? []),
  };
  return JSON.stringify(mech);
}

// ---------------------------------------------------------------------------
// Dedup index builder
// ---------------------------------------------------------------------------

function docKey(packId: string, docId: string): DocKey {
  return `${packId}\u0000${docId}`;
}

/** `pf2e` wins ties against any other system (the composite reuses the PF2e
 * shape verbatim per DEC-SYS-06-bis); any other pair falls back to
 * alphabetical systemId order so the result stays deterministic. */
function systemPriority(systemId: string): number {
  return systemId === "pf2e" ? 0 : 1;
}

/**
 * Builds the dedup index across every pack currently loaded by the
 * `CompendiumService`. A no-op (empty result) when the packs span a single
 * systemId — a pure pf2e or pure sf2e world never loses a document.
 */
export function buildDedupIndex(packs: DedupPackInput[]): DedupResult {
  const systemIds = new Set(packs.map((p) => p.systemId));
  if (systemIds.size < 2) return EMPTY_RESULT;

  const sortedPacks = [...packs].sort((a, b) => {
    const pa = systemPriority(a.systemId);
    const pb = systemPriority(b.systemId);
    if (pa !== pb) return pa - pb;
    return a.packId < b.packId ? -1 : a.packId > b.packId ? 1 : 0;
  });

  const canonicalByFingerprint = new Map<string, { key: DocKey; systemId: string }>();
  const hidden = new Set<DocKey>();
  const aliasTo = new Map<DocKey, DocKey>();
  const mergedFromSystems = new Map<DocKey, string[]>();

  for (const pack of sortedPacks) {
    for (const doc of pack.docs) {
      if (typeof doc._id !== "string") continue;
      const key = docKey(pack.packId, doc._id);
      const fp = mechanicsFingerprint(doc);
      const existing = canonicalByFingerprint.get(fp);
      if (!existing) {
        canonicalByFingerprint.set(fp, { key, systemId: pack.systemId });
        continue;
      }
      if (existing.systemId === pack.systemId) {
        // Same-system homonym (e.g. two feats with identical mechanics
        // inside the same system) — not this rule's concern, leave both.
        continue;
      }
      hidden.add(key);
      aliasTo.set(key, existing.key);
      const list = mergedFromSystems.get(existing.key) ?? [];
      if (!list.includes(pack.systemId)) list.push(pack.systemId);
      mergedFromSystems.set(existing.key, list);
    }
  }

  return { hidden, aliasTo, mergedFromSystems };
}

export function parseDocKey(key: DocKey): { packId: string; docId: string } {
  const idx = key.indexOf("\u0000");
  return { packId: key.slice(0, idx), docId: key.slice(idx + 1) };
}

export { docKey as buildDocKey };
