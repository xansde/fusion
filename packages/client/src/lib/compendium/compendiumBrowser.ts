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
import type { CompendiumSearchPayload } from "@fusion/shared";

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
export interface DocumentPreview {
  name: string;
  img: string | null;
  type: string | null;
  /** Key-value pairs of relevant system fields for display. */
  fields: Array<{ label: string; value: string }>;
  licenseLabel: string;
}

/**
 * Build a preview from a loaded document.
 * System fields displayed depend on the document type.
 */
export function buildDocumentPreview(doc: Record<string, unknown>): DocumentPreview {
  const system = (doc["system"] ?? {}) as Record<string, unknown>;
  const type = typeof doc["type"] === "string" ? doc["type"] : null;
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

  return {
    name: typeof doc["name"] === "string" ? doc["name"] : "(sem nome)",
    img: typeof doc["img"] === "string" ? doc["img"] : null,
    type,
    fields,
    licenseLabel,
  };
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
