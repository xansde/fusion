/**
 * documentDetails.ts — pure-TS helpers for the picker side/bottom details
 * panel (W2-C2, feedback: "ao clicar, abrir uma caixa na lateral mostrando
 * descrição, traits, rolagens, teste, etc.").
 *
 * REQ-CMP-009, REQ-CMP-015 (preview)
 * Spec: 16-compendiums-e-importacao.md §API e eventos
 *
 * This module is pure TS (no DOM/Svelte) for Vitest testability. It is
 * consumed by SpellPickerDialog.svelte (and, once the plan/** picker lands
 * on a compatible shape, CompendiumPickerDialog.svelte) to render a details
 * panel once a row is selected and its full document has been fetched via
 * compendiumApi.getDocument(uuid).
 *
 * Two independent concerns:
 *   1. sanitizeDescriptionHtml — vendor system.description HTML → safe,
 *      renderable HTML: strips all tags except a small allow-list
 *      (p/strong/em/b/i/ul/ol/li/br/hr), and rewrites inline
 *      @UUID[...]{Label} / @Damage[...] / @Check[...] / @Template[...]
 *      reference tags into their human-readable label text (never executed
 *      — V2 per the task's item 2).
 *   2. buildMechanicalFields — extracts the type-specific mechanical fields
 *      (spell: time/range/area/target/duration/save/damage/heighten; feat:
 *      prerequisites/frequency; classFeature: level) from a full document's
 *      `system` block, for display above the description.
 *
 * Clean-room: description prose is rendered verbatim (already
 * license-gated at import time — W2-C1/stripFlavorProse, ORC/OGL only);
 * this module does not decide what prose is redistributable, it only
 * renders whatever the server already sent.
 */

// ---------------------------------------------------------------------------
// HTML sanitization + @Tag[...] rewriting
// ---------------------------------------------------------------------------

const ALLOWED_TAGS = new Set(["p", "strong", "em", "b", "i", "ul", "ol", "li", "br", "hr"]);

/**
 * Find the index of the `]` that closes the bracket opened at `openIdx`
 * (which must point at a `[`), accounting for nested `[...]` (e.g.
 * `@Damage[(1d4)[fire]]`). Returns -1 if unbalanced.
 */
