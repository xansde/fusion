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
 *      (p/strong/em/b/i/ul/ol/li/br/hr), and humanizes inline Foundry
 *      enrichers — @UUID[...]{Label}, @Damage[...], @Check[...],
 *      @Template[...], @Localize[...], and [[/r ...]] / [[/act ...]] roll
 *      blocks — into readable prose (numbers/dice preserved; never executed
 *      — V2 per the task's item 2). No raw enricher syntax ever leaks.
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

/** Saving-throw statistics that read as "<Name> save" rather than a skill check. */
const SAVE_STATISTICS = new Set(["fortitude", "reflex", "will"]);

/** Title-case a lowercase system slug for display, e.g. "fortitude" → "Fortitude". */
function capitalize(word: string): string {
  return word.length > 0 ? word[0]!.toUpperCase() + word.slice(1) : word;
}

/**
 * Strip Foundry `@`-prefixed roll-data paths (e.g. `@actor.level`,
 * `@item.rank`, `@actor.abilities.str.mod`) down to a short readable token
 * so a damage/formula fragment reads as text instead of leaking template
 * syntax. `@actor.level` → "level"; `@item.rank` → "rank"; anything else →
 * its last path segment. Never leaves a literal `@` behind.
 */
function humanizeRollData(formula: string): string {
  return formula.replace(/@[\w.]+/g, (path) => {
    const body = path.slice(1); // drop leading '@'
    if (body === "actor.level" || body === "self.level") return "level";
    const segment = body.split(".").pop();
    return segment && segment.trim() ? segment.trim() : body;
  });
}

/**
 * Turn a `@Damage[...]` bracket body into readable "<formula> <type>" text.
 *
 * The body is `formula[damageType]` optionally followed by `|options:...`
 * / `|traits:...` flags, and the formula itself may contain nested
 * parens/brackets and roll-data references, e.g.:
 *   `max(16,(2*(floor(@actor.level/2))))d6[fire]|options:area-damage`
 *   `(1d4+2)[persistent,fire]`
 *   `ceil(@actor.level/2)d8[@actor.flags...damageType]`
 *
 * Result: `max(16,(2*(floor(level/2))))d6 fire` — formula (roll-data
 * simplified, no leading `@`) + damage type, with `[]` and `|flags` dropped.
 */
function humanizeDamage(bracketBody: string): string {
  // Split off trailing `|options:...` / `|traits:...` flag segments. A bare
  // `|` never appears inside the formula, so the first top-level `|` marks
  // the start of the flags.
  const pipeIdx = bracketBody.indexOf("|");
  const core = (pipeIdx === -1 ? bracketBody : bracketBody.slice(0, pipeIdx)).trim();

  // The damage type is the LAST `[...]` group in the core, e.g. the `[fire]`
  // in `...d6[fire]`. Match it greedily so nested brackets in the formula
  // (rare) don't win over the trailing type tag.
  const typeMatch = /^(.*)\[([^\]]*)]\s*$/.exec(core);
  if (typeMatch) {
    const formula = humanizeRollData(typeMatch[1]!.trim());
    // Damage type may itself be a list ("persistent,acid") or a roll-data ref.
    const damageType = humanizeRollData(typeMatch[2]!.trim()).replace(/,/g, " ");
    return damageType ? `${formula} ${damageType}`.trim() : formula;
  }

  // No `[type]` group (e.g. `(@actor.level)` untyped) — just the formula.
  return humanizeRollData(core);
}

/**
 * Turn a `@Template[...]` bracket body into readable area text, e.g.
 *   `type:burst|distance:10` → "10-foot burst"
 *   `burst|distance:10`      → "10-foot burst"
 *   `cone|distance:30`       → "30-foot cone"
 * The shape may be a bare first segment or a `type:` key; the size comes
 * from the `distance:` flag. Falls back to the raw shape if no distance.
 */
function humanizeTemplate(bracketBody: string): string {
  const parts = bracketBody.split("|").map((p) => p.trim());
  let shape: string | null = null;
  let distance: string | null = null;
  for (const part of parts) {
    if (part.startsWith("type:")) shape = part.slice(5);
    else if (part.startsWith("distance:")) distance = part.slice(9);
    else if (shape === null && !part.includes(":")) shape = part;
  }
  if (shape && distance) return `${distance}-foot ${shape}`;
  if (shape) return shape;
  return bracketBody;
}

