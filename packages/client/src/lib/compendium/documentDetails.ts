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

import type { SupportedLocale } from "../i18n/i18n.js";
import {
  TRAIT_NAMES_PT,
  DAMAGE_TYPE_NAMES_PT,
  TRADITION_NAMES_PT,
  RARITY_NAMES_PT,
  AREA_SHAPE_NAMES_PT,
} from "./traitNames.js";

// ---------------------------------------------------------------------------
// Localization overlay picking (T1)
// ---------------------------------------------------------------------------

/**
 * Shape of the localization bag the server attaches to served entries/docs
 * (`entry.i18n` / `doc.i18n`). Mirrors @fusion/shared's `LocalizedFields`, but
 * declared locally as a structural read-only view over the untyped
 * `Record<string, unknown>` documents/entries flow through here.
 */
interface LocalizedBag {
  ptBR?: { name?: unknown; description?: unknown } | undefined;
}

/** Read the server-attached `i18n` bag off an untyped entry/doc, if present. */
function readI18nBag(source: Record<string, unknown> | null | undefined): LocalizedBag | null {
  if (!source) return null;
  const bag = source["i18n"];
  if (bag === null || typeof bag !== "object" || Array.isArray(bag)) return null;
  return bag as LocalizedBag;
}

/**
 * Pick the display name for an entry/doc given the active locale (T1).
 *
 * When the locale is "pt-BR" and a translated name exists, returns it;
 * otherwise falls back to the EN `name`. EN is ALWAYS the fallback — a missing
 * overlay, a non-pt-BR locale, or a nameless entry all resolve to the EN name
 * (or "" as a last resort). The server attaches `i18n.ptBR` unconditionally
 * (it doesn't know the client locale); this helper is the single decision
 * point that consults `locale`.
 */
export function pickLocalizedName(
  source: Record<string, unknown> | null | undefined,
  locale: SupportedLocale,
): string {
  const enName = str(source?.["name"]) ?? "";
  if (locale !== "pt-BR") return enName;
  const ptName = str(readI18nBag(source)?.ptBR?.name);
  return ptName ?? enName;
}

/**
 * The EN name for an entry/doc, regardless of locale — used as a subtitle/
 * tooltip beside a translated name so the reader can cross-reference EN source
 * material. Returns "" when absent. When the display name already equals the
 * EN name (untranslated, or non-pt-BR locale), callers should suppress the
 * subtitle (see {@link localizedNameParts}).
 */
export function pickEnName(source: Record<string, unknown> | null | undefined): string {
  return str(source?.["name"]) ?? "";
}

/**
 * Resolve both the display name and the (optional) EN subtitle in one pass.
 * `subtitleEn` is non-null ONLY when a pt-BR translation is actually being
 * shown AND differs from the EN name — so the UI shows the EN name as a
 * secondary line to aid cross-referencing, and never shows a redundant
 * "EN (EN)" when untranslated.
 */
export function localizedNameParts(
  source: Record<string, unknown> | null | undefined,
  locale: SupportedLocale,
): { display: string; subtitleEn: string | null } {
  const en = pickEnName(source);
  const display = pickLocalizedName(source, locale);
  const subtitleEn = display !== en && en.length > 0 ? en : null;
  return { display, subtitleEn };
}

/**
 * Pick the description HTML for a doc given the active locale (T1). Prefers the
 * translated `i18n.ptBR.description` when the locale is pt-BR and a translation
 * exists; otherwise falls back to the EN `system.description`. Returns null
 * when neither is a string (caller renders the "no description" placeholder).
 * The returned HTML is NOT yet sanitized — callers pipe it through
 * {@link sanitizeDescriptionHtml}.
 */
export function pickLocalizedDescription(
  doc: Record<string, unknown> | null | undefined,
  locale: SupportedLocale,
): string | null {
  if (locale === "pt-BR") {
    const ptDesc = str(readI18nBag(doc)?.ptBR?.description);
    if (ptDesc !== null) return ptDesc;
  }
  const system = doc?.["system"];
  const enDesc =
    system !== null && typeof system === "object" && !Array.isArray(system)
      ? (system as Record<string, unknown>)["description"]
      : null;
  return typeof enDesc === "string" ? enDesc : null;
}

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
// Locale-aware display translation (r15-A1)
// ---------------------------------------------------------------------------

/** Humanize a kebab/underscore slug into spaced Title-ish text as a last resort. */
function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter((w) => w.length > 0)
    .join(" ");
}

