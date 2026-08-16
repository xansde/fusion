/**
 * compendiumBrowser.ts — pure-TS browser logic for compendium tab.
 *
 * REQ-CMP-012..018
 * Spec: 16-compendiums-e-importacao.md §Compendium browser (UI)
 *
 * This module is a pure TS module (no DOM/Svelte) for Vitest testability.
 * It provides filtering, grouping and drag payload building logic.
 *
 * The Svelte component (CompendiumBrowser.svelte) calls these functions to
 * compute display state from server data.
 */

import type { PackManifest, PackIndexEntry } from "@fusion/shared";
import { searchPackIndex, normalizeSearchText } from "@fusion/shared";
import type {
  CompendiumSearchPayload,
  CompendiumSearchAllPayload,
  CompendiumSearchFilters,
} from "@fusion/shared";
import type { ScopedSearchQuery } from "./browserScope.js";
import type { SupportedLocale } from "../i18n/i18n.js";

// ---------------------------------------------------------------------------
// Pack grouping
// ---------------------------------------------------------------------------

/** Packs grouped by documentType for the sidebar. REQ-CMP-012. */
export interface PackGroup {
  documentType: string;
  packs: PackManifest[];
}

/**
 * Group packs by documentType for the sidebar list.
 * Within each group, packs are sorted by label (pt-BR locale).
 */
export function groupPacksByType(packs: PackManifest[]): PackGroup[] {
  const byType = new Map<string, PackManifest[]>();

  for (const pack of packs) {
    const existing = byType.get(pack.documentType);
    if (existing) {
      existing.push(pack);
    } else {
      byType.set(pack.documentType, [pack]);
    }
  }

  const groups: PackGroup[] = [];
  for (const [docType, groupPacks] of byType) {
    groupPacks.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
    groups.push({ documentType: docType, packs: groupPacks });
  }

  // Sort groups by docType
  const ORDER: Record<string, number> = {
    Actor: 1,
    Item: 2,
    JournalEntry: 3,
    RollTable: 4,
    Macro: 5,
    Scene: 6,
    Playlist: 7,
  };
  groups.sort((a, b) => (ORDER[a.documentType] ?? 99) - (ORDER[b.documentType] ?? 99));

  return groups;
}

// ---------------------------------------------------------------------------
// Bilingual display (T1)
// ---------------------------------------------------------------------------
//
// The server attaches a pt-BR overlay to each served index entry: a flat
// `namePt` (denormalized for cheap search) plus an `i18n.ptBR` bag
// ({ name, description? }). EN `name` is ALWAYS the source-of-truth fallback.
// These helpers are the single decision point that consults the active
// `locale`, mirroring the character-sheet pickers (pickLocalizedName in
// documentDetails.ts) but reading directly off PackIndexEntry so the browser
// stays self-contained and unit-testable.

/** Narrow, read-only view of the `i18n.ptBR` bag on a served entry/doc. */
function entryPtBRName(entry: PackIndexEntry): string | undefined {
  // Prefer the flat namePt (always mirrors i18n.ptBR.name); fall back to the bag.
  if (typeof entry.namePt === "string" && entry.namePt.length > 0) return entry.namePt;
  const bag = entry.i18n?.ptBR;
  if (bag && typeof bag.name === "string" && bag.name.length > 0) return bag.name;
  return undefined;
}

/**
 * Display name for an index entry given the active locale.
 * pt-BR overlay name when locale is "pt-BR" and a translation exists; the EN
 * `name` otherwise (missing overlay, non-pt-BR locale, or empty translation).
 */
export function entryDisplayName(entry: PackIndexEntry, locale: SupportedLocale): string {
  if (locale === "pt-BR") {
    const pt = entryPtBRName(entry);
    if (pt !== undefined) return pt;
  }
  return entry.name;
}

/**
 * EN name shown as a secondary line beside a translated display name so the
 * reader can cross-reference the source material. Returns null when the
 * display name already equals the EN name (untranslated / non-pt-BR locale),
 * so the UI never renders a redundant "Name (Name)".
 */
export function entrySecondaryName(entry: PackIndexEntry, locale: SupportedLocale): string | null {
  const display = entryDisplayName(entry, locale);
  return display !== entry.name && entry.name.length > 0 ? entry.name : null;
}

// ---------------------------------------------------------------------------
// Client-side filtering
// ---------------------------------------------------------------------------

