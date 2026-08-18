/**
 * contactsVM.ts — everything the Contatos panel draws, as pure data (spec 39).
 *
 * The panel itself (`components/contacts/ContactsPanel.svelte`) is a thin shell:
 * every rule spec 39 §5.2 and §5.3 states — who comes first, what the line under
 * the name says, who may rewrite it, who may drag a card to the map, which
 * sub-character hangs off which card — is decided here, with no DOM, no store and
 * no socket, so all of it is unit-testable in the client's node environment.
 *
 * Three rules run through the whole module and are worth stating once:
 *
 *  - **No hit points, for any role** (REQ-CTT-021, DEC-CTT-02). Nothing in this
 *    file reads `system.attributes.hp`, and nothing in the card shape can carry
 *    it. The panel cannot leak what the view model never computes.
 *  - **Presence changes the presentation, never the position** (REQ-CTT-015):
 *    `present` is a field of the card, and it is not part of any sort key.
 *  - **Knowledge is redacted on the server** (REQ-CTT-081/083). A contact the
 *    viewer has only glimpsed arrives with no `name` and no `system`, carrying
 *    `flags.fusion.glimpsed` — so it cannot be found by name here (REQ-CTT-013)
 *    as a consequence of the payload, not of a screen rule. `img` DOES travel,
 *    since TK003 (spec 41-token.md DEC-TOK-09/§12): a token on the map needs
 *    the art even for an actor the viewer has only glimpsed. This card's own
 *    VM still blanks it (`img: identified ? doc.img : null` below) — the
 *    silhouette this screen shows instead of the portrait is THIS screen's own
 *    presentation choice (DEC-CTT-04), never the server's redaction.
 *
 * A card's `name` resolves through `displayName()` (packages/client/src/lib/
 * docs/displayName.ts, REQ-CMP-055) rather than `doc.name` straight — see
 * `npcRowVM.ts`'s docstring for why: the world document stays EN-pure, and the
 * pt-BR label (when the pack had one) is a snapshot in
 * `flags.fusion.i18n["pt-BR"].name`, taken at import time.
 */

import {
  KnowledgeState,
  OwnershipLevel,
  getUserLevel,
  readKnowledgeMap,
  resolveKnowledgeFromMap,
} from "@fusion/shared";
import type { Ownership } from "@fusion/shared";
import { categoryOfContact } from "./categories.js";
import type { ContactCategories } from "./categories.js";
import { displayName } from "../docs/displayName.js";
import { buildConditionViews } from "../conditions/conditionView.js";
import type {
  ActiveCondition,
  ConditionDisplayContract,
  ConditionView,
} from "../conditions/conditionView.js";

// ---------------------------------------------------------------------------
// The documents this module reads
// ---------------------------------------------------------------------------

/**
 * An Actor as the world mirror holds it, narrowed to what a contact card needs.
 *
 * Every field is optional on purpose: a glimpsed contact reaches the client with
 * almost nothing (REQ-CTT-041), and a partially-filled document must never throw.
 */
export interface ContactActorDoc {
  readonly _id: string;
  readonly name?: string | null;
  readonly type?: string | null;
  readonly img?: string | null;
  readonly ownership?: Ownership | undefined;
  readonly system?: Record<string, unknown> | undefined;
  readonly items?: readonly Record<string, unknown>[] | undefined;
  readonly flags?: Record<string, unknown> | undefined;
}

/**
 * Actor subtypes that stand for a player's own character — the population of the
 * "Na mesa" section.
 *
 * Mirrors the first (playable) entry of each system manifest's `documentTypes.Actor`:
 * pf2e/sf2e call it `character`, etmos calls it `orador`. The client package may not
 * import a system package (arch boundary), so the list is mirrored by hand here.
 */
export const PLAYER_CHARACTER_SUBTYPES: ReadonlySet<string> = new Set(["character", "orador"]);

