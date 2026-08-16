/**
 * categories.ts — the user's own categories of contacts (spec 39 §5.6, DEC-CTT-08).
 *
 * Categories are curation, not world data: each user creates, renames, deletes,
 * reorders and fills **his own**, nobody sees or administers anybody else's
 * (REQ-CTT-056), and none of it ever reaches the server (REQ-CTT-055). They live in
 * `localStorage` under a key that carries both the world and the user, the same
 * boundary `lib/sidebar/preferences.ts` already uses for the drawer (DEC-UIF-10).
 *
 * Two shapes make the rules fall out instead of being enforced by hand:
 *
 *  - the association is a map **contact → category**, so a contact cannot sit in
 *    two categories at once and moving is the only operation there is
 *    (REQ-CTT-051);
 *  - the "Sem categoria" bucket is `null`, not a stored category, so it cannot be
 *    renamed, deleted or reordered, and deleting a real category simply drops the
 *    associations that pointed at it — no actor is touched by anything in this file
 *    (REQ-CTT-052, REQ-CTT-053).
 *
 * Every mutation is pure: it returns a new value and never writes. Persistence is
 * the caller's second step, which keeps the whole rule set testable without a DOM.
 */

// ---------------------------------------------------------------------------
// The value
// ---------------------------------------------------------------------------

/** The bucket a contact falls into when it belongs to no category (REQ-CTT-053). */
export const UNCATEGORIZED: null = null;

/** One user's categories in one world. */
export interface ContactCategories {
  /**
   * The categories in the order the user put them (REQ-CTT-054) — never
   * alphabetical, never creation order once he has dragged anything.
   */
  readonly order: readonly string[];
  /** contact id → category name. A contact absent from here is uncategorized. */
  readonly assignments: Readonly<Record<string, string>>;
}

/** Key prefix, following the `fusion:<thing>` convention used across the client. */
export const CONTACT_CATEGORIES_KEY_PREFIX = "fusion:contactCategories";

/**
 * Storage key of one user's categories in one world (REQ-CTT-055/056).
 *
 * Both ids are part of the key: a device shared by two players keeps two
 * independent sets, and neither can read the other's — the isolation is the key,
 * not a check a bug could skip.
 */
export function contactCategoriesKey(worldId: string, userId: string): string {
  return `${CONTACT_CATEGORIES_KEY_PREFIX}:${worldId}:${userId}`;
}

