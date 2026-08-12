/**
 * Journal page handlers — the pages of an entry and who may read each one.
 *
 * Spec: `12-journal-tabelas-cartas.md` (REQ-JRN-002, Q-JRN-003),
 * `28-hub-do-jogador.md` (DEC-HUB-04, REQ-HUB-028..035, REQ-HUB-038..042).
 *
 * ## Why dedicated ops and not the generic `doc:update`
 *
 * A page is an embedded array element, and the document store replaces arrays
 * wholesale (REQ-DOC-037). Editing one page through the generic path means
 * sending the whole `pages` array back, so two GMs — or one GM with two tabs
 * open, which is the ordinary case while preparing a session — would each
 * write their own copy of the list and the slower one would erase the other's
 * objective. Every op here reads the entry, changes ONE page, and writes back.
 *
 * The second reason is the reveal. `ownership` is what decides who reads a
 * page, and it must be unwritable from a content edit: the payload schemas
 * below exclude it by construction, so renaming an objective cannot silently
 * publish it. Only `journal:revealPage` touches it, and only a GM may call it.
 *
 * ## Who may do what
 *
 * | Op          | GM  | Player                                            |
 * |-------------|-----|---------------------------------------------------|
 * | createPage  | yes | never — pages are authored by the GM              |
 * | updatePage  | yes | never                                             |
 * | deletePage  | yes | never                                             |
 * | revealPage  | yes | never — the reveal IS the GM's control            |
 *
 * The whole board is GM-authored (DEC-HUB-04). A player's contribution to a
 * quest is reading it and having their objectives revealed; when player-written
 * notes arrive they will be pages with a `kind`, the way map pins already are,
 * and this table gains a row rather than losing one.
 */

import type { Namespace } from "socket.io";
import type { HandlerFn } from "../handler-registry.js";
import type { SeqStore } from "../seq-store.js";
import type { OpBuffer } from "../op-buffer.js";
import type { DocumentStore } from "../../documents/store.js";
import { DocumentNotFoundError } from "../../documents/store.js";
import { isRolePrivileged, OwnershipLevel } from "../../documents/ownership.js";
import {
  JournalEntryPageSchema,
  createJournalPage,
  createDocumentId,
  JOURNAL_PAGE_TYPES,
  type Ack,
  type Envelope,
  type JournalEntryPage,
} from "@fusion/shared";
import { z } from "zod";
import { emitJournalOp } from "../redaction.js";

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------

export interface JournalHandlerDeps {
  store: DocumentStore;
  seqStore: SeqStore;
  opBuffer: OpBuffer;
  ns: Namespace;
}

function ackOk<R>(result: R, seq: number): Ack<R> {
  return { ok: true, seq, result };
}

function ackError(code: string, message: string): Ack<never> {
  return { ok: false, code: code as never, message };
}

// ---------------------------------------------------------------------------
// Payload schemas
// ---------------------------------------------------------------------------

const DocIdSchema = z.string().regex(/^[A-Za-z0-9]{16}$/);

/**
 * Quest state a page carries in `flags.fusion.hub`.
 *
 * Declared as a schema rather than accepting free `flags` because flags are a
 * shared namespace every subsystem reads: a client that could write arbitrary
 * flags could write another subsystem's. Two fields, both from spec 28:
 *
 *  - `done` — the objective is finished. It belongs to the TABLE, not to a
 *    player (Q-HUB-04, answered by the owner on 2026-08-12), so it is one
 *    boolean and not a map of who ticked it.
 *  - `pois` — region-map pins this objective points at (REQ-HUB-038). Per
 *    OBJECTIVE, not only per quest: "falar com o xerife" and "a coisa na
 *    neblina" are two different places, and pointing both at the quest's one
 *    location would send the party to the wrong one. Several objectives MAY
 *    name the same pin, and an objective may name none.
 */
const QuestPageStateSchema = z
  .object({
    done: z.boolean().optional(),
    pois: z.array(DocIdSchema).max(50).optional(),
  })
  .strict();

/**
 * Content a client may write on a page.
 *
 * `ownership` is absent by construction — this schema IS the boundary, so a
 * payload carrying it fails validation instead of being stripped downstream
 * and hoping nobody forgets. `_id` likewise: a page's identity is not editable.
 */
const PageContentSchema = z
  .object({
    name: z.string().max(200).optional(),
    type: z.enum(JOURNAL_PAGE_TYPES).optional(),
    tocLevel: z.number().int().min(1).max(6).optional(),
    sort: z.number().int().optional(),
    content: z.string().max(200_000).optional(),
    hub: QuestPageStateSchema.optional(),
  })
  .strict();