/**
 * Actor subtypes that stand for a NON-PLAYABLE character — the population of the
 * "Conhecidos" section (REQ-CTT-040).
 *
 * An allow-list on purpose, mirrored by hand from the manifests exactly like
 * {@link PLAYER_CHARACTER_SUBTYPES}: pf2e/sf2e declare `npc` and `hazard`, etmos
 * declares `antagonista` (`documentTypes.Actor` in each system's `src/index.ts`).
 *
 * The complement of "is a character" would be a different, wrong set. The
 * manifests also declare `loot` — the container behind the Mestre's chest, which
 * spec 42 keeps out of every list, count and knowledge window (DEC-NPC-05,
 * DEC-NPC-08) — and any subtype a future system invents would join the section
 * without anyone deciding it should. Spec 42 §3 fixes the vocabulary this list
 * mirrors: "Não-jogável — Ator que não é personagem de jogador: `npc` ou `hazard`".
 */
export const NON_PLAYABLE_SUBTYPES: ReadonlySet<string> = new Set(["npc", "hazard", "antagonista"]);

/**
 * The Actor subtype every companion uses in the MVP (spec 29), and the link the
 * server itself authorizes against: `type === "familiar"` plus a non-empty
 * `system.masterActorId` (`net/handlers/doc-handlers.ts`). DEC-CTT-06 is explicit
 * that this tab reads that very pair instead of inventing a second vocabulary.
 */
export const COMPANION_ACTOR_SUBTYPE = "familiar";

/** Where the free title of a contact lives on its own Actor (spec 39 §7). */
export const CONTACT_TITLE_FLAG_PATH = "flags.fusion.title";

/** The marker the server's redaction leaves on a glimpsed contact (REQ-CTT-041). */
export const GLIMPSED_FLAG_PATH = "flags.fusion.glimpsed";

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

/** The line under the name: the free title, or the system's own identification. */
export interface ContactTitleLine {
  readonly text: string;
  /**
   * `"title"` when the free title is filled, `"fallback"` when it is empty and the
   * line dropped to class and level. The panel draws the two differently
   * (REQ-CTT-023) — this is the flag it styles on, never the text itself.
   */
  readonly kind: "title" | "fallback";
}

/** A sub-character, always drawn inside its owner's card (REQ-CTT-025). */
export interface SubContactCard {
  readonly id: string;
  readonly name: string;
  readonly img: string | null;
  /** Kind of companion as the system stored it ("familiar", "animalCompanion", …). */
  readonly kind: string;
  readonly conditions: readonly ConditionView[];
}

/** One card of the "Na mesa" section. Carries no hit points at all (REQ-CTT-021). */
export interface ContactCard {
  readonly id: string;
  readonly name: string;
  readonly img: string | null;
  /** The viewer owns this character (REQ-CTT-022). */
  readonly isMine: boolean;
  /** At least one owner of this character is connected (REQ-CTT-015). */
  readonly present: boolean;
  readonly title: ContactTitleLine;
  /** The viewer may rewrite the title in the card itself (REQ-CTT-024/085). */
  readonly canEditTitle: boolean;
  /** The card may be dragged onto the canvas (REQ-CTT-028). */
  readonly draggable: boolean;
  readonly conditions: readonly ConditionView[];
  readonly subCharacters: readonly SubContactCard[];
}

/** The "Na mesa" section: the viewer's own characters first, then the rest. */
export interface TableSection {
  readonly mine: readonly ContactCard[];
  readonly others: readonly ContactCard[];
  /** Cards in both blocks — sub-characters are part of a card, never counted apart. */
  readonly total: number;
}

// ---------------------------------------------------------------------------
// Reading a document
// ---------------------------------------------------------------------------

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The `flags.fusion` bag of a document, or an empty one. */
function fusionFlags(doc: ContactActorDoc): Record<string, unknown> {
  return record(record(doc.flags)["fusion"]);
}

/** True for an Actor subtype that represents a player's character. */
export function isPlayerCharacter(doc: ContactActorDoc): boolean {
  return PLAYER_CHARACTER_SUBTYPES.has(text(doc.type));
}

/** True for an Actor subtype that represents a non-playable character (REQ-CTT-040). */
export function isNonPlayableActor(doc: ContactActorDoc): boolean {
  return NON_PLAYABLE_SUBTYPES.has(text(doc.type));
}

/** `system.masterActorId` of a companion, or `null` when there is no link. */
export function masterActorIdOf(doc: ContactActorDoc): string | null {
  const raw = text(record(doc.system)["masterActorId"]);
  return raw.length > 0 ? raw : null;
}