function findMatchingBracket(text: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Rewrite one `@Tag[...]{...}` inline reference into readable text.
 *
 * - `@UUID[Compendium.pf2e.pack.Item.Name]{Label}` → "Label"
 * - `@UUID[Compendium.pf2e.pack.Item.Name]` (no label) → "Name" (last path
 *   segment — vendor UUIDs with no explicit label use the document name).
 * - `@Damage[formula[type]]{label}` / no label → the raw formula text (kept
 *   as visible plain text; never executed, per the task's V2 note).
 * - `@Check[...]`, `@Template[...]` → same: explicit `{label}` wins,
 *   otherwise a best-effort readable fallback built from the bracket body.
 */
function rewriteInlineTag(tagName: string, bracketBody: string, label: string | null): string {
  if (label) return label;

  if (tagName === "UUID") {
    const lastSegment = bracketBody.split(".").pop();
    return lastSegment && lastSegment.trim() ? lastSegment.trim() : bracketBody;
  }

  if (tagName === "Damage") {
    // Strip the trailing [damageType] tag for a shorter fallback, e.g.
    // "(1d4+2)[fire]" -> "(1d4+2) fire".
    const m = /^(.*)\[([^\]]+)]$/.exec(bracketBody);
    return m ? `${m[1]} ${m[2]}` : bracketBody;
  }

  if (tagName === "Check") {
    const [statistic, ...opts] = bracketBody.split("|");
    const dcOpt = opts.find((o) => o.startsWith("dc:"));
    const dc = dcOpt ? dcOpt.slice(3) : null;
    return dc ? `${statistic} (DC ${dc})` : (statistic ?? bracketBody);
  }

  // @Template and any other unknown inline tag: show the raw bracket body.
  return bracketBody;
}

/**
 * Replace every `@Tag[...]{...}` inline reference in `text` with its
 * human-readable form (see {@link rewriteInlineTag}).
 */
function rewriteInlineTags(text: string): string {
  let result = "";
  let i = 0;

  while (i < text.length) {
    const match = /@([A-Za-z]+)\[/.exec(text.slice(i));
    if (!match) {
      result += text.slice(i);
      break;
    }
    const tagStart = i + match.index;
    const bracketOpen = tagStart + match[0].length - 1;
    result += text.slice(i, tagStart);

    const bracketClose = findMatchingBracket(text, bracketOpen);
    if (bracketClose === -1) {
      // Unbalanced — treat the rest as plain text rather than dropping it.
      result += text.slice(tagStart);
      break;
    }

    const bracketBody = text.slice(bracketOpen + 1, bracketClose);
    let label: string | null = null;
    let cursor = bracketClose + 1;
    if (text[cursor] === "{") {
      const labelClose = text.indexOf("}", cursor);
      if (labelClose !== -1) {
        label = text.slice(cursor + 1, labelClose);
        cursor = labelClose + 1;
      }
    }

    result += rewriteInlineTag(match[1] ?? "", bracketBody, label);
    i = cursor;
  }

  return result;
}

/**
 * Strip HTML tags outside the allow-list while preserving paragraph/list
 * structure as plain-text line breaks, then rewrite inline `@Tag[...]`
 * references to readable text.
 *
 * Output is plain text (no HTML) with `\n\n` between block-level elements
 * (p/li/hr) — callers that need HTML rendering wrap paragraphs themselves;
 * this keeps the function trivially safe (no HTML re-injection surface)
 * since nothing here is inserted into the DOM as markup.
 */
export function sanitizeDescriptionToText(html: string | null | undefined): string[] {
  if (!html) return [];

  // Rewrite @Tag[...] references BEFORE stripping tags — some fallbacks
  // (e.g. @UUID's last-path-segment) rely on raw bracket content that must
  // not be tag-stripped first.
  const withReadableTags = rewriteInlineTags(html);

  // Turn block-level boundaries into paragraph breaks before removing tags.
  const withBreaks = withReadableTags
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*hr\s*\/?>/gi, "\n\n---\n\n")
    .replace(/<\s*\/\s*(p|li|div)\s*>/gi, "\n\n")
    .replace(/<\s*li[^>]*>/gi, "• ");

  // Strip every remaining tag (allow-list tags carry no special meaning in
  // plain-text output — they were only used above to derive breaks).
  const stripped = withBreaks.replace(/<[^>]+>/g, "");

  const decoded = decodeHtmlEntities(stripped);

  return decoded
    .split(/\n{2,}/)
    .map((block) => block.replace(/\n+/g, " ").trim())
    .filter((block) => block.length > 0);
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Sanitize vendor description HTML into a safe, renderable HTML string
 * restricted to {@link ALLOWED_TAGS}. Inline `@Tag[...]` references are
 * rewritten to plain readable text first (never executable — V2). Every
 * other tag/attribute is stripped; only bare allow-listed tags survive
 * (no attributes are ever preserved, so no `onclick=`/`href=`/`style=`
 * injection surface exists).
 */
export function sanitizeDescriptionHtml(html: string | null | undefined): string {
  if (!html) return "";

  const withReadableTags = rewriteInlineTags(html);

  return withReadableTags.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (whole, tagName: string) => {
    const lower = tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) return "";
    const isClosing = whole.startsWith("</");
    return isClosing ? `</${lower}>` : `<${lower}>`;
  });
}

// ---------------------------------------------------------------------------
// Mechanical fields extraction
// ---------------------------------------------------------------------------

export interface MechanicalField {
  label: string;
  value: string;
}

