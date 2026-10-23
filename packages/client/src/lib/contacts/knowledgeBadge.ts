/**
 * knowledgeBadge.ts — the state dot of the Contatos tab (spec 39 §5.1, G066).
 *
 * The tab carries ONE badge, and it is a **state dot** with no number
 * (REQ-CTT-002, REQ-GAV-020): "someone you did not know has been introduced".
 * It lights when a contact **rises in state** for any of the viewer's characters
 * while the tab is closed, and goes out when the tab is opened (REQ-CTT-003).
 *
 * The whole rule rests on one observation, and it is what makes the requirement
 * cheap: the client never needs the knowledge map to know its own state. The
 * server already resolved the maximum across the viewer's characters before it
 * emitted anything (G060/G061), so what arrives IS the answer:
 *
 *  - a contact at `oculto` is **not delivered at all** → level 0 by absence;
 *  - a contact at `entrevisto` arrives stripped, marked `flags.fusion.glimpsed`
 *    → level 1;
 *  - a contact at `conhecido` arrives whole → level 2.
 *
 * Three consequences of reading only that, and each is a requirement:
 *
 *  - **the dot cannot light for a condition** (REQ-CTT-004): a condition is an
 *    embedded item, and no item is an input of `observedKnowledgeOf`;
 *  - **the dot cannot light for a connection or a disconnection** (REQ-CTT-004):
 *    presence is not a document at all, it never reaches this module;
 *  - **the dot cannot light for the Mestre** (REQ-CTT-004): a privileged seat is
 *    refused at the door of `refresh`, because the news is always his own doing.
 *
 * The mark of "what I last saw" is a `ClientUIPreferences` value (DEC-UIF-10): it
 * lives in `localStorage`, keyed by world + user, and never travels to the server
 * (spec 39 §7). A contact missing from the mark counts as `oculto`, so a table
 * that reveals someone while the player is away greets him with the dot lit.
 *
 * This file is a plain `.ts` on purpose: the only reactive thing here is the dot
 * itself, and that comes from `createDotBadge` (`lib/sidebar/badges.svelte.ts`),
 * which owns the rune. Everything else is a pure function over documents, so the
 * rule is testable without a rail, a socket or a DOM.
 */

import { createDotBadge } from "../sidebar/badges.svelte.js";
import type { SidebarDotBadge } from "../sidebar/badges.svelte.js";
import { worldMirror } from "../docs/worldSync.js";
import { isGlimpsedContact, isKnownContact } from "./contactsVM.js";
import type { ContactActorDoc } from "./contactsVM.js";

// ---------------------------------------------------------------------------
// What the viewer can observe of a contact's state
// ---------------------------------------------------------------------------

/**
 * The three states of REQ-CTT-070 as the viewer can see them, without ever
 * holding the knowledge map: `0` oculto (absent), `1` entrevisto, `2` conhecido.
 */
export type ObservedKnowledge = 0 | 1 | 2;

/** Contact id → the state the viewer currently observes. Only 1 and 2 appear. */
export type ObservedKnowledgeMap = Readonly<Record<string, ObservedKnowledge>>;

/** Storage key prefix, following the `fusion:<thing>` convention of the client. */
export const CONTACTS_SEEN_KEY_PREFIX = "fusion:contactsSeen";

/**
 * The mark of one user in one world (spec 39 §7). Both ids are in the key: a
 * device shared by two players keeps two independent marks, and moving to
 * another world does not carry one table's introductions into the next.
 */
export function contactsSeenKey(worldId: string, userId: string): string {
  return `${CONTACTS_SEEN_KEY_PREFIX}:${worldId}:${userId}`;
}

/**
 * What state this document announces about itself (REQ-CTT-003).
 *
 * Only a contact answers: a player character and a sub-character belong to the
 * "Na mesa" section, which knowledge never governs (REQ-CTT-072), so they are
 * `0` here and can never move the dot.
 */
export function observedKnowledgeOf(doc: ContactActorDoc): ObservedKnowledge {
  if (!isKnownContact(doc)) return 0;
  return isGlimpsedContact(doc) ? 1 : 2;
}

/** The observed state of every contact in a payload, keyed by id. */
export function observedKnowledgeMap(actors: readonly ContactActorDoc[]): ObservedKnowledgeMap {
  const map: Record<string, ObservedKnowledge> = {};
  for (const doc of actors) {
    const level = observedKnowledgeOf(doc);
    if (level > 0) map[doc._id] = level;
  }
  return map;
}

/**
 * Which contacts rose since the mark (REQ-CTT-003). A contact absent from the
 * mark was `oculto` for this user, so its arrival at any level is a rise.
 *
 * Sorted, so the answer is a value and not an accident of iteration order.
 */
export function risenContacts(
  seen: ObservedKnowledgeMap,
  current: ObservedKnowledgeMap,
): readonly string[] {
  return Object.keys(current)
    .filter((id) => (current[id] ?? 0) > (seen[id] ?? 0))
    .sort();
}

/** Whether anything rose at all — the dot has no number (REQ-CTT-002). */
export function hasKnowledgeRise(
  seen: ObservedKnowledgeMap,
  current: ObservedKnowledgeMap,
): boolean {
  return risenContacts(seen, current).length > 0;
}

// ---------------------------------------------------------------------------
// The mark, on this device
// ---------------------------------------------------------------------------