/** True for a companion Actor: the subtype plus the master link (DEC-CTT-06). */
export function isSubCharacter(doc: ContactActorDoc): boolean {
  return text(doc.type) === COMPANION_ACTOR_SUBTYPE && masterActorIdOf(doc) !== null;
}

/** True when the server delivered this contact as glimpsed (REQ-CTT-041). */
export function isGlimpsedContact(doc: ContactActorDoc): boolean {
  return fusionFlags(doc)["glimpsed"] === true;
}

/** The free title stored on the actor itself, trimmed; `""` when unset. */
export function readContactTitle(doc: ContactActorDoc): string {
  return text(fusionFlags(doc)["title"]).trim();
}

/**
 * The diff that writes a title through the ordinary `doc:update` path.
 *
 * A dot-path key, which `applyDotPathDiff` on the server expands — the same
 * shape every other flag write uses. The server decides whether it is allowed
 * (REQ-CTT-085); this only builds the payload.
 */
export function contactTitleDiff(title: string): Record<string, unknown> {
  return { [CONTACT_TITLE_FLAG_PATH]: title.trim() };
}

/**
 * The system's own identification of a character — "Druida 5" and equivalents.
 *
 * Read from the shape every 2e system already stores (`system.details.class` and
 * `system.details.level`), tolerating both the bare number and the `{ value }`
 * wrapper. Returns `""` when the system declared neither, so the fallback line
 * degrades to nothing rather than to a lie.
 */
export function systemIdentityLine(doc: ContactActorDoc): string {
  const details = record(record(doc.system)["details"]);
  const rawClass = details["class"];
  const className = typeof rawClass === "string" ? rawClass : text(record(rawClass)["name"]);

  const rawLevel = details["level"];
  const level =
    typeof rawLevel === "number"
      ? rawLevel
      : typeof record(rawLevel)["value"] === "number"
        ? (record(rawLevel)["value"] as number)
        : null;

  if (className.length > 0 && level !== null) return `${className} ${String(level)}`;
  if (className.length > 0) return className;
  return level !== null ? String(level) : "";
}

/**
 * The line under the name (REQ-CTT-023): the free title when it is filled, and
 * otherwise the system identification, marked as a fallback so the panel can draw
 * it as the different thing it is.
 */
export function resolveTitleLine(doc: ContactActorDoc): ContactTitleLine {
  const title = readContactTitle(doc);
  if (title.length > 0) return { text: title, kind: "title" };
  return { text: systemIdentityLine(doc), kind: "fallback" };
}

// ---------------------------------------------------------------------------
// Ownership, presence and permission
// ---------------------------------------------------------------------------

/** Whether the viewer holds OWNER over this contact — the same test the server runs. */
export function ownsContact(doc: ContactActorDoc, userId: string): boolean {
  return getUserLevel(doc.ownership ?? {}, userId) >= OwnershipLevel.OWNER;
}

/** Every user id named as an owner of this contact, ignoring the `default` entry. */
export function ownerUserIdsOf(doc: ContactActorDoc): string[] {
  const ownership = doc.ownership ?? {};
  return Object.entries(ownership)
    .filter(([key, level]) => key !== "default" && level >= OwnershipLevel.OWNER)
    .map(([key]) => key);
}

/**
 * Presence of a character: at least one of its owners is connected (REQ-CTT-015).
 * Never a sort key — only a field of the card.
 */
export function isContactPresent(
  doc: ContactActorDoc,
  onlineUserIds: ReadonlySet<string>,
): boolean {
  return ownerUserIdsOf(doc).some((userId) => onlineUserIds.has(userId));
}

/**
 * Who may rewrite the title in the card: a privileged role, or whoever owns the
 * character (REQ-CTT-024). Hiding the control is ergonomics — the server refuses
 * anyone else on its own (REQ-CTT-085, REQ-CTT-080).
 */
export function canEditContactTitle(
  doc: ContactActorDoc,
  userId: string,
  isPrivileged: boolean,
): boolean {
  return isPrivileged || ownsContact(doc, userId);
}

/**
 * Dragging a card onto the canvas to create a token belongs to the GM alone
 * (REQ-CTT-028, DEC-CTT-12) — the player's card is not draggable at all.
 */
export function canDragContactToCanvas(isPrivileged: boolean): boolean {
  return isPrivileged;
}

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

/**
 * The conditions currently on an actor, read from its embedded items — the shape
 * both sheets already read (`items[] { type: "condition", system.slug/value }`).
 */