const SAVE_LABELS: Record<string, string> = {
  fortitude: "Fortitude",
  reflex: "Reflex",
  will: "Will",
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function actionCostLabel(system: Record<string, unknown>): string | null {
  const castTime = str(system["castTime"]) ?? str((system["time"] as Record<string, unknown> | undefined)?.["value"]);
  if (!castTime) return null;
  if (castTime === "reaction") return "Reaction";
  if (castTime === "free") return "Free Action";
  const n = Number(castTime);
  if (Number.isFinite(n) && n >= 1 && n <= 3) return n === 1 ? "1 action" : `${n} actions`;
  return castTime;
}

function damageFields(system: Record<string, unknown>): MechanicalField[] {
  const damage = system["damage"];
  if (!isRecord(damage)) return [];
  const fields: MechanicalField[] = [];
  for (const [rank, entry] of Object.entries(damage)) {
    if (!isRecord(entry)) continue;
    const formula = str(entry["formula"]);
    const type = str(entry["type"]);
    if (!formula) continue;
    const rankLabel = rank === "0" ? "Base" : `Rank ${rank}`;
    fields.push({ label: `Damage (${rankLabel})`, value: type ? `${formula} ${type}` : formula });
  }
  return fields;
}

function saveField(system: Record<string, unknown>): MechanicalField | null {
  const defense = system["defense"];
  if (!isRecord(defense)) return null;
  const save = defense["save"];
  if (isRecord(save)) {
    const statistic = str(save["statistic"]);
    if (statistic) {
      const label = SAVE_LABELS[statistic] ?? statistic;
      return { label: "Save", value: save["basic"] === true ? `${label} (basic)` : label };
    }
  }
  if (defense["spellAttack"] === true) return { label: "Save", value: "Spell attack" };
  const passive = defense["passive"];
  if (isRecord(passive)) {
    const statistic = str(passive["statistic"]);
    if (statistic) return { label: "Defense", value: statistic.toUpperCase() };
  }
  return null;
}

function heightenField(system: Record<string, unknown>): MechanicalField | null {
  const heightening = system["heightening"];
  if (!isRecord(heightening)) return null;
  const type = str(heightening["type"]);
  if (type === "interval") {
    const interval = heightening["interval"];
    return {
      label: "Heightened",
      value: typeof interval === "number" ? `+${interval}` : "yes",
    };
  }
  if (type === "fixed") {
    const levels = heightening["levels"];
    const ranks = isRecord(levels) ? Object.keys(levels).sort() : [];
    return { label: "Heightened", value: ranks.length > 0 ? `Rank ${ranks.join(", ")}` : "yes" };
  }
  return null;
}

/**
 * Build the spell-specific mechanical fields: time/range/area/target/
 * duration/save/damage/heighten (task item 1).
 */
export function buildSpellFields(system: Record<string, unknown>): MechanicalField[] {
  const fields: MechanicalField[] = [];

  const time = actionCostLabel(system);
  if (time) fields.push({ label: "Cast", value: time });

  const range = str(system["range"]);
  if (range) fields.push({ label: "Range", value: range });

  const area = system["area"];
  if (isRecord(area)) {
    const type = str(area["type"]);
    const value = area["value"];
    if (type && typeof value === "number") fields.push({ label: "Area", value: `${value}-foot ${type}` });
  }

  const target = str(system["target"]);
  if (target) fields.push({ label: "Target", value: target });

  const duration = system["duration"];
  if (isRecord(duration)) {
    const value = str(duration["value"]);
    if (value) {
      fields.push({
        label: "Duration",
        value: duration["sustained"] === true ? `${value} (sustained)` : value,
      });
    }
  }

  const save = saveField(system);
  if (save) fields.push(save);

  fields.push(...damageFields(system));

  const heighten = heightenField(system);
  if (heighten) fields.push(heighten);

  const cost = str(system["cost"]);
  if (cost) fields.push({ label: "Cost", value: cost });

  const requirements = str(system["requirements"]);
  if (requirements) fields.push({ label: "Requirements", value: requirements });

  return fields;
}

/**
 * Build the feat-specific mechanical fields: prerequisites/frequency
 * (task item 1).
 */
export function buildFeatFields(system: Record<string, unknown>): MechanicalField[] {
  const fields: MechanicalField[] = [];

  const prerequisites = system["prerequisites"];
  if (Array.isArray(prerequisites) && prerequisites.length > 0) {
    const values = prerequisites
      .map((p) => (isRecord(p) ? str(p["value"]) : null))
      .filter((v): v is string => v !== null);
    if (values.length > 0) fields.push({ label: "Prerequisites", value: values.join("; ") });
  }

  const frequency = system["frequency"];
  if (isRecord(frequency)) {
    const max = frequency["max"];
    const per = str(frequency["per"]);
    if (typeof max === "number" && per) {
      fields.push({ label: "Frequency", value: `${max} per ${per}` });
    }
  }

  const actionType = str(system["actionType"]);
  const actions = system["actions"];
  if (actionType === "action" && typeof actions === "number") {
    fields.push({ label: "Cast", value: actions === 1 ? "1 action" : `${actions} actions` });
  } else if (actionType === "reaction") {
    fields.push({ label: "Cast", value: "Reaction" });
  } else if (actionType === "free") {
    fields.push({ label: "Cast", value: "Free Action" });
  }

  return fields;
}

/**
 * Build the classFeature-specific mechanical fields: level (task item 1).
 */
export function buildClassFeatureFields(system: Record<string, unknown>): MechanicalField[] {
  const fields: MechanicalField[] = [];

  const level = system["level"];
  if (typeof level === "number") fields.push({ label: "Level", value: String(level) });

  const prerequisites = system["prerequisites"];
  if (Array.isArray(prerequisites) && prerequisites.length > 0) {
    const values = prerequisites
      .map((p) => (isRecord(p) ? str(p["value"]) : null))
      .filter((v): v is string => v !== null);
    if (values.length > 0) fields.push({ label: "Prerequisites", value: values.join("; ") });
  }

  return fields;
}

/**
 * Dispatch to the right per-type field builder based on the document's
 * `type` (falls back to an empty list for unrecognized types — the panel
 * still shows name/traits/description).
 */
export function buildMechanicalFields(doc: Record<string, unknown>): MechanicalField[] {
  const type = str(doc["type"]);
  const system = doc["system"];
  if (!isRecord(system)) return [];

  switch (type) {
    case "spell":
      return buildSpellFields(system);
    case "feat":
      return buildFeatFields(system);
    case "classFeature":
      return buildClassFeatureFields(system);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Header info (name / level-or-rank / traits)
// ---------------------------------------------------------------------------

export interface DocumentDetailsHeader {
  name: string;
  /** Rank (spells) or level (feats/classFeatures) — null if not applicable. */
  levelOrRank: number | null;
  traits: string[];
  rarity: string | null;
}

/** Extract the header block (name/level-or-rank/traits/rarity) shown at the top of the panel. */
export function buildDetailsHeader(doc: Record<string, unknown>): DocumentDetailsHeader {
  const name = str(doc["name"]) ?? "";
  const system = doc["system"];
  const sys = isRecord(system) ? system : {};

  const levelRaw = sys["level"];
  const levelOrRank = typeof levelRaw === "number" ? levelRaw : null;

  const traitsBlock = sys["traits"];
  const traits: string[] = [];
  let rarity: string | null = null;
  if (isRecord(traitsBlock)) {
    const value = traitsBlock["value"];
    if (Array.isArray(value)) {
      for (const v of value) if (typeof v === "string") traits.push(v);
    }
    rarity = str(traitsBlock["rarity"]);
  }

  return { name, levelOrRank, traits, rarity };
}

// ---------------------------------------------------------------------------
// Session cache (per-dialog-instance uuid -> document)
// ---------------------------------------------------------------------------

/**
 * A tiny Map-backed cache keyed by Compendium UUID, scoped to a single
 * picker dialog's lifetime (created fresh per component instance — not a
 * module-level singleton, so closing/reopening the dialog starts clean and
 * different dialogs never share entries).
 */
export class DocumentDetailsCache {
  private readonly entries = new Map<string, Record<string, unknown>>();

  get(uuid: string): Record<string, unknown> | undefined {
    return this.entries.get(uuid);
  }

  set(uuid: string, doc: Record<string, unknown>): void {
    this.entries.set(uuid, doc);
  }

  has(uuid: string): boolean {
    return this.entries.has(uuid);
  }

  clear(): void {
    this.entries.clear();
  }
}