/**
 * Turn a `@Check[...]` bracket body into readable text, e.g.
 *   `fortitude|dc:29`            → "Fortitude save (DC 29)"
 *   `type:fortitude|dc:29`       → "Fortitude save (DC 29)"
 *   `fortitude|basic|options:..` → "basic Fortitude save"
 *   `reflex|against:class-spell` → "Reflex save"
 *   `athletics|dc:15`            → "Athletics (DC 15)"
 *   `athletics`                  → "Athletics"
 * Saves (fortitude/reflex/will) render as "<Name> save"; other statistics
 * are skill checks and render as the capitalized skill name. A `basic` flag
 * prefixes "basic "; a `dc:` flag appends " (DC N)".
 */
function humanizeCheck(bracketBody: string): string {
  const parts = bracketBody.split("|").map((p) => p.trim());
  const first = parts[0] ?? "";
  const statistic = (first.startsWith("type:") ? first.slice(5) : first).toLowerCase();
  const flags = parts.slice(1);

  const dcFlag = flags.find((f) => f.startsWith("dc:"));
  const dcRaw = dcFlag ? dcFlag.slice(3).trim() : null;
  // Roll-data DCs like `dc:@self.level` are not literal numbers — drop the
  // `@`-syntax rather than leak it; keep plain numeric DCs.
  const dc = dcRaw && /^\d+$/.test(dcRaw) ? dcRaw : null;
  const basic = flags.includes("basic");

  if (!statistic) return bracketBody;

  const name = capitalize(statistic);
  let text: string;
  if (SAVE_STATISTICS.has(statistic)) {
    text = basic ? `basic ${name} save` : `${name} save`;
  } else {
    text = name;
  }
  return dc ? `${text} (DC ${dc})` : text;
}

/**
 * Rewrite one `@Tag[...]{...}` inline reference into readable text.
 *
 * An explicit `{Label}` always wins (Foundry's own display text). Otherwise:
 * - `@UUID[Compendium.pf2e.pack.Item.Name]` → "Name" (last path segment).
 * - `@Damage[formula[type]|options:...]` → "formula type" (see
 *   {@link humanizeDamage}); roll-data (`@actor.level`) is simplified and
 *   the bracket/flag syntax is dropped — never executed (V2).
 * - `@Template[type:burst|distance:10]` → "10-foot burst".
 * - `@Check[fortitude|dc:29]` → "Fortitude save (DC 29)".
 * - `@Localize[...]` → dropped (localization key with no inline prose).
 * - Any other/unknown tag → the readable bracket body (roll-data stripped),
 *   never the raw `@Tag[...]` syntax.
 */
function rewriteInlineTag(tagName: string, bracketBody: string, label: string | null): string {
  if (label) return label;

  switch (tagName) {
    case "UUID": {
      const lastSegment = bracketBody.split(".").pop();
      return lastSegment && lastSegment.trim() ? lastSegment.trim() : bracketBody;
    }
    case "Damage":
      return humanizeDamage(bracketBody);
    case "Template":
      return humanizeTemplate(bracketBody);
    case "Check":
      return humanizeCheck(bracketBody);
    case "Localize":
      // Pure localization-key wrapper (e.g. @Localize[PF2E.NPC...]) with no
      // inline prose — nothing readable to show, so drop it entirely.
      return "";
    default:
      // Unknown enricher: show a readable form of the bracket body with
      // roll-data references simplified, never the raw `@Tag[...]` syntax.
      return humanizeRollData(bracketBody);
  }
}

/**
 * Humanize the body of a `[[...]]` inline-roll block (the text between the
 * double brackets, without a `{Label}` — that's handled by the caller).
 *
 * Foundry forms:
 *   `/r 1d20+5`            (roll)         → "1d20+5"
 *   `/br 2d6[fire]`        (blind roll)   → "2d6 fire"
 *   `/gmr 1d4 #hours`      (GM roll)      → "1d4"    (drops the #comment)
 *   `/r 1d4 #Recharge ...` (roll+flavor)  → "1d4"
 *   `/act climb skill=warfare-lore`       → "Climb"  (action macro)
 * Roll-data references (`@actor.level`) are simplified; `[type]` tags become
 * a trailing type word; `#flavor` comments and macro `key=value` args are
 * dropped as non-prose. Returns null if the body is not a recognized form.
 */
