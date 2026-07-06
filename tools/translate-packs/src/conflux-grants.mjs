/**
 * conflux-grants.mjs — CURATED extraction of "Conflux Spell" fixed-item grants
 * from class-feature DESCRIPTIONS (r15 A2).
 *
 * The Magus hybrid studies (Starlit Span, Inexorable Iron, Laughing Shadow,
 * Sparkling Targe, Twisting Tree, plus a few from other sources) each grant a
 * "Conflux Spell" — a specific focus spell the character learns. But the vendor
 * (and therefore Fusion's clean-room pack) carries this ONLY in the document's
 * prose, with an EMPTY `system.rules`:
 *
 *   <p><strong>Conflux Spell</strong>
 *      @UUID[Compendium.pf2e.spells-srd.Item.Shooting Star]</p>
 *
 * Foundry itself does NOT automate this — the user's feedback ("should appear
 * automatically on the spells screen") is a legitimate automation gap. So we
 * recover it by DETERMINISTIC pattern extraction: scan each doc's description
 * for the "Conflux Spell" + `@UUID[Compendium.<system>.<vendor>.Item.<Name>]`
 * pair and emit a `fixed-item` grant (source: "curated", confidence 1.0). The
 * client materializer then resolves the named spell in spells-core and places
 * it in the focus pool.
 *
 * This is CURATED (not a generic rule-element extraction) because the signal is
 * a human-authored prose convention, not a structured rule. The pattern is
 * unambiguous (a bolded label immediately followed by a single spell @UUID), so
 * confidence is 1.0.
 *
 * Pure — no I/O. Consumed by grants-from-rules.mjs (which handles pack reads).
 */

import { sha1, stableStringify } from "./hash.mjs";

/**
 * Matches `<strong>Conflux Spell</strong>` (tolerant of extra attributes/space)
 * immediately followed by a single `@UUID[Compendium.<system>.<vendor>.Item.<Name>]`
 * reference. Capture group 1 is the full "Compendium....Item.<Name>" uuid body
 * (without the surrounding `@UUID[...]`), group 2 is the vendor segment, group 3
 * is the document name.
 */
const CONFLUX_UUID_RE =
  /<strong>\s*Conflux Spell\s*<\/strong>\s*@UUID\[(Compendium\.[^.\]]+\.([^.\]]+)\.Item\.([^\]]+))\]/i;

/** Reads a doc's description as a plain string, tolerating both `system.description` (Fusion pack) and `system.description.value` (vendor) shapes. */
function descriptionText(doc) {
  const desc = doc?.system?.description;
  if (typeof desc === "string") return desc;
  if (desc && typeof desc === "object" && typeof desc.value === "string") return desc.value;
  return "";
}

/**
 * Extract the single Conflux Spell fixed-item grant declared in a doc's
 * description, or null if the doc has no such pattern. Returns the grant in the
 * shared `FixedItemGrantSchema` shape (kind: "fixed-item").
 *
 * Only the FIRST match is used: a class feature declares at most one Conflux
 * Spell (verified across the pack), and a lone bolded "Conflux Spell" label is
 * always paired with exactly one spell @UUID.
 */
export function extractConfluxGrant(doc) {
  const text = descriptionText(doc);
  if (!text) return null;
  const m = CONFLUX_UUID_RE.exec(text);
  if (!m) return null;
  const uuid = m[1];
  const vendor = m[2];
  const name = m[3].trim();
  if (!vendor || !name) return null;
  return {
    kind: "fixed-item",
    vendor,
    name,
    uuid,
    source: "curated",
    confidence: 1.0,
  };
}

/**
 * sourceHash for a conflux grant: sha1 over the DESCRIPTION (not the rules —
 * the conflux signal lives in prose). This regen key differs from
 * mechanicsSourceHash (rules-based) on purpose: a conflux grant becomes stale
 * only when the description's spell reference changes, so hashing the
 * description is the right invalidation signal. Feats-core's rule-element
 * overlay keeps its own rules-based hash unchanged (no churn).
 */
export function confluxSourceHash(doc) {
  return sha1(stableStringify({ description: descriptionText(doc) }));
}

/**
 * Scan every doc in a pack for a Conflux Spell fixed-item grant, returning an
 * entries map `{ [docId]: { sourceHash, grants: [FixedItemGrant], unlocks: [] } }`
 * for docs that have one. Docs without the pattern are omitted (lean overlay).
 *
 * The returned entries carry ONLY the fixed-item grant; grants-from-rules.mjs
 * merges these INTO the rule-element extraction (so a doc can have both a
 * ChoiceSet grant and a conflux grant — none do today, but the merge is
 * order-independent and additive).
 */
export function extractConfluxGrantsForPack(docs) {
  const entries = {};
  for (const doc of docs) {
    if (doc?.type !== "classFeature" && doc?.type !== "feat") continue;
    const grant = extractConfluxGrant(doc);
    if (!grant) continue;
    entries[doc._id] = {
      sourceHash: confluxSourceHash(doc),
      grants: [grant],
      unlocks: [],
    };
  }
  return entries;
}

/**
 * Merge conflux entries into an existing entries map (from the rule-element
 * extraction), appending conflux grants to any doc that already has a
 * rule-element entry and creating a fresh entry otherwise. Mutates + returns
 * `entries`. Additive and order-independent.
 */
export function mergeConfluxIntoEntries(entries, confluxEntries) {
  for (const [docId, conflux] of Object.entries(confluxEntries)) {
    const existing = entries[docId];
    if (existing) {
      existing.grants = [...(existing.grants ?? []), ...conflux.grants];
    } else {
      entries[docId] = conflux;
    }
  }
  return entries;
}
