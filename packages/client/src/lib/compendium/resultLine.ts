/**
 * resultLine.ts — the view model of one line of the Compendium tab.
 *
 * Spec 43 (`specs/43-aba-compendio.md`) §5.5. A line is the same object in both
 * bodies — the aggregated result over the whole collection and the index of an
 * open pack — so it is built here once, as pure data, and drawn by
 * `components/compendium/CompendiumResultLine.svelte`.
 *
 * What the line owes the reader:
 *
 *   - **Two names** (REQ-CPD-040, DEC-CPD-06): the translated name in front and
 *     the original underneath when both exist. The table says "Bola de Fogo",
 *     the book says "Fireball", and whoever types either has to find it — so
 *     hiding the original would break the cross-check against the source.
 *   - **The fields the PACK declared** (REQ-CPD-041): `PackManifest.indexFields`
 *     is the contract, and every value already travels in `PackIndexEntry.index`.
 *     Nothing here loads a document to draw a line (DEC-CMP-02).
 *   - **The matched run, marked** (REQ-CPD-042) — as segments, never as HTML, so
 *     the drawing side never has to trust a string with `@html`.
 *   - **The "in world" seal** (REQ-CPD-043), which informs and promises nothing:
 *     bringing an entry over clones it with a fresh `_id` and the clone does not
 *     follow the pack (DEC-CPD-12). The seal exists to prevent the common
 *     duplicate import, not to assert the two are equal — and it never blocks
 *     (REQ-CPD-064).
 *   - **Drag only where there is somewhere to drop** (REQ-CPD-044).
 *   - **A picture-shaped hole that is never a hole** (REQ-CPD-045): a broken or
 *     placeholder image resolves to a drawn type icon in the same box.
 *   - **No creature statistics for an unprivileged reader** (REQ-CPD-046) — the
 *     pack audience already keeps the bestiary away from the table (§5.8); this
 *     is the same rule restated where the pixels are.
 */

import type { PackIndexEntry } from "@fusion/shared";
import { normalizeSearchText } from "@fusion/shared";

import { entryDisplayName, entrySecondaryName } from "./compendiumBrowser.js";
import type { SupportedLocale } from "../i18n/i18n.js";

// ---------------------------------------------------------------------------
// Highlighting the run that matched (REQ-CPD-042)
// ---------------------------------------------------------------------------

/** One run of text, told apart by whether the search matched it. */
export interface HighlightSegment {
  readonly text: string;
  readonly matched: boolean;
}

/**
 * Split `text` into matched and unmatched runs against `query`, ignoring case
 * and accents — the same normalization the search itself uses
 * (`normalizeSearchText`, REQ-CMP-013), so what the panel marks is exactly what
 * the server matched.
 *
 * Normalizing character by character (instead of normalizing the whole string
 * and slicing by the result's offsets) is what keeps the marked run aligned
 * with the ORIGINAL text: NFD turns one accented character into two and the
 * accent strip turns it back into one, but only for precomposed input — an
 * already-decomposed string shifts every offset after it. The per-character map
 * makes the alignment true for both.
 */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const needle = normalizeSearchText(query.trim());
  if (needle.length === 0 || text.length === 0) {
    return text.length > 0 ? [{ text, matched: false }] : [];
  }

  const { normalized, offsets } = mapNormalized(text);
  const segments: HighlightSegment[] = [];
  let cursor = 0; // index into `normalized`
  let plainFrom = 0; // index into `text`

  for (;;) {
    const hit = normalized.indexOf(needle, cursor);
    if (hit === -1) break;

    const start = offsets[hit] ?? text.length;
    const end = offsets[hit + needle.length] ?? text.length;
    if (start > plainFrom) segments.push({ text: text.slice(plainFrom, start), matched: false });
    if (end > start) segments.push({ text: text.slice(start, end), matched: true });

    plainFrom = end;
    cursor = hit + needle.length;
  }

  if (segments.length === 0) return [{ text, matched: false }];
  if (plainFrom < text.length) segments.push({ text: text.slice(plainFrom), matched: false });
  return segments;
}

/** Whether any run of `text` matched `query` — the cheap form of the above. */
export function matchesQuery(text: string, query: string): boolean {
  const needle = normalizeSearchText(query.trim());
  if (needle.length === 0) return false;
  return normalizeSearchText(text).includes(needle);
}

/**
 * `normalized` plus, for each of its characters, the index in `text` it came
 * from. `offsets` carries one extra entry (the length of `text`) so the end of
 * a match landing on the last character still resolves.
 */