/** A user who never created a category. */
export function emptyContactCategories(): ContactCategories {
  return { order: [], assignments: {} };
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** The stored form of a name the user typed. */
export function normalizeCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** Case- and accent-insensitive form, used only to compare two names. */
function fold(name: string): string {
  return normalizeCategoryName(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-BR");
}

/** Whether the set already holds this name, ignoring case and accents. */
export function hasCategory(state: ContactCategories, name: string): boolean {
  const needle = fold(name);
  return state.order.some((existing) => fold(existing) === needle);
}

// ---------------------------------------------------------------------------
// Mutations — pure, each returning a new value
// ---------------------------------------------------------------------------

/**
 * Add a category at the end of the user's order (REQ-CTT-050).
 *
 * An empty name and a name that already exists are refused by returning the value
 * unchanged: creating a second "Aliados" would give the user two blocks he cannot
 * tell apart.
 */
export function createCategory(state: ContactCategories, name: string): ContactCategories {
  const clean = normalizeCategoryName(name);
  if (clean.length === 0 || hasCategory(state, clean)) return state;
  return { order: [...state.order, clean], assignments: { ...state.assignments } };
}

/**
 * Rename a category in place, carrying its contacts with it (REQ-CTT-050).
 *
 * The position in the user's order is preserved — renaming is not a reason to move
 * a block. Renaming onto an existing name is refused, for the same reason creating
 * a duplicate is.
 */
export function renameCategory(
  state: ContactCategories,
  from: string,
  to: string,
): ContactCategories {
  const clean = normalizeCategoryName(to);
  if (clean.length === 0 || !hasCategory(state, from)) return state;
  if (fold(from) !== fold(clean) && hasCategory(state, clean)) return state;

  const order = state.order.map((name) => (fold(name) === fold(from) ? clean : name));
  const assignments: Record<string, string> = {};
  for (const [contactId, category] of Object.entries(state.assignments)) {
    assignments[contactId] = fold(category) === fold(from) ? clean : category;
  }
  return { order, assignments };
}

/**
 * Delete a category (REQ-CTT-052).
 *
 * Its contacts go back to "Sem categoria" — the associations that named it are
 * dropped, and that is all that happens. No actor is deleted, or even read, by this
 * module: a category is a label the user put on top of the world, never the world.
 */
export function deleteCategory(state: ContactCategories, name: string): ContactCategories {
  if (!hasCategory(state, name)) return state;
  const order = state.order.filter((existing) => fold(existing) !== fold(name));
  const assignments: Record<string, string> = {};
  for (const [contactId, category] of Object.entries(state.assignments)) {
    if (fold(category) !== fold(name)) assignments[contactId] = category;
  }
  return { order, assignments };
}

/**
 * Put a contact in a category, or take it out of every category with `null`
 * (REQ-CTT-051).
 *
 * Moving to another category removes it from the previous one by construction: the
 * association is a single value, so there is nowhere for a second one to live.
 * Naming a category that does not exist is refused rather than silently creating
 * it, so a stale id cannot conjure a block.
 */
export function assignContactToCategory(
  state: ContactCategories,
  contactId: string,
  category: string | null,
): ContactCategories {
  if (contactId.length === 0) return state;

  if (category === null) {
    if (!(contactId in state.assignments)) return state;
    const assignments = Object.fromEntries(
      Object.entries(state.assignments).filter(([id]) => id !== contactId),
    );
    return { order: [...state.order], assignments };
  }

  if (!hasCategory(state, category)) return state;
  const assignments = { ...state.assignments };
  const stored = state.order.find((name) => fold(name) === fold(category)) ?? category;
  assignments[contactId] = stored;
  return { order: [...state.order], assignments };
}

/**
 * Move a category to another position in the user's order (REQ-CTT-054).
 *
 * The index is clamped instead of refused, so "move up" on the first block is a
 * no-op rather than an error the caller has to guard.
 */
export function moveCategory(
  state: ContactCategories,
  name: string,
  targetIndex: number,
): ContactCategories {
  const current = state.order.findIndex((existing) => fold(existing) === fold(name));
  if (current === -1) return state;

  const bounded = Math.max(0, Math.min(state.order.length - 1, Math.trunc(targetIndex)));
  if (bounded === current) return state;

  const order = [...state.order];
  const [moved] = order.splice(current, 1);
  if (moved === undefined) return state;
  order.splice(bounded, 0, moved);
  return { order, assignments: { ...state.assignments } };
}

/** The category of a contact, or `null` when it is uncategorized. */
export function categoryOfContact(state: ContactCategories, contactId: string): string | null {
  return state.assignments[contactId] ?? null;
}

// ---------------------------------------------------------------------------
// Storage — client only, per world and user (REQ-CTT-055)
// ---------------------------------------------------------------------------

function hasIdentity(worldId: string, userId: string): boolean {
  return worldId.length > 0 && userId.length > 0;
}

function readStored(raw: unknown): ContactCategories {
  if (typeof raw !== "object" || raw === null) return emptyContactCategories();
  const value = raw as Record<string, unknown>;

  const order: string[] = [];
  const rawOrder = value["order"];
  if (Array.isArray(rawOrder)) {
    for (const entry of rawOrder) {
      if (typeof entry !== "string") continue;
      const clean = normalizeCategoryName(entry);
      if (clean.length === 0) continue;
      if (order.some((existing) => fold(existing) === fold(clean))) continue;
      order.push(clean);
    }
  }

  const assignments: Record<string, string> = {};
  const rawAssignments = value["assignments"];
  if (typeof rawAssignments === "object" && rawAssignments !== null) {
    for (const [contactId, category] of Object.entries(rawAssignments as Record<string, unknown>)) {
      if (typeof category !== "string") continue;
      const stored = order.find((name) => fold(name) === fold(category));
      // An association pointing at a category that no longer exists is dropped, not
      // resurrected: the contact simply shows up under "Sem categoria".
      if (stored !== undefined) assignments[contactId] = stored;
    }
  }

  return { order, assignments };
}

/**
 * Read this user's categories in this world. A user who never created one, storage
 * that is unavailable and a corrupt entry all give the same empty value — the panel
 * has one case to draw, not three.
 */
export function loadContactCategories(worldId: string, userId: string): ContactCategories {
  if (!hasIdentity(worldId, userId)) return emptyContactCategories();
  try {
    if (typeof localStorage === "undefined") return emptyContactCategories();
    const raw = localStorage.getItem(contactCategoriesKey(worldId, userId));
    if (raw === null) return emptyContactCategories();
    return readStored(JSON.parse(raw));
  } catch {
    /* storage unavailable or unparseable — treat as "no categories". */
    return emptyContactCategories();
  }
}

/**
 * Persist this user's categories in this world (REQ-CTT-054/055). Never sent to the
 * server, and no other user's entry is touched. Failures are swallowed (private
 * mode, quota, storage disabled): losing the curation is not worth breaking the tab.
 */
export function saveContactCategories(
  worldId: string,
  userId: string,
  value: ContactCategories,
): void {
  if (!hasIdentity(worldId, userId)) return;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      contactCategoriesKey(worldId, userId),
      JSON.stringify({ order: value.order, assignments: value.assignments }),
    );
  } catch {
    /* ignore */
  }
}

/** Drop this user's categories in this world. */
export function clearContactCategories(worldId: string, userId: string): void {
  if (!hasIdentity(worldId, userId)) return;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(contactCategoriesKey(worldId, userId));
  } catch {
    /* ignore */
  }
}