function hasSeat(worldId: string, userId: string): boolean {
  return worldId.length > 0 && userId.length > 0;
}

function asObserved(value: unknown): ObservedKnowledge | null {
  return value === 1 || value === 2 ? value : null;
}

/**
 * Read the mark of this user in this world; an empty mark when there is none,
 * storage is unavailable, or what is stored cannot be read. Never throws — a
 * corrupt entry must not cost the table its drawer.
 */
export function loadSeenKnowledge(worldId: string, userId: string): ObservedKnowledgeMap {
  if (!hasSeat(worldId, userId)) return {};
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(contactsSeenKey(worldId, userId));
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const map: Record<string, ObservedKnowledge> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const level = asObserved(value);
      if (level !== null) map[id] = level;
    }
    return map;
  } catch {
    /* localStorage unavailable or unparseable — treat as "never looked". */
    return {};
  }
}

/**
 * Write the mark (REQ-CTT-003). Only what the viewer can see right now is
 * stored: a contact that fell back to `oculto` leaves the mark, so being
 * introduced again later reads as the news it is.
 */
export function saveSeenKnowledge(
  worldId: string,
  userId: string,
  map: ObservedKnowledgeMap,
): void {
  if (!hasSeat(worldId, userId)) return;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(contactsSeenKey(worldId, userId), JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/** Drop this user's mark in this world. */
export function clearSeenKnowledge(worldId: string, userId: string): void {
  if (!hasSeat(worldId, userId)) return;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(contactsSeenKey(worldId, userId));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// The badge store the rail reads
// ---------------------------------------------------------------------------

/**
 * The tab's badge (REQ-CTT-002). A dot store yields a boolean and nothing else,
 * which is how "a tab cannot have both kinds" (REQ-GAV-020) stays structural.
 * The rail only reads it (REQ-GAV-022/023); every rule that moves it is here.
 */
export const contactsStateDot: SidebarDotBadge = createDotBadge();

/** The seat the badge is following: one world, one user, one role. */
export interface ContactsBadgeSeat {
  readonly worldId: string;
  readonly userId: string;
  /** Mirrors the server's `isRolePrivileged` — a privileged seat never lights it. */
  readonly isPrivileged: boolean;
}

let seat: ContactsBadgeSeat | null = null;
let unsubscribe: (() => void) | null = null;
/** Whether the Contatos panel is mounted, i.e. whether the tab is open. */
let tabOpen = false;

/**
 * Recompute the dot from the payload the client already has.
 *
 * A pure decision written into the store, never a latch: the dot is lit exactly
 * while something stands above the mark. That is what makes "the GM took it back
 * before you looked" put the dot out on its own, with no timer and no bookkeeping.
 */
function refresh(actors: readonly ContactActorDoc[]): void {
  if (seat === null) return;

  // REQ-CTT-004: the news is always the Mestre's own doing — he never gets the dot.
  if (seat.isPrivileged) {
    contactsStateDot.clear();
    return;
  }

  const current = observedKnowledgeMap(actors);

  // REQ-CTT-003: while the tab is open there is nothing unseen; looking IS the mark.
  if (tabOpen) {
    saveSeenKnowledge(seat.worldId, seat.userId, current);
    contactsStateDot.clear();
    return;
  }

  contactsStateDot.set(hasKnowledgeRise(loadSeenKnowledge(seat.worldId, seat.userId), current));
}

/**
 * Follow the world's actors for this seat and keep the dot honest (REQ-CTT-003).
 *
 * Called once when the socket connects — the badge has to work with the tab
 * CLOSED, so it cannot live inside the panel: the drawer mounts a panel only
 * while its tab is open (REQ-GAV-017). Returns the detach function.
 */
export function attachContactsKnowledgeBadge(next: ContactsBadgeSeat): () => void {
  detachContactsKnowledgeBadge();
  seat = next;
  unsubscribe = worldMirror.subscribe<ContactActorDoc>("Actor", (docs) => {
    refresh(docs);
  });
  refresh(worldMirror.getByType<ContactActorDoc>("Actor"));
  return detachContactsKnowledgeBadge;
}

/**
 * Stop following and put the dot out (logout, disconnect, seat change).
 *
 * `tabOpen` is deliberately NOT reset here: whether the tab is open is the panel's
 * fact, not the socket's, and a reconnection with the Contatos tab on screen must
 * not start counting the list the user is looking at as unseen news.
 */
export function detachContactsKnowledgeBadge(): void {
  unsubscribe?.();
  unsubscribe = null;
  seat = null;
  contactsStateDot.clear();
}

/**
 * The panel tells the badge whether the tab is open (REQ-CTT-003).
 *
 * Same signal as the chat's `setChatTabVisible`: mount and unmount of the panel
 * ARE open and closed, because the drawer keeps only the active tab's panel
 * alive (REQ-GAV-017). Opening puts the dot out and writes the mark; the rail
 * itself never touches a badge (REQ-GAV-022).
 */
export function setContactsTabVisible(visible: boolean): void {
  tabOpen = visible;
  if (!visible) return;
  contactsStateDot.clear();
  if (seat === null) return;
  saveSeenKnowledge(
    seat.worldId,
    seat.userId,
    observedKnowledgeMap(worldMirror.getByType<ContactActorDoc>("Actor")),
  );
}
