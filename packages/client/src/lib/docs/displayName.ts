/**
 * displayName — the SINGLE place that resolves a document's translated label
 * (REQ-CMP-055, A041 — ajustes r1, Fase 4).
 *
 * `doc.name` on a world document stays EN-pure by deliberate decision (issue
 * #43, unchanged by A041): identity and every system-side derivation match
 * pack documents by `name`/`sourceId` in English. The pt-BR label — when the
 * document was imported from a pack that had a translation overlay — travels
 * as a SNAPSHOT (never a live view) in `flags.fusion.i18n["pt-BR"].name`,
 * written once at import time by `CompendiumService.importToWorld` AND
 * `CompendiumService.importToActor` (both call the shared
 * `snapshotPtBRLabel` helper — packages/server/src/compendium/service.ts).
 *
 * Every surface that shows an actor's name reads it through THIS function.
 * A second, ad-hoc name-resolution helper elsewhere is a defect — the whole
 * point of centralizing this is that the moment a backfill/re-import story
 * exists, there is exactly one call site to change.
 *
 * KNOWN EXCEPTION (not fixed by this module — see openQuestions of the code
 * review that documented it, ajustes r1 Fase 4, 2026-08-17): embedded Items
 * added through the sheet's OWN picker (`characterSheetVM.addSpellToEntry`,
 * a `doc:create` with a full pack-fetched document as payload) persist a
 * SEPARATE, pre-existing `item.i18n.ptBR.{name,description}` bag, read by
 * `pickLocalizedName`/`pickLocalizedDescription`
 * (packages/client/src/lib/compendium/documentDetails.ts) — a second
 * mechanism this function does not read. That duplication predates A041 and
 * is a real defect, but unifying it is a larger cross-file change than this
 * pass's scope (a `service.ts` correction).
 */

import { i18n, type SupportedLocale } from "../i18n/i18n.js";

/** The narrow shape this module reads off a document — Actor or Item alike. */
export interface DisplayNameDoc {
  readonly name?: string | null | undefined;
  readonly flags?: Record<string, unknown> | null | undefined;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Resolve the label to show for a document: the translated name for
 * `locale`, when the import snapshotted one, else the raw (EN) `doc.name`.
 *
 * @param locale defaults to the active UI locale (`i18n.locale`) — pass it
 *   explicitly only when resolving for a locale other than the current one.
 */
export function displayName(doc: DisplayNameDoc, locale: SupportedLocale = i18n.locale): string {
  const flags = record(doc.flags);
  const fusion = flags ? record(flags["fusion"]) : null;
  const localized = fusion ? record(fusion["i18n"]) : null;
  const entry = localized ? record(localized[locale]) : null;
  const name = entry?.["name"];
  if (typeof name === "string" && name.length > 0) return name;
  return typeof doc.name === "string" ? doc.name : "";
}