/**
 * Display label for a single trait slug in the active locale. On "pt-BR" the
 * generated {@link TRAIT_NAMES_PT} map wins; an unknown slug falls back to a
 * humanized form of the slug. On "en" the raw slug is returned unchanged (the
 * chip's own uppercase CSS renders it as "ATTACK"). r15-A1.
 */
export function traitDisplayName(slug: string, locale: SupportedLocale): string {
  if (locale !== "pt-BR") return slug;
  return TRAIT_NAMES_PT[slug] ?? humanizeSlug(slug);
}

/** Display label for a rarity slug (never shown for "common"). r15-A1. */
export function rarityDisplayName(slug: string, locale: SupportedLocale): string {
  if (locale !== "pt-BR") return slug;
  return RARITY_NAMES_PT[slug] ?? humanizeSlug(slug);
}

/**
 * Word-boundary substitution map for enumerable field VALUES (range/target/
 * duration/area free-text) EN→pt-BR. Applied token-wise so mixed phrases like
 * "1 willing creature" → "1 criatura disposta" and "30 feet" → "30 pés"
 * translate without a full phrase table. Numbers, dice formulas and unknown
 * words pass through untouched. Multi-word keys are replaced before single
 * words (see {@link translateValueTokens}). r15-A1.
 */
const VALUE_TERMS_PT: ReadonlyArray<readonly [RegExp, string]> = [
  // multi-word first (longest match wins)
  [/\bwilling creatures\b/gi, "criaturas dispostas"],
  [/\bwilling creature\b/gi, "criatura disposta"],
  [/\bliving creatures\b/gi, "criaturas vivas"],
  [/\bliving creature\b/gi, "criatura viva"],
  [/\bdying creature\b/gi, "criatura morrendo"],
  [/\bcorporeal creature\b/gi, "criatura corpórea"],
  [/\byour Speed\b/gi, "seu Deslocamento"],
  [/\bsee text\b/gi, "ver texto"],
  [/\bsee below\b/gi, "ver abaixo"],
  [/\buntil the end of your next turn\b/gi, "até o fim do seu próximo turno"],
  [/\buntil the start of your next turn\b/gi, "até o início do seu próximo turno"],
  [/\buntil the end of your turn\b/gi, "até o fim do seu turno"],
  [/\bup to\b/gi, "até"],
  // single words
  [/\bcreatures\b/gi, "criaturas"],
  [/\bcreature\b/gi, "criatura"],
  [/\benemies\b/gi, "inimigos"],
  [/\benemy\b/gi, "inimigo"],
  [/\ballies\b/gi, "aliados"],
  [/\bally\b/gi, "aliado"],
  [/\bobjects\b/gi, "objetos"],
  [/\bobject\b/gi, "objeto"],
  [/\bcorpse\b/gi, "cadáver"],
  [/\banimals\b/gi, "animais"],
  [/\banimal\b/gi, "animal"],
  [/\bwilling\b/gi, "disposta"],
  [/\bfeet\b/gi, "pés"],
  [/\bfoot\b/gi, "pés"],
  [/\btouch\b/gi, "toque"],
  [/\bself\b/gi, "você mesmo"],
  [/\bplanetary\b/gi, "planetário"],
  [/\bmiles\b/gi, "milhas"],
  [/\bmile\b/gi, "milha"],
  [/\bvaries\b/gi, "varia"],
  [/\bunlimited\b/gi, "ilimitada"],
  [/\bminutes\b/gi, "minutos"],
  [/\bminute\b/gi, "minuto"],
  [/\bhours\b/gi, "horas"],
  [/\bhour\b/gi, "hora"],
  [/\brounds\b/gi, "rodadas"],
  [/\bround\b/gi, "rodada"],
  [/\bdays\b/gi, "dias"],
  [/\bday\b/gi, "dia"],
  [/\bsustained\b/gi, "sustentada"],
];

/**
 * Translate an enumerable field value's recurring EN tokens to pt-BR
 * (range/target/duration). No-op on "en". Never touches digits or dice.
 * r15-A1.
 */
export function translateValueTokens(value: string, locale: SupportedLocale): string {
  if (locale !== "pt-BR") return value;
  let out = value;
  for (const [pattern, replacement] of VALUE_TERMS_PT) out = out.replace(pattern, replacement);
  return out;
}