/**
 * Filter index entries client-side.
 * Used for instant feedback while the user types (pre-fetched index).
 * REQ-CMP-013, REQ-CMP-014.
 */
export function filterEntries(
  entries: PackIndexEntry[],
  query: CompendiumSearchPayload,
): PackIndexEntry[] {
  return searchPackIndex(entries, query);
}

/**
 * Build a search query from UI filter state.
 * REQ-CMP-014: PF2e-specific filters (type, traits, level).
 */
export interface BrowserFilterState {
  text: string;
  /** Subtype filter (e.g. "weapon", "spell", "npc"). */
  subtype?: string;
  /** Trait filter — entry must have this trait in system.traits.value. */
  trait?: string;
  /** Max level filter (system.level.value <= maxLevel). */
  maxLevel?: number;
  /** Min level filter (system.level.value >= minLevel). */
  minLevel?: number;
}

/**
 * Convert UI filter state to a CompendiumSearchPayload for the server.
 */
export function buildSearchQuery(
  packId: string,
  state: BrowserFilterState,
): CompendiumSearchPayload {
  const filters: CompendiumSearchPayload["filters"] = {};

  if (state.subtype) {
    // type is a direct field on the document
    filters["type"] = state.subtype;
  }

  if (state.trait) {
    // traits are stored in system.traits.value[]
    filters["system.traits.value"] = { contains: state.trait };
  }

  if (state.maxLevel !== undefined) {
    const existing = filters["system.level.value"];
    const existingRange =
      typeof existing === "object" && !Array.isArray(existing)
        ? (existing as { lte?: number; gte?: number })
        : {};
    filters["system.level.value"] = { ...existingRange, lte: state.maxLevel };
  }

  if (state.minLevel !== undefined) {
    const existing = filters["system.level.value"];
    const existingRange =
      typeof existing === "object" && !Array.isArray(existing)
        ? (existing as { lte?: number; gte?: number })
        : {};
    filters["system.level.value"] = { ...existingRange, gte: state.minLevel };
  }

  return {
    packId,
    text: state.text || undefined,
    filters: Object.keys(filters).length > 0 ? filters : undefined,
  };
}

// ---------------------------------------------------------------------------
// Aggregated search across every visible pack
// REQ-CPD-012 (the body at root scope), DEC-CPD-02 (the server owns the index)
// ---------------------------------------------------------------------------

/** One line of an aggregated result: an entry plus the pack it came from. */
export interface AggregatedSearchLine {
  readonly entry: PackIndexEntry;
  readonly packId: string;
  /** Pack label, so the line can name its source without the manifest. */
  readonly packLabel: string;
  readonly documentType: string;
}

/** The lines of one document type, plus how many the server left out. */
export interface AggregatedSearchGroup {
  readonly documentType: string;
  /** Matches in this group BEFORE the server's per-group limit. */
  readonly total: number;
  readonly lines: readonly AggregatedSearchLine[];
  /** `total - lines.length`, never negative — what the group could not show. */
  readonly omitted: number;
}

/** What the panel renders in aggregated-result mode. */
export interface AggregatedSearchResult {
  readonly groups: readonly AggregatedSearchGroup[];
}

/** i18n key for a document type heading; falls back to the raw type via `t()`. */
export function documentTypeLabelKey(documentType: string): string {
  return `FUSION.Compendium.DocType.${documentType}`;
}

/**
 * Turn the current scope's question into the `compendium:searchAll` payload.
 *
 * The facets that ARE index fields travel as `filters`, in exactly the shape the
 * per-pack search uses — a facet must not mean one thing in one scope and
 * another in the other (REQ-CPD-034). A scope confined to a pack never reaches
 * here: that search is answered by the pack's own index (REQ-CPD-014).
 */
export function buildSearchAllPayload(query: ScopedSearchQuery): CompendiumSearchAllPayload {
  const filters: CompendiumSearchFilters = {};

  const { minLevel, maxLevel, rarity } = query.facets;
  if (minLevel !== undefined || maxLevel !== undefined) {
    filters["system.level.value"] = {
      ...(minLevel !== undefined ? { gte: minLevel } : {}),
      ...(maxLevel !== undefined ? { lte: maxLevel } : {}),
    };
  }
  if (rarity !== undefined) filters["system.traits.rarity"] = rarity;

  return {
    ...(query.text !== undefined ? { text: query.text } : {}),
    ...(Object.keys(filters).length > 0 ? { filters } : {}),
  };
}