const CreatePagePayloadSchema = z
  .object({
    entryId: DocIdSchema,
    page: PageContentSchema,
    /**
     * Reveal the new page to the table straight away. Absent means hidden,
     * which is what an objective the GM is still writing has to be.
     */
    visible: z.boolean().default(false),
  })
  .strict();

const UpdatePagePayloadSchema = z
  .object({ entryId: DocIdSchema, pageId: DocIdSchema, patch: PageContentSchema })
  .strict();

const DeletePagePayloadSchema = z.object({ entryId: DocIdSchema, pageId: DocIdSchema }).strict();

const RevealPagePayloadSchema = z
  .object({
    entryId: DocIdSchema,
    pageId: DocIdSchema,
    /** Users whose level changes. Empty means "the default", i.e. the table. */
    userIds: z.array(z.string()).default(() => []),
    /** NONE (hidden) · OBSERVER (readable). A page has no rumour state. */
    level: z.union([z.literal(OwnershipLevel.NONE), z.literal(OwnershipLevel.OBSERVER)]),
  })
  .strict();

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

function loadEntry(
  store: DocumentStore,
  entryId: string,
): { entry: Record<string, unknown>; err: Ack<never> | null } {
  try {
    return { entry: store.get("journal_entries", entryId), err: null };
  } catch (err) {
    if (err instanceof DocumentNotFoundError) {
      return { entry: {}, err: ackError("NOT_FOUND", `Journal não encontrado: ${entryId}`) };
    }
    throw err;
  }
}

function pagesOf(entry: Record<string, unknown>): JournalEntryPage[] {
  const raw = entry["pages"];
  if (!Array.isArray(raw)) return [];
  return raw as JournalEntryPage[];
}

/** Merge quest state into a page's flags without disturbing other namespaces. */
function withHubFlags(
  page: JournalEntryPage,
  hub: z.infer<typeof QuestPageStateSchema>,
): Record<string, Record<string, unknown>> {
  const flags = { ...page.flags };
  const fusion = { ...(flags["fusion"] ?? {}) };
  const existing = (fusion["hub"] ?? {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...existing };
  if (hub.done !== undefined) next["done"] = hub.done;
  if (hub.pois !== undefined) next["pois"] = hub.pois;
  fusion["hub"] = next;
  flags["fusion"] = fusion;
  return flags;
}

/**
 * Persist the new page list and tell the world.
 *
 * The emit goes through `emitJournalOp`, which builds one payload per socket —
 * the pages are cut per user, so a single shared envelope would hand every
 * player every objective and the board would be over.
 */
function persistAndBroadcast(
  deps: JournalHandlerDeps,
  userId: string,
  entryId: string,
  pages: JournalEntryPage[],
): Ack {
  const updated = deps.store.update("journal_entries", entryId, { pages }, { userId });
  if (!updated) return ackError("INTERNAL_ERROR", "Falha ao gravar o journal");

  const seq = deps.seqStore.next();
  const envelope: Envelope = {
    type: "doc:update",
    seq,
    ts: Date.now(),
    payload: { documentType: "JournalEntry", documents: [updated] },
  };
  deps.opBuffer.push(envelope);
  // An entry with zero pages has nothing per-viewer about it; emit it plainly.
  if (!emitJournalOp(deps.ns, envelope)) {
    deps.ns.emit("op", envelope);
  }

  return ackOk({ documentType: "JournalEntry", documents: [updated] }, seq);
}

/** Apply a content patch to a page, leaving identity and reveal untouched. */
function patchPage(
  existing: JournalEntryPage,
  patch: z.infer<typeof PageContentSchema>,
): JournalEntryPage | null {
  const merged: Record<string, unknown> = { ...existing };
  if (patch.name !== undefined) merged["name"] = patch.name;
  if (patch.type !== undefined) merged["type"] = patch.type;
  if (patch.tocLevel !== undefined) merged["tocLevel"] = patch.tocLevel;
  if (patch.sort !== undefined) merged["sort"] = patch.sort;
  if (patch.content !== undefined) merged["content"] = patch.content;
  if (patch.hub !== undefined) merged["flags"] = withHubFlags(existing, patch.hub);

  // Identity and reveal survive any content edit — renaming an objective must
  // never change who can read it (REQ-HUB-032a).
  merged["_id"] = existing._id;
  merged["ownership"] = existing.ownership;

  const result = JournalEntryPageSchema.safeParse(merged);
  return result.success ? result.data : null;
}

// ---------------------------------------------------------------------------
// journal:createPage — GM only
// ---------------------------------------------------------------------------

/**
 * Add a page to an entry.
 *
 * It arrives hidden unless the caller asks otherwise, and that default is the
 * point: an objective added to a quest the party is already reading would
 * otherwise publish itself as its title was typed.
 */
export function buildCreatePageHandler(deps: JournalHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Só o GM escreve páginas de journal");
    }

    const parsed = CreatePagePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) return ackError("VALIDATION_FAILED", parsed.error.message);
    const { entryId, page, visible } = parsed.data;

    const { entry, err } = loadEntry(deps.store, entryId);
    if (err) return err;

    const pages = pagesOf(entry);
    const fields: Partial<JournalEntryPage> = {
      // A page with no sort of its own goes last, which is where a GM writing
      // an objective expects it to land.
      sort: page.sort ?? pages.length,
      ownership: visible ? { default: OwnershipLevel.OBSERVER } : { default: OwnershipLevel.NONE },
    };
    if (page.name !== undefined) fields.name = page.name;
    if (page.type !== undefined) fields.type = page.type;
    if (page.tocLevel !== undefined) fields.tocLevel = page.tocLevel;
    if (page.content !== undefined) fields.content = page.content;

    const created = createJournalPage(createDocumentId(), fields);
    const withFlags =
      page.hub === undefined ? created : { ...created, flags: withHubFlags(created, page.hub) };

    return persistAndBroadcast(deps, ctx.userId, entryId, [...pages, withFlags]);
  };
}