function mapNormalized(text: string): { normalized: string; offsets: number[] } {
  let normalized = "";
  const offsets: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const piece = normalizeSearchText(text.charAt(i));
    for (let k = 0; k < piece.length; k += 1) offsets.push(i);
    normalized += piece;
  }
  offsets.push(text.length);
  return { normalized, offsets };
}

// ---------------------------------------------------------------------------
// The "in world" seal (REQ-CPD-043, DEC-CPD-12)
// ---------------------------------------------------------------------------

/**
 * Which pack entries already have a document of their own in the world.
 *
 * Identity is the ORIGIN reference the importer stamps and the import
 * deliberately preserves — `flags.fusion.sourceId`, paired with
 * `flags.fusion.packName` when both sides carry one. The world copy gets a new
 * `_id` (REQ-CMP-021), so `_id` proves nothing; the origin flags are the only
 * thing that survives the clone.
 *
 * WHY sourceId ALONE IS ENOUGH TODAY, and why the pair is still honoured: the
 * committed packs declare `flags.fusion.sourceId` in `indexFields` but not
 * `flags.fusion.packName`, so an index entry can offer only half the pair. The
 * halves are disjoint in practice (a vendor source id names one document), and
 * this seal is explicitly a hint that promises nothing (DEC-CPD-12) and never
 * blocks an import (REQ-CPD-064) — so the cost of the residual ambiguity is a
 * seal shown one time too many, not a document lost. When an entry DOES declare
 * its `packName`, the pair is required to agree, so improving the manifest
 * tightens the seal without touching this code.
 */
export interface WorldOriginIndex {
  /** `sourceId → the pack names world documents recorded for it` (may be empty). */
  readonly bySourceId: ReadonlyMap<string, ReadonlySet<string>>;
}

export const EMPTY_WORLD_ORIGIN_INDEX: WorldOriginIndex = { bySourceId: new Map() };

/** `flags.fusion.sourceId` path, as the packs declare it in `indexFields`. */
const SOURCE_ID_PATH = "flags.fusion.sourceId";
/** `flags.fusion.packName` path — honoured when a pack chooses to declare it. */
const PACK_NAME_PATH = "flags.fusion.packName";

/**
 * Read the origin flags off the world documents the caller passes in — the
 * Actors and Items of the world mirror. Embedded items of a sheet are NOT
 * scanned on purpose: "in world" means the world directory holds a document of
 * its own, which is what a second import would duplicate; a feat living inside
 * a character came in through the sheet (REQ-CPD-061) and duplicating it there
 * is the sheet's business, not this panel's.
 */
export function buildWorldOriginIndex(docs: readonly unknown[]): WorldOriginIndex {
  const bySourceId = new Map<string, Set<string>>();
  for (const doc of docs) {
    const fusion = readFusionFlags(doc);
    if (fusion === null) continue;
    const sourceId = readString(fusion["sourceId"]);
    if (sourceId === undefined) continue;
    const packName = readString(fusion["packName"]);
    const bucket = bySourceId.get(sourceId);
    if (bucket) {
      if (packName !== undefined) bucket.add(packName);
    } else {
      bySourceId.set(sourceId, new Set(packName !== undefined ? [packName] : []));
    }
  }
  return { bySourceId };
}

/** Whether the world already holds a document that came from this entry. */
export function entryIsInWorld(entry: PackIndexEntry, index: WorldOriginIndex): boolean {
  const sourceId = readString(entry.index[SOURCE_ID_PATH]);
  if (sourceId === undefined) return false;
  const packNames = index.bySourceId.get(sourceId);
  if (packNames === undefined) return false;

  const entryPackName = readString(entry.index[PACK_NAME_PATH]);
  if (entryPackName === undefined || packNames.size === 0) return true;
  return packNames.has(entryPackName);
}

function readFusionFlags(doc: unknown): Record<string, unknown> | null {
  const record = asRecord(doc);
  const flags = record === null ? null : asRecord(record["flags"]);
  return flags === null ? null : asRecord(flags["fusion"]);
}

// ---------------------------------------------------------------------------
// Drag destinations (REQ-CPD-044)
// ---------------------------------------------------------------------------

/**
 * The document types §5.7 gives somewhere to land: an Actor entry can be
 * dragged onto the scene (REQ-CPD-062) and an Item entry onto a sheet
 * (REQ-CPD-061). Everything else has no destination yet, and a line that
 * cannot be dropped anywhere must not pretend it can be picked up
 * (REQ-CPD-044) — the refusal in REQ-CPD-063 is for what slips past this.
 */