/** Damage-type token → pt-BR (e.g. "electricity" → "eletricidade"). r15-A1. */
export function translateDamageType(type: string, locale: SupportedLocale): string {
  if (locale !== "pt-BR") return type;
  return DAMAGE_TYPE_NAMES_PT[type.toLowerCase()] ?? type;
}

// ---------------------------------------------------------------------------
// Action-cost formatting (r15-A1, feedback: "2 to 2 rounds" is illegible)
// ---------------------------------------------------------------------------

/** Action-count glyphs: ◆ per action, ◇ free action, ⟳ reaction. */
const ACTION_GLYPH = "◆";
const FREE_GLYPH = "◇";
const REACTION_GLYPH = "⟳";

export interface ActionCost {
  /** Glyph string for a numbered/ranged action cost ("◆◆", "◆◆ a ◆◆◆", "◇", "⟳"), or "" for text-only times. */
  icons: string;
  /** Human label in the active locale ("2 ações", "◆◆ a ◆◆◆" collapses to a range label, "1 minuto"). */
  label: string;
  /** True when the cost is a long/textual time (minutes/hours) with no glyphs. */
  isText: boolean;
}

/** "◆".repeat(n) with a guard for n<=0. */
function actionGlyphs(n: number): string {
  return n >= 1 ? ACTION_GLYPH.repeat(n) : "";
}

/** pt-BR / en label for a plain action count. */
function actionCountLabel(n: number, locale: SupportedLocale): string {
  if (locale === "pt-BR") return n === 1 ? "1 ação" : `${n} ações`;
  return n === 1 ? "1 action" : `${n} actions`;
}

/**
 * Format a raw spell/action `time.value` (the flattened `system.castTime`)
 * into action-cost icons + a readable label. Never renders "X to X".
 *
 *   "1" / "2" / "3"      → { icons: "◆◆", label: "2 ações" }
 *   "free"               → { icons: "◇", label: "ação livre" }
 *   "reaction"           → { icons: "⟳", label: "reação" }
 *   "1 to 3" / "2 or 3"  → { icons: "◆ a ◆◆◆", label: "1 a 3 ações" } (range)
 *   "2 to 2 rounds"      → collapses the degenerate N..N range to a single
 *                          "◆◆ / 2 ações" (vendor lists Horizon Thunder Sphere
 *                          as "2 to 2 rounds"; the leading count IS the cast).
 *   "1 minute" / "1 hour"→ { icons: "", label: "1 minuto", isText: true }
 *
 * Unknown/empty input → { icons: "", label: raw, isText: true }. r15-A1.
 */
export function formatActionCost(timeValue: string | null | undefined, locale: SupportedLocale = "pt-BR"): ActionCost {
  const raw = (timeValue ?? "").trim();
  if (!raw) return { icons: "", label: "", isText: true };

  const lower = raw.toLowerCase();

  if (lower === "free" || lower === "free action") {
    return { icons: FREE_GLYPH, label: locale === "pt-BR" ? "ação livre" : "free action", isText: false };
  }
  if (lower === "reaction") {
    return { icons: REACTION_GLYPH, label: locale === "pt-BR" ? "reação" : "reaction", isText: false };
  }

  // Plain single action count "1".."3" (allow up to a sane cap of 4).
  const single = /^(\d)$/.exec(lower);
  if (single) {
    const n = Number(single[1]);
    if (n >= 1 && n <= 4) return { icons: actionGlyphs(n), label: actionCountLabel(n, locale), isText: false };
  }

  // Action range: "N to M", "N or M", "N-M" — optionally trailed by a bogus
  // unit ("2 to 2 rounds"). The two bounds are action counts.
  const range = /^(\d)\s*(?:to|or|-|a|ou|até)\s*(\d)(?:\s+\w+)?$/.exec(lower);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (min >= 1 && min <= 4 && max >= 1 && max <= 4) {
      if (min === max) {
        // Degenerate range (e.g. "2 to 2 rounds") → single cost.
        return { icons: actionGlyphs(min), label: actionCountLabel(min, locale), isText: false };
      }
      const icons = `${actionGlyphs(min)} ${locale === "pt-BR" ? "a" : "to"} ${actionGlyphs(max)}`;
      const label =
        locale === "pt-BR" ? `${min} a ${max} ações` : `${min} to ${max} actions`;
      return { icons, label, isText: false };
    }
  }

  // Long/textual time (minutes, hours, days, "varies"…): no glyphs, translated.
  return { icons: "", label: translateValueTokens(raw, locale), isText: true };
}