export function readActiveConditions(doc: ContactActorDoc): ActiveCondition[] {
  const items = doc.items ?? [];
  const actives: ActiveCondition[] = [];
  for (const item of items) {
    if (record(item)["type"] !== "condition") continue;
    const system = record(record(item)["system"]);
    const slug = text(system["slug"]) || text(record(item)["name"]);
    if (slug.length === 0) continue;
    const value = system["value"];
    actives.push(typeof value === "number" ? { slug, value } : { slug });
  }
  return actives;
}

/**
 * The chips of one actor.
 *
 * The declarations the system registered win; where the system declared nothing,
 * the condition item's own name is used as the label, so an undeclared condition
 * still shows up with a readable name instead of disappearing — fail open
 * (REQ-CTT-035).
 */
export function buildContactConditions(
  doc: ContactActorDoc,
  declarations?: ReadonlyMap<string, ConditionDisplayContract>,
): ConditionView[] {
  const actives = readActiveConditions(doc);
  const merged = new Map<string, ConditionDisplayContract>();

  for (const item of doc.items ?? []) {
    if (record(item)["type"] !== "condition") continue;
    const system = record(record(item)["system"]);
    const slug = text(system["slug"]) || text(record(item)["name"]);
    const label = text(record(item)["name"]);
    if (slug.length > 0 && label.length > 0) merged.set(slug, { slug, label });
  }
  if (declarations) {
    for (const [slug, declaration] of declarations) merged.set(slug, declaration);
  }

  return buildConditionViews(actives, merged);
}

// ---------------------------------------------------------------------------
// Search — spec 39 §5.2
// ---------------------------------------------------------------------------

/** Case- and accent-insensitive form used by every comparison in the search. */
function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("pt-BR");
}

/**
 * Whether a contact matches the search box (REQ-CTT-011, REQ-NPC-011): name and
 * title, in the client, with no request to the server (RNF-CTT-02).
 *
 * The haystack carries BOTH the resolved label (`displayName()`, REQ-CMP-055 — what
 * the card actually shows) and the raw `doc.name` (EN-pure, REQ-CMP-055) — so a
 * contact drawn as "Águia" is found by "Águia" as well as by "Eagle", the name
 * whoever knows the source pack would type. Matching only the raw name here while
 * the card renders the resolved one would defeat the very rule that names this
 * search "by name" (REQ-CTT-011/REQ-NPC-011): the name the user reads on screen.
 *
 * A glimpsed contact carries neither (`displayName()` resolves to `""` when there
 * is no `flags.fusion.i18n` entry and no `doc.name` either), so it can never be
 * found by name (REQ-CTT-013) — that falls out of the redacted payload rather than
 * from a rule written here.
 */
export function matchesContactQuery(doc: ContactActorDoc, query: string): boolean {
  const needle = fold(query.trim());
  if (needle.length === 0) return true;
  const haystack = fold(`${displayName(doc)} ${text(doc.name)} ${readContactTitle(doc)}`);
  return haystack.includes(needle);
}

// ---------------------------------------------------------------------------
// Categories — the order of the Conhecidos section (spec 39 §5.2)
// ---------------------------------------------------------------------------

/** One category block of the Conhecidos section, as the panel draws it. */
export interface ContactCategoryGroup<T> {
  /** Category name as the user typed it, or `null` for the "Sem categoria" bucket. */
  readonly name: string | null;
  readonly contacts: readonly T[];
}

/**
 * Put the category blocks in the order the user defined (REQ-CTT-016): their own
 * order first — never alphabetical, never creation order — with "Sem categoria"
 * always last. A category the user did not order keeps its relative position after
 * the ordered ones, so a stale association never drops a contact off the list.
 */
export function orderContactCategories<T>(
  groups: readonly ContactCategoryGroup<T>[],
  userOrder: readonly string[],
): ContactCategoryGroup<T>[] {
  const rank = new Map<string, number>();
  userOrder.forEach((name, index) => {
    if (!rank.has(name)) rank.set(name, index);
  });

  return [...groups]
    .map((group, index) => ({ group, index }))
    .sort((a, b) => {
      const aLast = a.group.name === null;
      const bLast = b.group.name === null;
      if (aLast !== bLast) return aLast ? 1 : -1;
      const aRank = rank.get(a.group.name ?? "") ?? Number.MAX_SAFE_INTEGER;
      const bRank = rank.get(b.group.name ?? "") ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      return a.index - b.index;
    })
    .map(({ group }) => group);
}

