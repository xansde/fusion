/**
 * quest.ts — reading a journal entry as a quest.
 *
 * Spec: `28-hub-do-jogador.md` (DEC-HUB-04/05/06, REQ-HUB-021..042),
 * `docs/design/quadro-de-missoes.md` (the design settled with the owner on
 * 2026-08-11).
 *
 * A quest is not a document type. It is a `JournalEntry` wearing two flags and
 * a handful of pages, and this module is the only place that knows how to read
 * one — server, GM panel and player panel all come through here, so the
 * vocabulary cannot drift between them.
 *
 * ## Why flags and not a new document
 *
 * DEC-HUB-04: the quest board needs exactly one thing the journal already has
 * — a document whose pieces are revealed separately — and nothing else a new
 * document type would bring. What it needed was for the page to carry its own
 * ownership, which is now true (`journal.ts`). A `Quest` document would have
 * duplicated the editor, the folders, the search and the `@UUID` plumbing to
 * express "a text with parts".
 *
 * ## The three readings
 *
 * A quest reads as one of three things for a given player, and the reading is
 * DERIVED from what reached them rather than stored anywhere:
 *
 *  - **hidden** — the entry did not arrive at all, or arrived with no page
 *    they may read. Nothing is drawn; the player does not know it exists
 *    (REQ-HUB-022).
 *  - **rumour** — only the rumour page arrived. A line under "boatos", no
 *    title, no objectives (REQ-HUB-023).
 *  - **published** — the hook or any objective arrived. The quest is on the
 *    board (REQ-HUB-024).
 *
 * Deriving rather than storing is what makes the GM's "ver como <jogador>"
 * preview exact instead of approximate (REQ-HUB-033): resolve the same pages
 * against another userId and you have precisely that player's board.
 */

import { OwnershipLevel, type Ownership } from "./document.js";
import { canReadPage, type JournalEntryPage } from "./journal.js";

/** What a page is doing inside a quest. */
export const PAGE_ROLES = ["hook", "rumour", "objective"] as const;
export type PageRole = (typeof PAGE_ROLES)[number];

/** How a quest reads for one viewer. */
export type QuestReading = "hidden" | "rumour" | "published";

/** The quest-shaped part of a journal entry. */
export interface QuestEntry {
  _id: string;
  name: string;
  ownership: Ownership;
  pages: JournalEntryPage[];
  flags?: Record<string, Record<string, unknown>>;
}

/** Read `flags.fusion.hub` off any document or page, without asserting shape. */
function hubFlags(source: {
  flags?: Record<string, Record<string, unknown>>;
}): Record<string, unknown> {
  const fusion = source.flags?.["fusion"];
  if (!fusion || typeof fusion !== "object") return {};
  const hub = fusion["hub"];
  if (!hub || typeof hub !== "object") return {};
  return hub as Record<string, unknown>;
}

/**
 * Is this entry a quest?
 *
 * Marked explicitly rather than inferred from "has pages with roles", because
 * an ordinary journal entry the GM happens to reveal page by page is not a
 * quest and must not appear on the board.
 */
export function isQuest(entry: { flags?: Record<string, Record<string, unknown>> }): boolean {
  return hubFlags(entry)["kind"] === "quest";
}

/** Has the GM marked the quest finished? (REQ-HUB-034) */
export function isQuestDone(entry: { flags?: Record<string, Record<string, unknown>> }): boolean {
  return hubFlags(entry)["done"] === true;
}

/** Region-map pins the QUEST as a whole points at (REQ-HUB-038). */
export function questPois(entry: { flags?: Record<string, Record<string, unknown>> }): string[] {
  const pois = hubFlags(entry)["pois"];
  return Array.isArray(pois) ? pois.filter((id): id is string => typeof id === "string") : [];
}

/** What this page is doing in the quest. Unmarked pages are objectives. */
export function pageRole(page: JournalEntryPage): PageRole {
  const role = hubFlags(page)["role"];
  return role === "hook" || role === "rumour" ? role : "objective";
}

/** Has this objective been ticked off? Belongs to the TABLE (Q-HUB-04). */
export function isObjectiveDone(page: JournalEntryPage): boolean {
  return hubFlags(page)["done"] === true;
}

/**
 * Region-map pins THIS objective points at (REQ-HUB-038, per objective).
 *
 * Per objective and not only per quest because "falar com o xerife" and "a
 * coisa na neblina" are two different places; several objectives may name the
 * same pin, and most objectives name none.
 */
export function objectivePois(page: JournalEntryPage): string[] {
  const pois = hubFlags(page)["pois"];
  return Array.isArray(pois) ? pois.filter((id): id is string => typeof id === "string") : [];
}

/** Pages of one role, in the GM's authoring order. */
export function pagesWithRole(entry: QuestEntry, role: PageRole): JournalEntryPage[] {
  return entry.pages.filter((page) => pageRole(page) === role).sort((a, b) => a.sort - b.sort);
}

/** The quest's objectives, in order (REQ-HUB-032a — order is the GM's). */
export function objectivesOf(entry: QuestEntry): JournalEntryPage[] {
  return pagesWithRole(entry, "objective");
}

/**
 * How this quest reads for one viewer.
 *
 * `privileged` short-circuits to `published`: the GM reads their own board
 * whole, and asking this function to also model privilege would give it two
 * answers to one question.
 *
 * Note that this is computed from the pages the viewer MAY read rather than
 * from the pages present in the object — so it gives the same answer whether
 * it runs on the server (full document) or on a player's client (already
 * redacted), which is what makes the "ver como" preview truthful.
 */
export function questReadingFor(
  entry: QuestEntry,
  userId: string | null | undefined,
  privileged = false,
): QuestReading {
  if (privileged) return "published";
  if (entry.pages.length === 0) return "hidden";

  let sawRumour = false;
  for (const page of entry.pages) {
    if (!canReadPage(page, entry.ownership, userId)) continue;
    if (pageRole(page) === "rumour") {
      sawRumour = true;
      continue;
    }
    // A hook or an objective they can read puts the quest on the board.
    return "published";
  }
  return sawRumour ? "rumour" : "hidden";
}

/** Pages this viewer may actually read, in order. Never re-derives visibility. */
export function readablePages(
  entry: QuestEntry,
  userId: string | null | undefined,
  privileged = false,
): JournalEntryPage[] {
  const pages = privileged
    ? [...entry.pages]
    : entry.pages.filter((page) => canReadPage(page, entry.ownership, userId));
  return pages.sort((a, b) => a.sort - b.sort);
}

/**
 * The reveal state of one page for one player, as the matrix draws it.
 *
 * Three cells and no more (REQ-HUB-028): hidden, or readable. `LIMITED` has no
 * meaning for a page — there is no half-revealed page — so it is folded into
 * hidden rather than given a cell that would lie about what the player sees.
 */
export function pageCellFor(
  page: JournalEntryPage,
  entry: QuestEntry,
  userId: string,
): "hidden" | "revealed" {
  return canReadPage(page, entry.ownership, userId) ? "revealed" : "hidden";
}

/**
 * The next step up for a whole table on one page (REQ-HUB-031, "todos").
 *
 * Never demotes: the action starts from whoever is furthest behind and moves
 * them forward, so a GM clicking it to catch one player up cannot take the
 * quest away from another who already had it.
 */
export function nextLevelForTable(
  page: JournalEntryPage,
  entry: QuestEntry,
  userIds: string[],
): OwnershipLevel | null {
  const anyHidden = userIds.some((id) => !canReadPage(page, entry.ownership, id));
  return anyHidden ? OwnershipLevel.OBSERVER : null;
}