// ---------------------------------------------------------------------------
// journal:updatePage — GM only
// ---------------------------------------------------------------------------

export function buildUpdatePageHandler(deps: JournalHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Só o GM edita páginas de journal");
    }

    const parsed = UpdatePagePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) return ackError("VALIDATION_FAILED", parsed.error.message);
    const { entryId, pageId, patch } = parsed.data;

    const { entry, err } = loadEntry(deps.store, entryId);
    if (err) return err;

    const pages = pagesOf(entry);
    const index = pages.findIndex((page) => page._id === pageId);
    const existing = index === -1 ? undefined : pages[index];
    if (!existing) return ackError("NOT_FOUND", `Página não encontrada: ${pageId}`);

    const next = patchPage(existing, patch);
    if (!next) return ackError("VALIDATION_FAILED", "Página inválida após a edição");

    const list = [...pages];
    list[index] = next;
    return persistAndBroadcast(deps, ctx.userId, entryId, list);
  };
}

// ---------------------------------------------------------------------------
// journal:deletePage — GM only
// ---------------------------------------------------------------------------

export function buildDeletePageHandler(deps: JournalHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Só o GM remove páginas de journal");
    }

    const parsed = DeletePagePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) return ackError("VALIDATION_FAILED", parsed.error.message);
    const { entryId, pageId } = parsed.data;

    const { entry, err } = loadEntry(deps.store, entryId);
    if (err) return err;

    const pages = pagesOf(entry);
    if (!pages.some((page) => page._id === pageId)) {
      return ackError("NOT_FOUND", `Página não encontrada: ${pageId}`);
    }

    return persistAndBroadcast(
      deps,
      ctx.userId,
      entryId,
      pages.filter((page) => page._id !== pageId),
    );
  };
}

// ---------------------------------------------------------------------------
// journal:revealPage — GM only
// ---------------------------------------------------------------------------

/**
 * Move a page's reveal for one or more players (REQ-HUB-029/032).
 *
 * An empty `userIds` writes the page's `default` instead, which is how "the
 * whole table" is expressed without enumerating who happens to be connected.
 * Revealing one page never touches another: an objective is liberated
 * individually, and the quest's own state stays where the GM left it
 * (DEC-HUB-06).
 */
export function buildRevealPageHandler(deps: JournalHandlerDeps): HandlerFn {
  return (rawPayload, ctx) => {
    if (!isRolePrivileged(ctx.role)) {
      return ackError("PERMISSION_DENIED", "Só o GM revela páginas");
    }

    const parsed = RevealPagePayloadSchema.safeParse(rawPayload);
    if (!parsed.success) return ackError("VALIDATION_FAILED", parsed.error.message);
    const { entryId, pageId, userIds, level } = parsed.data;

    const { entry, err } = loadEntry(deps.store, entryId);
    if (err) return err;

    const pages = pagesOf(entry);
    const index = pages.findIndex((page) => page._id === pageId);
    const existing = index === -1 ? undefined : pages[index];
    if (!existing) return ackError("NOT_FOUND", `Página não encontrada: ${pageId}`);

    const ownership: Record<string, number> = { ...existing.ownership };
    if (userIds.length === 0) {
      ownership["default"] = level;
    } else {
      for (const userId of userIds) ownership[userId] = level;
    }

    const result = JournalEntryPageSchema.safeParse({ ...existing, ownership });
    if (!result.success) return ackError("VALIDATION_FAILED", result.error.message);

    const list = [...pages];
    list[index] = result.data;
    return persistAndBroadcast(deps, ctx.userId, entryId, list);
  };
}