function humanizeInlineRoll(body: string): string | null {
  const trimmed = body.trim();
  const macroMatch = /^\/([a-z]+)\s+([\s\S]*)$/i.exec(trimmed);
  if (!macroMatch) return null;

  const kind = macroMatch[1]!.toLowerCase();
  let rest = macroMatch[2]!.trim();

  // Action macro: [[/act climb skill=warfare-lore]] → "Climb". Show only the
  // action slug (first token), title-cased and de-kebabed; drop key=value args.
  if (kind === "act") {
    const slug = rest.split(/\s+/)[0] ?? "";
    const words = slug.split("-").filter((w) => w.length > 0).map(capitalize);
    return words.length > 0 ? words.join(" ") : rest;
  }

  // Roll forms (/r, /br, /sr, /gmr, ...): drop trailing `#flavor` comment,
  // then reuse damage humanization so `2d6[fire]` → "2d6 fire" and
  // `@actor.level` is simplified. A bare formula (no `[type]`) passes through.
  const hashIdx = rest.indexOf("#");
  if (hashIdx !== -1) rest = rest.slice(0, hashIdx).trim();
  return humanizeDamage(rest);
}

/**
 * Replace every `[[...]]{...}` inline-roll block in `text` with its
 * human-readable form (see {@link humanizeInlineRoll}). An explicit
 * `{Label}` wins. Unrecognized blocks are left untouched for the `@Tag`
 * pass / plain rendering.
 */
function rewriteInlineRolls(text: string): string {
  let result = "";
  let i = 0;

  while (i < text.length) {
    const open = text.indexOf("[[", i);
    if (open === -1) {
      result += text.slice(i);
      break;
    }

    // Find the `]]` that closes this block by bracket depth: the opening `[[`
    // starts depth at 2, inner `[type]` groups nest and unnest, and the block
    // ends where depth returns to 0. This correctly handles a damage type tag
    // inside the roll, e.g. `[[/br 2d6[fire]]]` (body = `/br 2d6[fire]`).
    let depth = 0;
    let bodyEnd = -1;
    for (let j = open; j < text.length; j++) {
      const ch = text[j];
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) {
          bodyEnd = j; // points at the final `]`
          break;
        }
      }
    }
    if (bodyEnd === -1) {
      // Unbalanced — keep the rest verbatim rather than dropping prose.
      result += text.slice(i);
      break;
    }

    result += text.slice(i, open);

    const body = text.slice(open + 2, bodyEnd - 1); // strip leading `[[` and trailing `]]`
    let label: string | null = null;
    let cursor = bodyEnd + 1;
    if (text[cursor] === "{") {
      const labelClose = text.indexOf("}", cursor);
      if (labelClose !== -1) {
        label = text.slice(cursor + 1, labelClose);
        cursor = labelClose + 1;
      }
    }

    const readable = label ?? humanizeInlineRoll(body);
    if (readable !== null) {
      result += readable;
      i = cursor;
    } else {
      // Not a recognized roll block (e.g. a stray `[[1, 2]]` array in prose) —
      // keep the `[[` and re-scan from just after it.
      result += "[[";
      i = open + 2;
    }
  }

  return result;
}

/**
 * Replace every `@Tag[...]{...}` inline reference in `text` with its
 * human-readable form (see {@link rewriteInlineTag}).
 */
function rewriteAtTags(text: string): string {
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
 * Convert every Foundry enricher in `text` into human-readable prose:
 * `[[...]]` inline-roll blocks first (see {@link rewriteInlineRolls}), then
 * `@Tag[...]{...}` references (see {@link rewriteAtTags}). Idempotent on text
 * that contains no enrichers.
 */
function rewriteInlineTags(text: string): string {
  return rewriteAtTags(rewriteInlineRolls(text));
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
