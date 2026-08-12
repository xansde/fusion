/**
 * questStore.svelte.ts — the Missões panel's state and the ops behind it.
 *
 * Spec: 28 (DEC-HUB-04..07, REQ-HUB-021..042), and the design settled with the
 * owner in `docs/design/quadro-de-missoes.md`.
 *
 * The panel draws; this module owns everything else — which quests reached
 * this client, which one is open, and the four ops a GM may send. They are
 * apart for the reason every store in this folder is: the client's Vitest runs
 * in `environment: "node"`, where a `.svelte` file has no DOM to mount into,
 * and the reading rules are what deserve tests.
 *
 * Nothing here decides visibility. The server already cut each entry for this
 * viewer (`redactJournalForViewer`), so a page that arrived is a page this
 * user may read. The one exception is the GM's own preview — `viewAs` below —
 * which re-resolves the GM's complete copy against another player's id. That
 * is not a second implementation of the rule: it calls the same shared
 * functions the server does, which is what makes the preview exact.
 */

import type { Socket } from "socket.io-client";
import {
  OwnershipLevel,
  isQuest,
  isQuestDone,
  questPois,
  questReadingFor,
  readablePages,
  objectivesOf,
  pagesWithRole,
  pageRole,
  type JournalEntryPage,
  type QuestEntry,
  type QuestReading,
} from "@fusion/shared";
import { worldMirror } from "../docs/worldSync.js";
import { sendOp } from "../docs/sendOp.js";

/** Document type as the server names it on the wire. */
const DOC_TYPE = "JournalEntry";

/** A quest as the panel draws it, for one particular viewer. */
export interface QuestView {
  entry: QuestEntry;
  reading: QuestReading;
  done: boolean;
  /** Hook page, when this viewer has it. */
  hook: JournalEntryPage | null;
  /** Rumour page, when this viewer has it. */
  rumour: JournalEntryPage | null;
  /** Objectives this viewer may read, in the GM's order. */
  objectives: JournalEntryPage[];
  /** Region-map pins the quest as a whole points at. */
  pois: string[];
}

/**
 * Build the board one viewer sees.
 *
 * `privileged` is the GM reading their own board; `viewerId` is whose board it
 * is. The two are separate arguments precisely so the GM can ask for someone
 * else's: passing a player's id with `privileged = false` against the GM's
 * complete documents IS the "ver como <jogador>" preview (REQ-HUB-033).
 */
export function buildBoard(
  entries: QuestEntry[],
  viewerId: string,
  privileged: boolean,
): QuestView[] {
  const views: QuestView[] = [];
  for (const entry of entries) {
    if (!isQuest(entry)) continue;

    const reading = questReadingFor(entry, viewerId, privileged);
    if (reading === "hidden") continue;

    const visible = readablePages(entry, viewerId, privileged);
    const scoped: QuestEntry = { ...entry, pages: visible };

    views.push({
      entry: scoped,
      reading,
      done: isQuestDone(entry),
      hook: pagesWithRole(scoped, "hook")[0] ?? null,
      rumour: pagesWithRole(scoped, "rumour")[0] ?? null,
      objectives: objectivesOf(scoped),
      pois: questPois(entry),
    });
  }
  return views;
}

/** Quests on the board, and quests that are still only a rumour. */
export function splitBoard(views: QuestView[]): {
  published: QuestView[];
  rumours: QuestView[];
} {
  return {
    published: views.filter((view) => view.reading === "published"),
    rumours: views.filter((view) => view.reading === "rumour"),
  };
}

/**
 * Reactive view over the world's quests.
 *
 * A class with `$state` fields rather than a store factory, for the same
 * reason as `regionMapStore`: the Hub has one Missões panel and its selection
 * has to survive the panel being closed and reopened.
 */
class QuestStore {
  /** Every journal entry that reached this client. */
  entries = $state<QuestEntry[]>([]);

  /** `_id` of the quest whose detail is open. */
  openQuestId = $state<string | null>(null);

  /**
   * Whose board the GM is looking at. `null` is their own.
   *
   * Lives here rather than in the component because it must survive closing
   * the panel: a GM previewing a player's board, tabbing away to move a token
   * and coming back expects to still be in that player's shoes.
   */
  viewAs = $state<string | null>(null);

  private _unsubscribe: (() => void) | null = null;

  attach(): void {
    this.refresh();
    this._unsubscribe ??= worldMirror.subscribe<QuestEntry>(DOC_TYPE, (docs) => {
      this.entries = [...docs];
      this._reconcile();
    });
  }