const DRAGGABLE_DOCUMENT_TYPES: ReadonlySet<string> = new Set(["Actor", "Item"]);

export function hasDragDestination(documentType: string): boolean {
  return DRAGGABLE_DOCUMENT_TYPES.has(documentType);
}

// ---------------------------------------------------------------------------
// Index fields (REQ-CPD-041) and what an unprivileged reader may not see
// (REQ-CPD-046)
// ---------------------------------------------------------------------------

/**
 * Index paths that are creature statistics. An unprivileged reader never sees
 * them on a line — hit points, armour class, saves, abilities and the rest of
 * the defensive block. The pack audience already keeps the bestiary off the
 * player's shelf (REQ-CPD-071); this list is the same rule restated as a screen
 * rule, so a pack published as `all` by mistake still cannot leak a stat block
 * one line at a time.
 *
 * Level and traits deliberately stay: they are how the reader filters and sorts
 * (REQ-CPD-033), they are printed on every published stat line, and removing
 * them would gut the list without protecting anything the audience gate does
 * not already protect.
 */
const CREATURE_STAT_PREFIXES: readonly string[] = [
  "system.attributes.",
  "system.saves.",
  "system.abilities.",
  "system.resources.",
  "system.perception",
];

export function isCreatureStatField(path: string): boolean {
  return CREATURE_STAT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Index paths that exist for machinery, not for reading: the origin flags that
 * feed the seal, and the name that is already the line's headline.
 */
const NON_DISPLAY_FIELDS: ReadonlySet<string> = new Set(["name", SOURCE_ID_PATH, PACK_NAME_PATH]);

function isDisplayableField(path: string): boolean {
  return !NON_DISPLAY_FIELDS.has(path) && !path.startsWith("flags.");
}

/** One declared index field, ready to draw. */
export interface ResultLineField {
  /** Unique `{#each}` key — the declared path, which a manifest lists once. */
  readonly key: string;
  /** Translation key for the field's name. */
  readonly labelKey: string;
  /** What to show when no bundle defines `labelKey` — never the raw key. */
  readonly fallbackLabel: string;
  /** The value, already flattened to text. */
  readonly value: string;
  /** The value split on the search, so a match inside a field is marked too. */
  readonly segments: readonly HighlightSegment[];
}

/** Translation key for a declared index path. */
export function fieldLabelKey(path: string): string {
  return `FUSION.Compendium.Field.${path}`;
}

/**
 * Last meaningful segment of a dotted path, title-cased — the label of last
 * resort for a field no bundle names. `system.level.value` → "Level", because a
 * pack may declare anything and a missing string must still read as a word
 * rather than as `FUSION.Compendium.Field.system.level.value`.
 */
export function fieldFallbackLabel(path: string): string {
  const parts = path.split(".").filter((part) => part.length > 0);
  const tail = parts.filter((part) => part !== "value" && part !== "system");
  const word =
    (tail.length > 0 ? tail[tail.length - 1] : (parts[parts.length - 1] ?? path)) ?? path;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Resolve a field's label through the caller's translator, falling back to the
 * derived word when the bundle has no string for it (the resolver answers with
 * the raw key when it misses).
 */
export function resolveFieldLabel(
  field: ResultLineField,
  translate: (key: string) => string,
): string {
  const resolved = translate(field.labelKey);
  return resolved === field.labelKey ? field.fallbackLabel : resolved;
}

/**
 * Flatten an index value to display text; `null` when there is nothing to show.
 *
 * Booleans are dropped rather than rendered: a bare "true" beside a path-derived
 * label reads as noise, and spelling it as a word would need a string per field
 * that no manifest currently declares. A pack that wants a flag on the line can
 * declare it as text.
 */
function formatIndexValue(value: unknown): string | null {
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => formatIndexValue(item))
      .filter((s): s is string => s !== null);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The line itself
// ---------------------------------------------------------------------------

/** The drawn shape of a type icon; the component owns the path data. */
export type ResultLineIcon =
  | "actor"
  | "item"
  | "journal"
  | "table"
  | "macro"
  | "scene"
  | "playlist"
  | "unknown";

const ICON_BY_TYPE: Readonly<Record<string, ResultLineIcon>> = {
  Actor: "actor",
  Item: "item",
  JournalEntry: "journal",
  RollTable: "table",
  Macro: "macro",
  Scene: "scene",
  Playlist: "playlist",
};

/** Which icon stands in for a document type when there is no usable image. */
export function resultLineIcon(documentType: string): ResultLineIcon {
  return ICON_BY_TYPE[documentType] ?? "unknown";
}

/**
 * Paths the importer wrote when it could not carry an asset over. They were
 * never served, so requesting them only produces a broken-image glyph
 * (REQ-CPD-045) — the line skips straight to the drawn icon.
 */
export function isPlaceholderImage(img: string | null | undefined): boolean {
  if (img === null || img === undefined || img.length === 0) return true;
  return img.startsWith("icons/placeholder");
}

/** Everything one line needs to draw itself. */
export interface ResultLine {
  readonly uuid: string;
  /** Stable `{#each}` key — the uuid is unique across packs. */
  readonly key: string;
  readonly documentType: string;
  readonly subtype: string | null;
  /** Translated name, split on the search (REQ-CPD-040, REQ-CPD-042). */
  readonly name: readonly HighlightSegment[];
  /** Plain translated name, for `title`/`aria-label`. */
  readonly nameText: string;
  /** Original name underneath, or null when it would only repeat the headline. */
  readonly secondaryName: readonly HighlightSegment[] | null;
  readonly secondaryNameText: string | null;
  /** Image to request, or null when the icon takes the same box (REQ-CPD-045). */
  readonly imageSrc: string | null;
  readonly icon: ResultLineIcon;
  readonly fields: readonly ResultLineField[];
  readonly inWorld: boolean;
  readonly draggable: boolean;
  readonly packId: string;
  /** Pack label, so an aggregated line names its source (REQ-CPD-031). */
  readonly packLabel: string | null;
}

/** What the panel knows and the entry does not. */
export interface ResultLineContext {
  readonly documentType: string;
  readonly packId: string;
  /** Shown only when the body mixes packs; null inside one open pack. */
  readonly packLabel?: string | null;
  /** `PackManifest.indexFields` — the pack's own list of what matters. */
  readonly indexFields?: readonly string[];
  readonly locale: SupportedLocale;
  /** Current search text; empty marks nothing. */
  readonly search?: string;
  /** `isRolePrivileged` of the reader, decided by the caller (REQ-CPD-046). */
  readonly viewerIsPrivileged: boolean;
  readonly worldOrigins?: WorldOriginIndex;
  /** Uuids whose `<img>` failed at runtime — the fallback is per line, live. */
  readonly brokenImages?: ReadonlySet<string>;
}

export function buildResultLine(entry: PackIndexEntry, ctx: ResultLineContext): ResultLine {
  const search = ctx.search ?? "";
  const nameText = entryDisplayName(entry, ctx.locale);
  const secondaryNameText = entrySecondaryName(entry, ctx.locale);
  const imageBroken = ctx.brokenImages?.has(entry.uuid) ?? false;
  const showImage = !imageBroken && !isPlaceholderImage(entry.img);

  return {
    uuid: entry.uuid,
    key: entry.uuid,
    documentType: ctx.documentType,
    subtype: entry.type,
    name: highlightSegments(nameText, search),
    nameText,
    secondaryName: secondaryNameText === null ? null : highlightSegments(secondaryNameText, search),
    secondaryNameText,
    imageSrc: showImage ? entry.img : null,
    icon: resultLineIcon(ctx.documentType),
    fields: buildResultLineFields(entry, ctx, search),
    inWorld: entryIsInWorld(entry, ctx.worldOrigins ?? EMPTY_WORLD_ORIGIN_INDEX),
    draggable: hasDragDestination(ctx.documentType),
    packId: ctx.packId,
    packLabel: ctx.packLabel ?? null,
  };
}

function buildResultLineFields(
  entry: PackIndexEntry,
  ctx: ResultLineContext,
  search: string,
): ResultLineField[] {
  const declared = ctx.indexFields ?? [];
  const fields: ResultLineField[] = [];
  const seen = new Set<string>();

  for (const path of declared) {
    if (seen.has(path) || !isDisplayableField(path)) continue;
    if (!ctx.viewerIsPrivileged && isCreatureStatField(path)) continue;
    const value = formatIndexValue(entry.index[path]);
    if (value === null) continue;
    seen.add(path);
    fields.push({
      key: path,
      labelKey: fieldLabelKey(path),
      fallbackLabel: fieldFallbackLabel(path),
      value,
      segments: highlightSegments(value, search),
    });
  }

  return fields;
}

// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
