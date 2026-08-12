/**
 * journal.ts — the journal page as a document with an owner of its own.
 *
 * Spec: `12-journal-tabelas-cartas.md` (REQ-JRN-002, Q-JRN-003),
 * `28-hub-do-jogador.md` (DEC-HUB-04, REQ-HUB-021..042).
 *
 * ## Why the page needed a type at all
 *
 * `pages` was `z.array(z.record(z.string(), z.unknown()))` on the server: a
 * page could be anything, and in particular could not be redacted, because
 * redaction needs to know where a page keeps its ownership. Everything the
 * quest board does rests on that one field — a quest is ONE entry whose pages
 * are the hook, the rumour and each objective, and what a player may read is
 * decided page by page (DEC-HUB-04).
 *
 * ## Q-JRN-003: the page overrides the entry
 *
 * Confirmed with the owner on 2026-08-12. A page that declares nothing
 * inherits the entry; a page that declares anything decides for itself. The
 * three-step resolution in {@link resolvePageLevel} is the whole answer:
 *
 *   1. an entry for THIS user on the page wins outright;
 *   2. otherwise the page's own `default`, when it declares one;
 *   3. otherwise the entry's level for that user.
 *
 * Inheritance is the fallback rather than the rule because of how a GM writes:
 * "this objective is only for Tobias" should not require declaring `none` for
 * every other player at the table. But it is the fallback and not the rule
 * because of the opposite risk — a new objective added to a published quest
 * MUST NOT be readable the instant it is typed, which is why
 * {@link createJournalPage} writes an explicit `{ default: NONE }` unless the
 * caller says otherwise.
 *
 * ## There is no half-revealed page
 *
 * A page arrives whole or does not arrive at all: no state hands a player the
 * title without the body (REQ-HUB-032b). Splitting them would create a second
 * page with the text the player may read, which is the GM's job to write, not
 * the renderer's job to guess — the same reasoning as DEC-HUB-05, where the
 * rumour is written text rather than an automatic excerpt of the hook.
 */

import { z } from "zod";
import {
  FlagsSchema,
  OwnershipLevelSchema,
  OwnershipLevel,
  getUserLevel,
  type Ownership,
} from "./document.js";

/** 16-char document id, the same shape every document uses. */
const DocumentIdField = z.string().regex(/^[A-Za-z0-9]{16}$/, "must be 16 chars from [A-Za-z0-9]");

/**
 * Ownership of a PAGE — the same map as a document's, minus the requirement
 * that it declare a `default`.
 *
 * `OwnershipSchema` insists on a `default` key, and rightly so: a document
 * with no fallback would have no answer for a user nobody listed. A page is
 * not in that position — its fallback is the entry it belongs to — and the
 * absence of a `default` is precisely how it says "inherit" (Q-JRN-003). Reusing
 * the stricter schema here would force every page to answer a question it is
 * meant to be able to leave open.
 */
export const PageOwnershipSchema = z.record(z.string(), OwnershipLevelSchema);

/** Page kinds (REQ-JRN-002). `pdf` is [V2] and deliberately absent. */
export const JOURNAL_PAGE_TYPES = ["text", "image", "video"] as const;
export type JournalPageType = (typeof JOURNAL_PAGE_TYPES)[number];

/**
 * Reveal state of one secret block inside a page's text (REQ-JRN-012).
 *
 * Declared here so the shape is settled, even though the block-level cut is
 * not wired yet: a page is currently revealed whole.
 */
export const SecretBlockStateSchema = z.object({
  blockId: z.string(),
  revealed: z.boolean().default(false),
});

export type SecretBlockState = z.infer<typeof SecretBlockStateSchema>;

/**
 * One page of a journal entry.
 *
 * `content` is a string in every page type, and what it holds depends on
 * `type`: serialised TipTap JSON for `text`, an asset path or URL for `image`
 * and `video`. One field rather than a discriminated union because the page
 * changes type in place while the GM edits it, and a union would make that a
 * delete-and-recreate that loses the page's ownership — which is the state
 * this whole module exists to protect.
 */
export const JournalEntryPageSchema = z.object({
  _id: DocumentIdField,

  /** The page's title. For a quest objective this IS the objective's name. */
  name: z.string().default(""),

  type: z.enum(JOURNAL_PAGE_TYPES).default("text"),

  /** Heading depth in the table of contents, 1–6 (REQ-JRN-005). */
  tocLevel: z.number().int().min(1).max(6).default(1),

  /** Display order inside the entry. */
  sort: z.number().int().default(0),

  content: z.string().default(""),

  secretBlocks: z.array(SecretBlockStateSchema).default(() => []),

  /**
   * Per-user reveal state for this page alone. An EMPTY map means "inherit the
   * entry" — see {@link resolvePageLevel}; it is not the same as
   * `{ default: NONE }`, which means "hidden, whatever the entry says".
   */
  ownership: PageOwnershipSchema.default(() => ({})),

  flags: FlagsSchema.default(() => ({})),
});

export type JournalEntryPage = z.infer<typeof JournalEntryPageSchema>;

/**
 * A new page, hidden unless the caller opens it.
 *
 * The default is `{ default: NONE }` rather than inheritance on purpose: a
 * page added to a quest the party is already reading would otherwise publish
 * itself as the GM typed its title.
 */
export function createJournalPage(
  id: string,
  fields: Partial<JournalEntryPage> = {},
): JournalEntryPage {
  return JournalEntryPageSchema.parse({
    _id: id,
    ...fields,
    ownership: fields.ownership ?? { default: OwnershipLevel.NONE },
  });
}

/**
 * Effective level of one page for one user (Q-JRN-003 — override, then inherit).
 *
 * `role` is NOT consulted here: privilege is decided once, at the emission
 * boundary, by `isRolePrivileged`. Mixing the two would give this function two
 * answers to the same question and let a caller pick the wrong one.
 */
export function resolvePageLevel(
  page: Pick<JournalEntryPage, "ownership">,
  entryOwnership: Ownership,
  userId: string | null | undefined,
): OwnershipLevel {
  // No user, no reading — a socket without an identified user is not at the
  // table, and `default` means "the table". This mirrors `getUserLevel`, which
  // fails closed the same way; leaving it to step 2 would have let a page's own
  // `default` hand content to an anonymous viewer that step 3 refuses.
  if (userId === null || userId === undefined || userId === "") return OwnershipLevel.NONE;

  const own = page.ownership;
  const explicit = own[userId];
  if (explicit !== undefined && explicit !== OwnershipLevel.INHERIT) return explicit;

  const pageDefault = own["default"];
  if (pageDefault !== undefined && pageDefault !== OwnershipLevel.INHERIT) return pageDefault;

  return getUserLevel(entryOwnership, userId);
}

/**
 * May this user read the page at all?
 *
 * `OBSERVER`, not `LIMITED`: there is no rumour state for a page. A quest's
 * rumour is a page of its own that the player fully reads (DEC-HUB-05), so
 * anything below OBSERVER simply does not travel.
 */
export function canReadPage(
  page: Pick<JournalEntryPage, "ownership">,
  entryOwnership: Ownership,
  userId: string | null | undefined,
): boolean {
  return resolvePageLevel(page, entryOwnership, userId) >= OwnershipLevel.OBSERVER;
}