// ---------------------------------------------------------------------------
// Mechanical fields extraction
// ---------------------------------------------------------------------------

export interface MechanicalField {
  /**
   * i18n key for the field's label, resolved by the panel via t() (r15-A1).
   * Always present; the panel prefers it over {@link MechanicalField.label}.
   */
  labelKey: string;
  /** EN label (backward-compatible fallback when a bundle lacks the key). */
  label: string;
  value: string;
}

const SAVE_LABELS: Record<string, string> = {
  fortitude: "Fortitude",
  reflex: "Reflex",
  will: "Will",
};

/** pt-BR names for saving-throw statistics (chip/value display). */
const SAVE_LABELS_PT: Record<string, string> = {
  fortitude: "Fortitude",
  reflex: "Reflexos",
  will: "Vontade",
};

/**
 * i18n keys for each mechanical-field label. The panel resolves these via
 * t(); `label` on the field stays the EN fallback for callers that don't
 * translate (and for the headless tests). r15-A1.
 */
const FIELD_KEYS = {
  cast: "FUSION.Sheet.Details.Field.Cast",
  range: "FUSION.Sheet.Details.Field.Range",
  area: "FUSION.Sheet.Details.Field.Area",
  target: "FUSION.Sheet.Details.Field.Target",
  duration: "FUSION.Sheet.Details.Field.Duration",
  save: "FUSION.Sheet.Details.Field.Save",
  defense: "FUSION.Sheet.Details.Field.Defense",
  damageBase: "FUSION.Sheet.Details.Field.DamageBase",
  damageRank: "FUSION.Sheet.Details.Field.DamageRank",
  heightened: "FUSION.Sheet.Details.Field.Heightened",
  cost: "FUSION.Sheet.Details.Field.Cost",
  requirements: "FUSION.Sheet.Details.Field.Requirements",
  prerequisites: "FUSION.Sheet.Details.Field.Prerequisites",
  frequency: "FUSION.Sheet.Details.Field.Frequency",
  level: "FUSION.Sheet.Details.Field.Level",
} as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Small constructor keeping `labelKey`/`label`/`value` in sync at each call site. */
function field(labelKey: string, label: string, value: string): MechanicalField {
  return { labelKey, label, value };
}

function damageFields(system: Record<string, unknown>, locale: SupportedLocale): MechanicalField[] {
  const damage = system["damage"];
  if (!isRecord(damage)) return [];
  const fields: MechanicalField[] = [];
  for (const [rank, entry] of Object.entries(damage)) {
    if (!isRecord(entry)) continue;
    const formula = str(entry["formula"]);
    const type = str(entry["type"]);
    if (!formula) continue;
    const displayType = type ? translateDamageType(type, locale) : null;
    const value = displayType ? `${formula} ${displayType}` : formula;
    if (rank === "0") {
      const label = locale === "pt-BR" ? "Dano (base)" : "Damage (Base)";
      fields.push(field(FIELD_KEYS.damageBase, label, value));
    } else {
      const label = locale === "pt-BR" ? `Dano (elevação ${rank})` : `Damage (Rank ${rank})`;
      fields.push(field(FIELD_KEYS.damageRank, label, value));
    }
  }
  return fields;
}

function saveField(system: Record<string, unknown>, locale: SupportedLocale): MechanicalField | null {
  const defense = system["defense"];
  if (!isRecord(defense)) return null;
  const isPt = locale === "pt-BR";
  const saveLabel = isPt ? "Salvaguarda" : "Save";
  const save = defense["save"];
  if (isRecord(save)) {
    const statistic = str(save["statistic"]);
    if (statistic) {
      const stat = isPt
        ? SAVE_LABELS_PT[statistic] ?? statistic
        : SAVE_LABELS[statistic] ?? statistic;
      const basicSuffix = isPt ? " (básica)" : " (basic)";
      const value = save["basic"] === true ? `${stat}${basicSuffix}` : stat;
      return field(FIELD_KEYS.save, saveLabel, value);
    }
  }
  if (defense["spellAttack"] === true) {
    return field(FIELD_KEYS.save, saveLabel, isPt ? "Ataque de magia" : "Spell attack");
  }
  const passive = defense["passive"];
  if (isRecord(passive)) {
    const statistic = str(passive["statistic"]);
    if (statistic) {
      return field(FIELD_KEYS.defense, isPt ? "Defesa" : "Defense", statistic.toUpperCase());
    }
  }
  return null;
}