/**
 * Drop the blocks a search emptied (REQ-CTT-012). With an empty query nothing is
 * dropped, which is what makes an empty category reappear the moment the field is
 * cleared.
 */
export function visibleContactCategories<T>(
  groups: readonly ContactCategoryGroup<T>[],
  query: string,
): ContactCategoryGroup<T>[] {
  if (query.trim().length === 0) return [...groups];
  return groups.filter((group) => group.contacts.length > 0);
}

// ---------------------------------------------------------------------------
// The "Na mesa" section — spec 39 §5.3
// ---------------------------------------------------------------------------

/** Everything the section needs to be built. */
export interface TableSectionInput {
  /** Every Actor the world mirror holds — filtering is this module's job. */
  readonly actors: readonly ContactActorDoc[];
  readonly userId: string;
  readonly isPrivileged: boolean;
  readonly query?: string;
  /** Ids of the users currently connected (presence, REQ-CTT-015). */
  readonly onlineUserIds?: ReadonlySet<string>;
  /** Condition declarations of the active system (REQ-SYS-043), when available. */
  readonly conditionDeclarations?: ReadonlyMap<string, ConditionDisplayContract>;
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, "pt-BR");
}

function buildSubCard(
  doc: ContactActorDoc,
  declarations: ReadonlyMap<string, ConditionDisplayContract> | undefined,
): SubContactCard {
  const kind = text(record(doc.system)["companionKind"]) || COMPANION_ACTOR_SUBTYPE;
  return {
    id: doc._id,
    name: displayName(doc),
    img: doc.img ?? null,
    kind,
    conditions: buildContactConditions(doc, declarations),
  };
}

/**
 * Build the "Na mesa" section.
 *
 * Order (REQ-CTT-014): the viewer's own characters first, each block sorted with
 * `localeCompare` in pt-BR. Presence is read into the card and deliberately left
 * out of the comparison (REQ-CTT-015).
 *
 * Sub-characters (REQ-CTT-025/026) are attached to the card of their master and
 * never appear as an item of their own; a companion whose master is not in the
 * list is dropped with it — that is what "inherits the owner's visibility" means
 * on a list the server already filtered.
 *
 * The search (REQ-CTT-011) keeps a card whose master or whose sub-character
 * matches, because the sub-character is part of that card and not a row.
 */
export function buildTableSection(input: TableSectionInput): TableSection {
  const query = input.query ?? "";
  const online = input.onlineUserIds ?? new Set<string>();
  const declarations = input.conditionDeclarations;

  const characters = input.actors.filter(isPlayerCharacter);
  const characterIds = new Set(characters.map((doc) => doc._id));

  const subsByMaster = new Map<string, ContactActorDoc[]>();
  for (const doc of input.actors) {
    if (!isSubCharacter(doc)) continue;
    const masterId = masterActorIdOf(doc);
    if (masterId === null || !characterIds.has(masterId)) continue;
    const bucket = subsByMaster.get(masterId);
    if (bucket) bucket.push(doc);
    else subsByMaster.set(masterId, [doc]);
  }

  const mine: ContactCard[] = [];
  const others: ContactCard[] = [];

  for (const doc of characters) {
    const subs = subsByMaster.get(doc._id) ?? [];
    const matched =
      matchesContactQuery(doc, query) || subs.some((sub) => matchesContactQuery(sub, query));
    if (!matched) continue;

    const isMine = ownsContact(doc, input.userId);
    const card: ContactCard = {
      id: doc._id,
      name: displayName(doc),
      img: doc.img ?? null,
      isMine,
      present: isContactPresent(doc, online),
      title: resolveTitleLine(doc),
      canEditTitle: canEditContactTitle(doc, input.userId, input.isPrivileged),
      draggable: canDragContactToCanvas(input.isPrivileged),
      conditions: buildContactConditions(doc, declarations),
      subCharacters: [...subs].map((sub) => buildSubCard(sub, declarations)).sort(byName),
    };
    (isMine ? mine : others).push(card);
  }

  mine.sort(byName);
  others.sort(byName);

  return { mine, others, total: mine.length + others.length };
}