/**
 * Read a server aggregated-search answer into the shape the body renders.
 *
 * Tolerant on purpose: the ack is JSON off the wire, and a missing count or an
 * unexpected line must degrade to "show what came" instead of tearing the panel
 * down mid-search. Two shapes are accepted — already grouped (what the handler
 * of REQ-CPD-031 returns) and a flat list of lines, which is grouped here by
 * document type.
 */
export function normalizeAggregatedSearchResult(raw: unknown): AggregatedSearchResult {
  const root = asRecord(raw);
  if (!root) return { groups: [] };

  const rawGroups = root["groups"];
  if (Array.isArray(rawGroups)) {
    const groups: AggregatedSearchGroup[] = [];
    for (const item of rawGroups) {
      const group = asRecord(item);
      if (!group) continue;
      const lines = readLines(
        group["lines"] ?? group["entries"],
        readString(group["documentType"]),
      );
      const documentType =
        readString(group["documentType"]) ?? lines[0]?.documentType ?? UNKNOWN_DOCUMENT_TYPE;
      const total = readCount(group["total"], lines.length);
      groups.push({
        documentType,
        total,
        lines,
        omitted: Math.max(0, total - lines.length),
      });
    }
    return { groups };
  }

  const flat = readLines(root["lines"] ?? root["entries"], undefined);
  return { groups: groupLinesByType(flat) };
}

const UNKNOWN_DOCUMENT_TYPE = "Unknown";

function groupLinesByType(lines: readonly AggregatedSearchLine[]): AggregatedSearchGroup[] {
  const byType = new Map<string, AggregatedSearchLine[]>();
  for (const line of lines) {
    const bucket = byType.get(line.documentType);
    if (bucket) bucket.push(line);
    else byType.set(line.documentType, [line]);
  }
  return [...byType].map(([documentType, groupLines]) => ({
    documentType,
    total: groupLines.length,
    lines: groupLines,
    omitted: 0,
  }));
}

function readLines(raw: unknown, groupType: string | undefined): AggregatedSearchLine[] {
  if (!Array.isArray(raw)) return [];
  const lines: AggregatedSearchLine[] = [];
  for (const item of raw) {
    const line = readLine(item, groupType);
    if (line) lines.push(line);
  }
  return lines;
}

function readLine(raw: unknown, groupType: string | undefined): AggregatedSearchLine | null {
  const record = asRecord(raw);
  if (!record) return null;
  // Either { entry, packId, packLabel } or a flattened entry carrying the source.
  const entryRecord = asRecord(record["entry"]) ?? record;
  const uuid = readString(entryRecord["uuid"]);
  const name = readString(entryRecord["name"]);
  if (uuid === undefined || name === undefined) return null;

  const packId = readString(record["packId"]) ?? packIdFromUuid(uuid) ?? "";
  return {
    entry: entryRecord as unknown as PackIndexEntry,
    packId,
    packLabel: readString(record["packLabel"]) ?? packId,
    documentType:
      readString(record["documentType"]) ??
      groupType ??
      documentTypeFromUuid(uuid) ??
      UNKNOWN_DOCUMENT_TYPE,
  };
}

/** "Compendium.<packId>.<DocType>.<docId>" — REQ-CMP-009. */
function packIdFromUuid(uuid: string): string | undefined {
  const parts = uuid.split(".");
  return parts.length >= 4 ? parts.slice(1, parts.length - 2).join(".") : undefined;
}