function heightenField(system: Record<string, unknown>, locale: SupportedLocale): MechanicalField | null {
  const heightening = system["heightening"];
  if (!isRecord(heightening)) return null;
  const isPt = locale === "pt-BR";
  const label = isPt ? "Elevação" : "Heightened";
  const yes = isPt ? "sim" : "yes";
  const type = str(heightening["type"]);
  if (type === "interval") {
    const interval = heightening["interval"];
    return field(FIELD_KEYS.heightened, label, typeof interval === "number" ? `+${interval}` : yes);
  }
  if (type === "fixed") {
    const levels = heightening["levels"];
    const ranks = isRecord(levels) ? Object.keys(levels).sort() : [];
    const value =
      ranks.length > 0 ? `${isPt ? "Elevação" : "Rank"} ${ranks.join(", ")}` : yes;
    return field(FIELD_KEYS.heightened, label, value);
  }
  return null;
}

/**
 * Build the spell-specific mechanical fields: time/range/area/target/
 * duration/save/damage/heighten. When `locale` is "pt-BR", labels and
 * enumerable VALUES are translated and the cast time is rendered as
 * action-cost icons + label (r15-A1); "en" (the default) preserves the
 * original EN output.
 */
export function buildSpellFields(
  system: Record<string, unknown>,
  locale: SupportedLocale = "en",
): MechanicalField[] {
  const fields: MechanicalField[] = [];
  const isPt = locale === "pt-BR";

  const castRaw = str(system["castTime"]) ?? str((system["time"] as Record<string, unknown> | undefined)?.["value"]);
  if (castRaw) {
    const cost = formatActionCost(castRaw, locale);
    // Icons + label when we recognized an action cost; plain translated text
    // for long/textual times ("1 minuto"). Never "X to X".
    const value = cost.isText ? cost.label : cost.icons ? `${cost.icons} ${cost.label}` : cost.label;
    fields.push(field(FIELD_KEYS.cast, isPt ? "Conjuração" : "Cast", value));
  }

  const range = str(system["range"]);
  if (range) {
    fields.push(field(FIELD_KEYS.range, isPt ? "Alcance" : "Range", translateValueTokens(range, locale)));
  }

  const area = system["area"];
  if (isRecord(area)) {
    const type = str(area["type"]);
    const value = area["value"];
    if (type && typeof value === "number") {
      const shape = isPt ? AREA_SHAPE_NAMES_PT[type] ?? type : type;
      const areaValue = isPt ? `${value} pés de ${shape}` : `${value}-foot ${type}`;
      fields.push(field(FIELD_KEYS.area, isPt ? "Área" : "Area", areaValue));
    }
  }

  const target = str(system["target"]);
  if (target) {
    fields.push(field(FIELD_KEYS.target, isPt ? "Alvo" : "Target", translateValueTokens(target, locale)));
  }

  const duration = system["duration"];
  if (isRecord(duration)) {
    const value = str(duration["value"]);
    if (value) {
      const translated = translateValueTokens(value, locale);
      const sustained = duration["sustained"] === true;
      const durValue = sustained
        ? `${translated} ${isPt ? "(sustentada)" : "(sustained)"}`
        : translated;
      fields.push(field(FIELD_KEYS.duration, isPt ? "Duração" : "Duration", durValue));
    }
  }

  const save = saveField(system, locale);
  if (save) fields.push(save);

  fields.push(...damageFields(system, locale));

  const heighten = heightenField(system, locale);
  if (heighten) fields.push(heighten);

  const cost = str(system["cost"]);
  if (cost) fields.push(field(FIELD_KEYS.cost, isPt ? "Custo" : "Cost", cost));

  const requirements = str(system["requirements"]);
  if (requirements) {
    fields.push(field(FIELD_KEYS.requirements, isPt ? "Requisitos" : "Requirements", requirements));
  }

  return fields;
}

/** Prerequisites field shared by feats/class features. */
function prerequisitesField(
  system: Record<string, unknown>,
  locale: SupportedLocale,
): MechanicalField | null {
  const prerequisites = system["prerequisites"];
  if (!Array.isArray(prerequisites) || prerequisites.length === 0) return null;
  const values = prerequisites
    .map((p) => (isRecord(p) ? str(p["value"]) : null))
    .filter((v): v is string => v !== null);
  if (values.length === 0) return null;
  const label = locale === "pt-BR" ? "Pré-requisitos" : "Prerequisites";
  return field(FIELD_KEYS.prerequisites, label, values.join("; "));
}