// ---------------------------------------------------------------------------
// The "Conhecidos" section — spec 39 §5.5 and §5.6
// ---------------------------------------------------------------------------

/**
 * How many characters of the table know a contact, and how many have only
 * glimpsed it (REQ-CTT-044).
 *
 * Built only for a privileged role, and only from the knowledge map the server put
 * on the document — a payload without the map (every player's, REQ-CTT-084) yields
 * `null`, so the counts cannot be reconstructed where they must not exist.
 */
export interface ContactKnowledgeCounts {
  /** Characters at `conhecido` (2). */
  readonly known: number;
  /** Characters at `entrevisto` (1) — the ones who saw without identifying. */
  readonly glimpsed: number;
  /** Characters on the table, so the two numbers above have a denominator. */
  readonly characters: number;
}

/**
 * One row of the Conhecidos section.
 *
 * A glimpsed contact is the same shape with everything emptied: `identified` false,
 * no name, no title, no portrait (REQ-CTT-041), and both affordances off
 * (REQ-CTT-042). The panel therefore has one card to draw, and the redaction is a
 * property of the data rather than a branch it might forget.
 */
export interface KnownContactCard {
  readonly id: string;
  /** False when the server delivered this contact as glimpsed (REQ-CTT-041). */
  readonly identified: boolean;
  /** `""` for a glimpsed contact — the payload carries no name at all. */
  readonly name: string;
  readonly img: string | null;
  /** `null` for a glimpsed contact: there is no title to show either. */
  readonly title: ContactTitleLine | null;
  readonly conditions: readonly ConditionView[];
  /** The category the user filed it under, or `null` for "Sem categoria". */
  readonly category: string | null;
  /** The user may file this contact under a category (REQ-CTT-042). */
  readonly canCategorize: boolean;
  /** The sheet may be opened from this card (REQ-CTT-042, REQ-CTT-027). */
  readonly canOpenSheet: boolean;
  /** The card may be dragged onto the canvas (REQ-CTT-028). */
  readonly draggable: boolean;
  /** Privileged-only counts (REQ-CTT-044); `null` for everyone else. */
  readonly knowledge: ContactKnowledgeCounts | null;
}

/** The Conhecidos section: category blocks in the user's order (REQ-CTT-016). */
export interface KnownSection {
  readonly groups: readonly ContactCategoryGroup<KnownContactCard>[];
  /** Contacts drawn in all blocks — the only count the tab has (REQ-CTT-043). */
  readonly total: number;
}

/** Everything the Conhecidos section needs to be built. */
export interface KnownSectionInput {
  /** Every Actor the world mirror holds — filtering is this module's job. */
  readonly actors: readonly ContactActorDoc[];
  readonly isPrivileged: boolean;
  readonly query?: string;
  /** The viewer's own categories (REQ-CTT-055); absent means "none yet". */
  readonly categories?: ContactCategories;
  /** Condition declarations of the active system (REQ-SYS-043), when available. */
  readonly conditionDeclarations?: ReadonlyMap<string, ConditionDisplayContract>;
}

/**
 * Whether an Actor belongs to the Conhecidos section: a NON-PLAYABLE actor
 * ({@link NON_PLAYABLE_SUBTYPES}) that is not a companion of somebody's character
 * (those are drawn inside their owner's card, REQ-CTT-025).
 *
 * The test is an allow-list, not the complement of "is a character": REQ-CTT-040
 * populates the section with "os não-jogadores", and spec 42 §3 says which
 * subtypes those are. A `loot` actor — the chest, DEC-NPC-08 — is neither a
 * character nor a contact, and must appear in no list, no count and no knowledge
 * window; the negative predicate would have filed it under Conhecidos and turned
 * it into a row of the "Quem conhece quem" grid.
 *
 * There is deliberately no state test here. A contact at `oculto` never reaches the
 * client — the server drops it from snapshot, broadcast and replay alike
 * (REQ-CTT-082) — so "what arrived" already **is** "entrevisto or conhecido"
 * (REQ-CTT-040). Re-deriving the state on the client would mean depending on data
 * the client must not have, and would quietly hand the answer to whoever forged a
 * payload.
 */