  detach(): void {
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  refresh(): void {
    this.entries = worldMirror.getByType<QuestEntry>(DOC_TYPE);
    this._reconcile();
  }

  /** Every quest, GM order. Used by the authoring side and the matrix. */
  get quests(): QuestEntry[] {
    return this.entries.filter((entry) => isQuest(entry));
  }

  get openQuest(): QuestEntry | null {
    if (this.openQuestId === null) return null;
    return this.quests.find((entry) => entry._id === this.openQuestId) ?? null;
  }

  /** Keep the selection pointing at something real. */
  private _reconcile(): void {
    if (this.openQuestId !== null && !this.quests.some((q) => q._id === this.openQuestId)) {
      this.openQuestId = null;
    }
  }
}

export const questStore = new QuestStore();

// ---------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------

/** Create the quest itself. GM only — the server enforces it. */
export async function createQuest(socket: Socket, name: string): Promise<string> {
  const result = await sendOp<{ documents: Array<{ _id: string }> }>(socket, {
    type: "doc:create",
    payload: {
      documentType: DOC_TYPE,
      data: [
        {
          name,
          // The entry is open to the table; what is held back are its pages.
          // A quest at `default: NONE` would be invisible even to the player
          // whose objective the GM just revealed.
          ownership: { default: OwnershipLevel.OBSERVER },
          flags: { fusion: { hub: { kind: "quest", done: false, pois: [] } } },
        },
      ],
    },
  });
  const id = result.documents[0]?._id;
  if (id === undefined) throw new Error("o servidor não devolveu a missão criada");
  return id;
}

/** Change the quest's own fields — its name, its completion, its places. */
export async function updateQuest(
  socket: Socket,
  entryId: string,
  diff: Record<string, unknown>,
): Promise<void> {
  await sendOp(socket, {
    type: "doc:update",
    payload: { documentType: DOC_TYPE, updates: [{ _id: entryId, diff }] },
  });
}

/**
 * Mark the quest done, or undo it (REQ-HUB-034/035).
 *
 * The flags are rewritten whole because the document store merges objects but
 * a partial `hub` would drop `kind` and the quest would stop being a quest.
 */
export async function setQuestDone(
  socket: Socket,
  entry: QuestEntry,
  done: boolean,
): Promise<void> {
  await updateQuest(socket, entry._id, {
    flags: { fusion: { hub: { kind: "quest", done, pois: questPois(entry) } } },
  });
}

/** Point the quest as a whole at region-map pins (REQ-HUB-038). */
export async function setQuestPois(
  socket: Socket,
  entry: QuestEntry,
  pois: string[],
): Promise<void> {
  await updateQuest(socket, entry._id, {
    flags: { fusion: { hub: { kind: "quest", done: isQuestDone(entry), pois } } },
  });
}

export interface PageDraft {
  name?: string;
  content?: string;
  sort?: number;
  hub?: { role?: string; done?: boolean; pois?: string[] };
}

/** Add a page. Hidden unless `visible`, which is what keeps prep private. */
export async function createPage(
  socket: Socket,
  entryId: string,
  page: PageDraft,
  visible = false,
): Promise<void> {
  await sendOp(socket, {
    type: "journal:createPage",
    payload: { entryId, page, visible },
  });
}

export async function updatePage(
  socket: Socket,
  entryId: string,
  pageId: string,
  patch: PageDraft,
): Promise<void> {
  await sendOp(socket, { type: "journal:updatePage", payload: { entryId, pageId, patch } });
}

export async function deletePage(socket: Socket, entryId: string, pageId: string): Promise<void> {
  await sendOp(socket, { type: "journal:deletePage", payload: { entryId, pageId } });
}

/**
 * Move a page's reveal for one player, or for the table.
 *
 * An empty `userIds` writes the page's `default`, which is how "everyone" is
 * expressed without enumerating who happens to be connected.
 */
export async function revealPage(
  socket: Socket,
  entryId: string,
  pageId: string,
  userIds: string[],
  level: OwnershipLevel,
): Promise<void> {
  await sendOp(socket, {
    type: "journal:revealPage",
    payload: { entryId, pageId, userIds, level },
  });
}

// ---------------------------------------------------------------------------
// Players, for the reveal matrix
// ---------------------------------------------------------------------------

export interface TablePlayer {
  id: string;
  name: string;
}

/** Every non-GM user in the world — the columns of the reveal matrix. */
export function listTablePlayers(): TablePlayer[] {
  const users = worldMirror.getByType<{ _id: string; name?: string; role?: number }>("User");
  return users
    .filter((user) => (user.role ?? 0) < 3)
    .map((user) => ({ id: user._id, name: user.name ?? "?" }));
}

/** Re-exported so the panel imports its vocabulary from one place. */
export { pageRole, objectivesOf, questPois };