/**
 * Build the feat-specific mechanical fields: prerequisites/frequency/action
 * cost. Locale-aware (see {@link buildSpellFields}); default "en".
 */
export function buildFeatFields(
  system: Record<string, unknown>,
  locale: SupportedLocale = "en",
): MechanicalField[] {
  const fields: MechanicalField[] = [];
  const isPt = locale === "pt-BR";

  const prereq = prerequisitesField(system, locale);
  if (prereq) fields.push(prereq);

  const frequency = system["frequency"];
  if (isRecord(frequency)) {
    const max = frequency["max"];
    const per = str(frequency["per"]);
    if (typeof max === "number" && per) {
      const perPt = translateValueTokens(per, locale);
      const value = isPt ? `${max} por ${perPt}` : `${max} per ${per}`;
      fields.push(field(FIELD_KEYS.frequency, isPt ? "Frequência" : "Frequency", value));
    }
  }

  const actionType = str(system["actionType"]);
  const actions = system["actions"];
  const castLabel = isPt ? "Conjuração" : "Cast";
  if (actionType === "action" && typeof actions === "number") {
    const cost = formatActionCost(String(actions), locale);
    const value = cost.icons ? `${cost.icons} ${cost.label}` : cost.label;
    fields.push(field(FIELD_KEYS.cast, castLabel, value));
  } else if (actionType === "reaction") {
    const cost = formatActionCost("reaction", locale);
    fields.push(field(FIELD_KEYS.cast, castLabel, `${cost.icons} ${cost.label}`));
  } else if (actionType === "free") {
    const cost = formatActionCost("free", locale);
    fields.push(field(FIELD_KEYS.cast, castLabel, `${cost.icons} ${cost.label}`));
  }

  return fields;
}

/**
 * Build the classFeature-specific mechanical fields: level + prerequisites.
 * Locale-aware; default "en".
 */
export function buildClassFeatureFields(
  system: Record<string, unknown>,
  locale: SupportedLocale = "en",
): MechanicalField[] {
  const fields: MechanicalField[] = [];
  const isPt = locale === "pt-BR";

  const level = system["level"];
  if (typeof level === "number") {
    fields.push(field(FIELD_KEYS.level, isPt ? "Nível" : "Level", String(level)));
  }

  const prereq = prerequisitesField(system, locale);
  if (prereq) fields.push(prereq);

  return fields;
}

/**
 * Dispatch to the right per-type field builder based on the document's
 * `type` (falls back to an empty list for unrecognized types — the panel
 * still shows name/traits/description). `locale` threads through so the
 * fields render in the active language (default "en" preserves existing
 * headless-test behaviour). r15-A1.
 */
export function buildMechanicalFields(
  doc: Record<string, unknown>,
  locale: SupportedLocale = "en",
): MechanicalField[] {
  const type = str(doc["type"]);
  const system = doc["system"];
  if (!isRecord(system)) return [];

  switch (type) {
    case "spell":
      return buildSpellFields(system, locale);
    case "feat":
      return buildFeatFields(system, locale);
    case "classFeature":
      return buildClassFeatureFields(system, locale);
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Header info (name / level-or-rank / traits)
// ---------------------------------------------------------------------------

export interface DocumentDetailsHeader {
  /** Display name in the active locale (pt-BR translation when available, else EN). */
  name: string;
  /**
   * EN name shown as a secondary subtitle beside a translated `name`, to help
   * cross-reference EN source material. Null when untranslated (name === EN) or
   * on a non-pt-BR locale — so the panel never shows a redundant "EN (EN)".
   */
  subtitleEn: string | null;
  /** Rank (spells) or level (feats/classFeatures) — null if not applicable. */
  levelOrRank: number | null;
  traits: string[];
  rarity: string | null;
}

/**
 * Extract the header block (name/subtitle/level-or-rank/traits/rarity) shown at
 * the top of the panel. `locale` selects the display name: on "pt-BR" the
 * server-attached `doc.i18n.ptBR.name` wins when present (EN otherwise); on
 * "en" the EN name is always used. Defaults to "pt-BR" (the app default) so
 * existing non-locale-aware callers keep the translated behaviour. T1.
 */
export function buildDetailsHeader(
  doc: Record<string, unknown>,
  locale: SupportedLocale = "pt-BR",
): DocumentDetailsHeader {
  const { display: name, subtitleEn } = localizedNameParts(doc, locale);
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

  return { name, subtitleEn, levelOrRank, traits, rarity };
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