export function isKnownContact(doc: ContactActorDoc): boolean {
  return isNonPlayableActor(doc) && !isSubCharacter(doc);
}

/**
 * How many characters know and how many have glimpsed this contact (REQ-CTT-044).
 *
 * `null` whenever the map is absent from the payload, which is every non-privileged
 * payload (REQ-CTT-084): the counts reveal what the other players' characters know,
 * so they exist for the Mestre or not at all.
 */
export function contactKnowledgeCounts(
  doc: ContactActorDoc,
  characterIds: readonly string[],
): ContactKnowledgeCounts | null {
  const raw = record(doc.flags)["fusion"];
  if (!(typeof raw === "object" && raw !== null && "knowledge" in raw)) return null;

  const map = readKnowledgeMap(doc);
  let known = 0;
  let glimpsed = 0;
  for (const characterId of characterIds) {
    const state = resolveKnowledgeFromMap(map, characterId);
    if (state === KnowledgeState.Known) known += 1;
    else if (state === KnowledgeState.Glimpsed) glimpsed += 1;
  }
  return { known, glimpsed, characters: characterIds.length };
}

function knownByName(a: KnownContactCard, b: KnownContactCard): number {
  // Unidentified rows carry no name to sort by, so they sink to the bottom of their
  // block in a stable order instead of clustering at the top under an empty string.
  if (a.identified !== b.identified) return a.identified ? -1 : 1;
  if (!a.identified) return a.id.localeCompare(b.id, "pt-BR");
  return a.name.localeCompare(b.name, "pt-BR");
}

/**
 * Build the Conhecidos section (spec 39 §5.5/§5.6).
 *
 * Order: the user's own category order, "Sem categoria" always last, alphabetical
 * with `localeCompare` in pt-BR inside each block (REQ-CTT-016). A named category
 * with no contacts still appears — it is where the user drops the next one — while
 * "Sem categoria" only appears once something is in it (REQ-CTT-053), and a search
 * hides whatever it emptied (REQ-CTT-012).
 */
export function buildKnownSection(input: KnownSectionInput): KnownSection {
  const query = input.query ?? "";
  const categories = input.categories ?? { order: [], assignments: {} };
  const declarations = input.conditionDeclarations;

  const characterIds = input.actors.filter(isPlayerCharacter).map((doc) => doc._id);

  const cards: KnownContactCard[] = [];
  for (const doc of input.actors) {
    if (!isKnownContact(doc)) continue;

    const glimpsed = isGlimpsedContact(doc);
    // A glimpsed contact carries neither name nor title, so it can never be found
    // by the search (REQ-CTT-013) — the filter below is what makes that literal.
    if (!matchesContactQuery(doc, query)) continue;

    const identified = !glimpsed;
    cards.push({
      id: doc._id,
      identified,
      name: identified ? displayName(doc) : "",
      img: identified ? (doc.img ?? null) : null,
      title: identified ? resolveTitleLine(doc) : null,
      conditions: identified ? buildContactConditions(doc, declarations) : [],
      // REQ-CTT-042: a glimpsed contact offers no categorization, so a stale
      // association from before it was hidden cannot file it anywhere either.
      category: identified ? categoryOfContact(categories, doc._id) : null,
      canCategorize: identified,
      canOpenSheet: identified,
      draggable: identified && canDragContactToCanvas(input.isPrivileged),
      knowledge: input.isPrivileged ? contactKnowledgeCounts(doc, characterIds) : null,
    });
  }

  const buckets = new Map<string, KnownContactCard[]>();
  for (const name of categories.order) buckets.set(name, []);
  const uncategorized: KnownContactCard[] = [];
  for (const card of cards) {
    const bucket = card.category === null ? undefined : buckets.get(card.category);
    if (bucket) bucket.push(card);
    else uncategorized.push(card);
  }

  const groups: ContactCategoryGroup<KnownContactCard>[] = [...buckets].map(([name, contacts]) => ({
    name,
    contacts: [...contacts].sort(knownByName),
  }));
  // REQ-CTT-053: "Sem categoria" shows up only when it holds something.
  if (uncategorized.length > 0) {
    groups.push({ name: null, contacts: [...uncategorized].sort(knownByName) });
  }

  return {
    groups: visibleContactCategories(orderContactCategories(groups, categories.order), query),
    total: cards.length,
  };
}