function documentTypeFromUuid(uuid: string): string | undefined {
  const parts = uuid.split(".");
  return parts.length >= 4 ? parts[parts.length - 2] : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

// ---------------------------------------------------------------------------
// Drag payload (compendium → canvas / sheet)
// REQ-CMP-017, REQ-CMP-018
// ---------------------------------------------------------------------------

/** Discriminator for compendium drag payloads. */
export type CompendiumDragKind = "compendium-actor" | "compendium-item";

/** Payload carried during drag of a compendium entry. */
export interface CompendiumDragPayload {
  readonly kind: CompendiumDragKind;
  /** Full Compendium UUID. */
  readonly uuid: string;
  readonly packId: string;
  readonly documentType: string;
  readonly name: string;
  readonly img: string | null;
  readonly subtype: string | null;
}

/**
 * Build a drag payload for a compendium index entry.
 * Called when the user starts dragging an entry in the browser.
 */
export function buildCompendiumDragPayload(
  entry: PackIndexEntry,
  manifest: PackManifest,
): CompendiumDragPayload {
  const kind: CompendiumDragKind =
    manifest.documentType === "Actor" ? "compendium-actor" : "compendium-item";

  return {
    kind,
    uuid: entry.uuid,
    packId: manifest.id,
    documentType: manifest.documentType,
    name: entry.name,
    img: entry.img,
    subtype: entry.type,
  };
}

// ---------------------------------------------------------------------------
// Sort options
// ---------------------------------------------------------------------------

export type SortField = "name" | "level" | "type";

/**
 * Sort entries for display.
 */
export function sortEntries(
  entries: PackIndexEntry[],
  field: SortField = "name",
  asc = true,
): PackIndexEntry[] {
  const sorted = [...entries].sort((a, b) => {
    let cmp = 0;

    switch (field) {
      case "name":
        cmp = a.name.localeCompare(b.name, "pt-BR");
        break;
      case "level": {
        const aLv = a.index["system.level.value"];
        const bLv = b.index["system.level.value"];
        const la = typeof aLv === "number" ? aLv : 0;
        const lb = typeof bLv === "number" ? bLv : 0;
        cmp = la - lb;
        break;
      }
      case "type":
        cmp = (a.type ?? "").localeCompare(b.type ?? "", "pt-BR");
        break;
    }

    return asc ? cmp : -cmp;
  });

  return sorted;
}

// ---------------------------------------------------------------------------
// Document preview helpers
// ---------------------------------------------------------------------------

/**
 * Extract a human-readable summary from a full pack document.
 * REQ-CMP-015: preview shows name, img, license, and relevant system fields.
 */
export interface PreviewField {
  /**
   * Stable, unique key for {#each} keying. Two rules can map to the SAME
   * `label` (e.g. Confused has three rules that all fall back to "Regra"),
   * so the label alone is NOT a safe each-key — a duplicate key throws
   * `each_key_duplicate` and aborts the render. The key is `${label}#${index}`,
   * unique by construction and stable across re-renders of the same document.
   */
  key: string;
  label: string;
  value: string;
}

export interface DocumentPreview {
  name: string;
  /**
   * EN name shown as a secondary line when the localized `name` differs from
   * it (pt-BR translation active); null when they are equal (untranslated /
   * non-pt-BR locale).
   */
  nameSecondary: string | null;
  img: string | null;
  type: string | null;
  /**
   * Localized narrative description (pt-BR overlay preferred, EN fallback),
   * or null when the document carries none. Plain text — the browser preview
   * does not render prose HTML (that is DocumentDetailsPanel's job).
   */
  description: string | null;
  /** Key-value pairs of relevant system fields for display. */
  fields: PreviewField[];
  licenseLabel: string;
}

/**
 * Build a preview from a loaded document.
 * System fields displayed depend on the document type.
 *
 * @param doc    the full served document (may carry an `i18n.ptBR` overlay).
 * @param locale active UI locale; selects the localized name/description.
 */
export function buildDocumentPreview(
  doc: Record<string, unknown>,
  locale: SupportedLocale = "pt-BR",
): DocumentPreview {
  const system = (doc["system"] ?? {}) as Record<string, unknown>;
  const type = typeof doc["type"] === "string" ? doc["type"] : null;
  // Collected as {label, value}; keyed with a unique `key` once at the return.
  const fields: Array<{ label: string; value: string }> = [];

  // Common fields
  const level = extractNested(system, "level", "value");
  if (typeof level === "number" || typeof level === "string") {
    fields.push({ label: "Nível", value: String(level) });
  }

  const traits = extractNested(system, "traits", "value");
  if (Array.isArray(traits) && traits.length > 0) {
    fields.push({ label: "Traits", value: (traits as string[]).join(", ") });
  }

  // Actor-specific
  const hp = extractNested(system, "attributes", "hp", "max");
  if (typeof hp === "number" || typeof hp === "string") {
    fields.push({ label: "HP", value: String(hp) });
  }

  const ac = extractNested(system, "attributes", "ac", "value");
  if (typeof ac === "number" || typeof ac === "string") {
    fields.push({ label: "CA", value: String(ac) });
  }

  // Item (weapon) specific
  const damage = extractNested(system, "damage");
  if (damage !== null && damage !== undefined && typeof damage === "object") {
    const dmgObj = damage as Record<string, unknown>;
    const die = dmgObj["die"] as string | undefined;
    const dmgType = dmgObj["damageType"] as string | undefined;
    if (die) fields.push({ label: "Dano", value: `${die} ${dmgType ?? ""}`.trim() });
  }

  // Spell-specific
  const traditions = extractNested(system, "traditions", "value");
  if (Array.isArray(traditions) && traditions.length > 0) {
    fields.push({ label: "Tradições", value: (traditions as string[]).join(", ") });
  }

  // Mechanical effects — system.rules[] (structural only, never proprietary prose).
  const rules = system["rules"];
  if (Array.isArray(rules)) {
    for (const rule of rules as Array<Record<string, unknown>>) {
      fields.push(buildRuleField(rule));
    }
  }

  // License
  const pub = extractNested(system, "publication");
  const pubObj = typeof pub === "object" && pub !== null ? (pub as Record<string, unknown>) : null;
  const licenseLabel = typeof pubObj?.["license"] === "string" ? pubObj["license"] : "ORC";

  // Localized name/description (T1). The server attaches `i18n.ptBR` to the
  // served doc; prefer it when the locale is pt-BR, EN otherwise.
  const enName = typeof doc["name"] === "string" ? doc["name"] : "(sem nome)";
  const ptName = docPtBRName(doc);
  const name = locale === "pt-BR" && ptName !== undefined ? ptName : enName;
  const nameSecondary = name !== enName && enName.length > 0 ? enName : null;
  const description = pickPreviewDescription(doc, system, locale);

  return {
    name,
    nameSecondary,
    img: typeof doc["img"] === "string" ? doc["img"] : null,
    type,
    description,
    // Unique each-key per field: label + index. Guards against duplicate labels
    // (multiple rules mapping to the same pt-BR label) that would otherwise
    // throw `each_key_duplicate` and abort the preview render.
    fields: fields.map((f, i) => ({
      key: `${f.label}#${String(i)}`,
      label: f.label,
      value: f.value,
    })),
    licenseLabel,
  };
}

/** Read the doc-level pt-BR overlay name (`i18n.ptBR.name`), if present. */
function docPtBRName(doc: Record<string, unknown>): string | undefined {
  const bag = readDocI18nPtBR(doc);
  if (bag && typeof bag["name"] === "string" && bag["name"].length > 0) {
    return bag["name"];
  }
  return undefined;
}

/** Narrow read of `doc.i18n.ptBR` as an untyped bag; null when absent. */
function readDocI18nPtBR(doc: Record<string, unknown>): Record<string, unknown> | null {
  const i18n = doc["i18n"];
  if (i18n === null || typeof i18n !== "object" || Array.isArray(i18n)) return null;
  const ptBR = (i18n as Record<string, unknown>)["ptBR"];
  if (ptBR === null || typeof ptBR !== "object" || Array.isArray(ptBR)) return null;
  return ptBR as Record<string, unknown>;
}

/**
 * Pick the narrative description to show in the preview: the translated
 * `i18n.ptBR.description` when the locale is pt-BR and one exists, else the EN
 * `system.description`. Returns null when neither is a non-empty string.
 */
function pickPreviewDescription(
  doc: Record<string, unknown>,
  system: Record<string, unknown>,
  locale: SupportedLocale,
): string | null {
  if (locale === "pt-BR") {
    const ptDesc = readDocI18nPtBR(doc)?.["description"];
    if (typeof ptDesc === "string" && ptDesc.length > 0) return ptDesc;
  }
  const enDesc = system["description"];
  return typeof enDesc === "string" && enDesc.length > 0 ? enDesc : null;
}

/**
 * Convert a single system.rules[] entry into a readable preview field.
 * Maps the most common rule `kind`s to pt-BR labels; unmapped kinds fall
 * back to a generic representation so the preview never silently drops data.
 * REQ-CMP-015 (#4): mechanical effect visibility, never proprietary prose.
 */
/** Best-effort string for an unknown rule value: primitives only, else "?". */
function scalar(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "?";
}

function buildRuleField(rule: Record<string, unknown>): { label: string; value: string } {
  const kind = typeof rule["kind"] === "string" ? rule["kind"] : "unknown";
  const subkind = typeof rule["subkind"] === "string" ? rule["subkind"] : undefined;

  if (kind === "flat-modifier" && subkind === "immunity") {
    return { label: "Imunidade", value: scalar(rule["damageType"] ?? rule["selector"]) };
  }

  if (kind === "flat-modifier") {
    const selector = typeof rule["selector"] === "string" ? rule["selector"] : "?";
    const value = rule["value"];
    const sign = typeof value === "number" && value >= 0 ? "+" : "";
    const type = typeof rule["type"] === "string" ? ` (${rule["type"]})` : "";
    return { label: "Modificador", value: `${selector} ${sign}${scalar(value)}${type}` };
  }

  if (kind === "resistance") {
    const target = scalar(rule["damageType"] ?? rule["selector"]);
    const value = rule["value"];
    return {
      label: "Resistência",
      value: value !== undefined ? `${target} ${scalar(value)}` : target,
    };
  }

  if (kind === "weakness") {
    const target = scalar(rule["damageType"] ?? rule["selector"]);
    const value = rule["value"];
    return {
      label: "Fraqueza",
      value: value !== undefined ? `${target} ${scalar(value)}` : target,
    };
  }

  if (kind === "note") {
    const title = typeof rule["title"] === "string" ? rule["title"] : "Nota";
    return { label: "Nota", value: title };
  }

  // Generic fallback: kind + best-effort key field, so no rule is silently dropped.
  const detailKey = Object.keys(rule).find((k) => k !== "kind" && k !== "key");
  const detail = detailKey ? `${detailKey}: ${scalar(rule[detailKey])}` : "";
  return { label: "Regra", value: detail ? `${kind} — ${detail}` : kind };
}

function extractNested(obj: Record<string, unknown>, ...keys: string[]): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = obj;
  for (const k of keys) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Image fallback helper
// REQ-CMP-012, REQ-CMP-015 (#2): graceful placeholder instead of broken <img>
// ---------------------------------------------------------------------------

/**
 * Emoji fallback shown when an entry has no usable image.
 * Chosen by documentType/subtype so entries remain visually distinguishable.
 */
export function fallbackIcon(documentType: string, subtype: string | null): string {
  if (documentType === "Actor") {
    if (subtype === "npc" || subtype === "hazard") return "\u{1F47E}"; // 👾
    return "\u{1F9D9}"; // 🧙
  }
  if (documentType === "Item") {
    switch (subtype) {
      case "weapon":
        return "⚔️"; // ⚔️
      case "armor":
        return "\u{1F6E1}️"; // 🛡️
      case "spell":
        return "✨"; // ✨
      case "consumable":
        return "\u{1F9EA}"; // 🧪
      case "condition":
        return "⚠️"; // ⚠️
      default:
        return "\u{1F4E6}"; // 📦
    }
  }
  if (documentType === "JournalEntry") return "\u{1F4D6}"; // 📖
  if (documentType === "RollTable") return "\u{1F3B2}"; // 🎲
  if (documentType === "Macro") return "⚙️"; // ⚙️
  if (documentType === "Scene") return "\u{1F5FA}️"; // 🗺️
  if (documentType === "Playlist") return "\u{1F3B5}"; // 🎵
  return "❓"; // ❓
}

/**
 * Known placeholder paths were never populated with real assets (no HTTP
 * route serves /icons/*). Detect them so the UI can skip the request
 * entirely instead of rendering a broken-image icon.
 */
export function isKnownPlaceholderImg(img: string | null | undefined): boolean {
  if (!img) return true;
  return img.startsWith("icons/placeholder");
}

// ---------------------------------------------------------------------------
// Accent-insensitive text highlighting helper
// ---------------------------------------------------------------------------

/**
 * Produce HTML with matching query characters wrapped in <mark>.
 * Accent-insensitive.
 * REQ-CMP-013.
 */
export function highlightMatch(text: string, query: string): string {
  if (!query.trim()) return escapeHtml(text);

  const normalText = normalizeSearchText(text);
  const normalQuery = normalizeSearchText(query);

  const idx = normalText.indexOf(normalQuery);
  if (idx === -1) return escapeHtml(text);

  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + normalQuery.length);
  const after = text.slice(idx + normalQuery.length);

  return `${escapeHtml(before)}<mark>${escapeHtml(match)}</mark>${escapeHtml(after)}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
