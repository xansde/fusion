/**
 * favoriteDice.ts — the three favourite dice of the chat tab.
 *
 * Spec 38 (`specs/38-aba-chat.md`), DEC-ACH-05 and REQ-ACH-050..057.
 *
 * A favourite is a **shortcut, not a macro** (REQ-ACH-057): label + formula text + mode,
 * and nothing else. No Document, no ownership, no hotbar, no script — clicking one turns
 * into a `/roll <formula>` chat line and the server decides everything that matters.
 * That is the whole reason it can live on the device: there is nothing here another user
 * could be granted, and nothing the world would miss if the browser were wiped.
 *
 * Where it lives (REQ-ACH-053)
 * ----------------------------
 * `localStorage`, keyed by the world's **identity** and the user's id — the same shape the
 * drawer uses (`lib/sidebar/preferences.ts`, REQ-GAV-014). Two consequences that are the
 * point of the rule: a browser shared by the GM and a player keeps two independent entries,
 * and swapping a LAN address for a tunnel keeps the favourites, because the key never
 * contained the address.
 *
 * What the formula may contain (REQ-ACH-054)
 * ------------------------------------------
 * In the MVP, dice and numbers only. A reference to an attribute — `@abilities.str.mod` or
 * a bare name like `Força` — is [V2] (REQ-ACH-056) and is refused **here**, with a reason
 * the UI can put in front of the user, instead of travelling to the server to come back as
 * a parse error nobody can act on.
 *
 * Q-ACH-04, decided here: an invalid favourite is **disabled with the reason**, never a
 * button that fails when clicked. RNF-ACH-01 says firing a favourite must roll with no
 * dialog; a click that quietly does nothing (or needs an error surface of its own) breaks
 * that promise, and the row would be lying about what it can do. Disabled + reason states
 * the problem before the click and points at the editor that fixes it.
 *
 * Pure and storage-only on purpose: no socket, no DOM, no runes. The tray, the roll builder
 * and the favourites editor all go through here, so they cannot disagree about what a
 * favourite is.
 */

import { validateFormulaWithLimits } from "@fusion/shared";

import type { RollMode } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

/**
 * One favourite die.
 *
 * `mode: null` means "follows the selector" — the default state (REQ-ACH-052). A non-null
 * mode is **locked**, and beats the selector for that roll (REQ-ACH-044); only a command
 * that names the mode beats a locked favourite (`lib/chat/resolveRollMode.ts`).
 */
export interface FavoriteDie {
  /** Short name drawn on the button (REQ-ACH-051). */
  readonly label: string;
  /** Roll formula in text, dice and numbers only in the MVP (REQ-ACH-054). */
  readonly formula: string;
  /** Locked roll mode, or `null` for "follows the selector" (REQ-ACH-052). */
  readonly mode: RollMode | null;
}

/** The row shows three favourites and a fourth button for the builder (REQ-ACH-050). */
export const FAVORITE_SLOT_COUNT = 3;

/** Cap on the drawn label, so one long name cannot squeeze the other two out of the row. */
export const MAX_FAVORITE_LABEL_LENGTH = 24;

/** The four roll modes (DEC-CHT-02). Anything else in storage is corrupt. */
const VALID_MODES: ReadonlySet<string> = new Set(["public", "gmroll", "blindroll", "selfroll"]);

/**
 * What a device starts with. Deliberately language-free — the formula IS the label, so the
 * first three buttons need no translation and no assumption about the game system.
 */
export const DEFAULT_FAVORITE_DICE: readonly FavoriteDie[] = Object.freeze([
  Object.freeze({ label: "1d20", formula: "1d20", mode: null }),
  Object.freeze({ label: "1d6", formula: "1d6", mode: null }),
  Object.freeze({ label: "1d100", formula: "1d100", mode: null }),
]);

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function asMode(value: unknown): RollMode | null {
  return typeof value === "string" && VALID_MODES.has(value) ? (value as RollMode) : null;
}

/**
 * Coerce anything into a well-formed favourite: trimmed formula, trimmed and capped label
 * (falling back to the formula when blank), and a mode that is either locked on one of the
 * four or `null` (REQ-ACH-051, REQ-ACH-052).
 *
 * Used on both ends — what the editor writes and what storage returns — so a hand-edited
 * `localStorage` entry cannot put a shape the row cannot draw into the tray.
 */
export function normalizeFavorite(input: {
  label?: unknown;
  formula?: unknown;
  mode?: unknown;
}): FavoriteDie {
  const formula = typeof input.formula === "string" ? input.formula.trim() : "";
  const rawLabel = typeof input.label === "string" ? input.label.trim() : "";
  const label = (rawLabel.length > 0 ? rawLabel : formula).slice(0, MAX_FAVORITE_LABEL_LENGTH);
  return { label, formula, mode: asMode(input.mode) };
}

/** The chat line a favourite becomes when fired (REQ-ACH-051, REQ-ACH-057). */
export function favoriteRollContent(favorite: FavoriteDie): string {
  return `/roll ${favorite.formula.trim()}`;
}

// ---------------------------------------------------------------------------
// Formula purity — REQ-ACH-054
// ---------------------------------------------------------------------------

/** Why a favourite's formula cannot be fired. */
export type FavoriteFormulaProblem = "empty" | "attribute" | "syntax";

/** Verdict of {@link checkFavoriteFormula} — pure data, so the UI owns the wording. */
export interface FavoriteFormulaCheck {
  readonly valid: boolean;
  /** Absent when valid. */
  readonly problem?: FavoriteFormulaProblem;
  /** The offending attribute reference, when there is one to point at. */
  readonly token?: string;
  /** The parser's own message, for the syntax case. */
  readonly detail?: string;
}

/**
 * Words the dice notation itself uses (REQ-ROL-001..013) plus the maths functions the
 * roller accepts. Anything else spelled with letters is a name — i.e. an attribute, which
 * the MVP does not resolve (REQ-ACH-054, REQ-ACH-056 is [V2]).
 *
 * Matching is done on maximal letter runs, so `4d6kh3` yields `d` and `kh`, and
 * `1d20 + Força` yields `d` and `Força`.
 */
const NOTATION_WORDS: ReadonlySet<string> = new Set([
  // dice and dice kinds
  "d",
  "df",
  "dc",
  "c",
  // keep / drop
  "k",
  "kh",
  "kl",
  "dh",
  "dl",
  // reroll, explode, bounds
  "r",
  "ro",
  "rr",
  "x",
  "xo",
  "min",
  "max",
  // successes / failures / margin
  "cs",
  "cf",
  "sf",
  "ms",
  "even",
  "odd",
  // maths functions
  "abs",
  "ceil",
  "cos",
  "exp",
  "floor",
  "log",
  "pow",
  "round",
  "sign",
  "sin",
  "sqrt",
  "tan",
]);

/** Everything a letter run may hide behind: `# note` (REQ-ROL-013) and `[label]` (REQ-ROL-012). */
function stripFreeText(formula: string): string {
  const noNote = formula.split("#", 1)[0] ?? "";
  return noNote.replace(/\[[^\]]*\]/g, " ");
}

/**
 * Is this formula fireable as a favourite in the MVP (REQ-ACH-054)?
 *
 * Order matters: the attribute check runs BEFORE the parser, because `1d20 + Força` is
 * also a syntax error to the parser, and "you cannot use attributes yet" is the answer the
 * user can act on — "Expected ( or - or abs…" is not.
 */
export function checkFavoriteFormula(formula: string): FavoriteFormulaCheck {
  const trimmed = formula.trim();
  if (trimmed.length === 0) return { valid: false, problem: "empty" };

  const scanned = stripFreeText(trimmed);

  const atRef = /@[\p{L}\w.]*/u.exec(scanned);
  if (atRef !== null) return { valid: false, problem: "attribute", token: atRef[0] };

  for (const match of scanned.matchAll(/[\p{L}_][\p{L}_]*/gu)) {
    const word = match[0];
    if (!NOTATION_WORDS.has(word.toLowerCase())) {
      return { valid: false, problem: "attribute", token: word };
    }
  }

  const parsed = validateFormulaWithLimits(trimmed);
  if (!parsed.valid) {
    const check: FavoriteFormulaCheck = {
      valid: false,
      problem: "syntax",
      detail: parsed.error ?? "",
    };
    return check;
  }

  return { valid: true };
}

/** i18n key of a problem, so message wording stays in the bundles and out of this module. */
export function favoriteProblemI18nKey(problem: FavoriteFormulaProblem): string {
  switch (problem) {
    case "empty":
      return "FUSION.Chat.Favorites.Invalid.Empty";
    case "attribute":
      return "FUSION.Chat.Favorites.Invalid.Attribute";
    case "syntax":
      return "FUSION.Chat.Favorites.Invalid.Syntax";
  }
}

// ---------------------------------------------------------------------------
// Storage — REQ-ACH-053
// ---------------------------------------------------------------------------

/** Key prefix, following the `fusion:<thing>` convention used across the client. */
export const FAVORITE_DICE_KEY_PREFIX = "fusion:diceFavorites";

/**
 * Storage key of one user's favourites in one world (REQ-ACH-053).
 *
 * `worldId` is `session.worldInfo.id` — the world's identity, never `location.host`.
 */
export function favoriteDiceKey(worldId: string, userId: string): string {
  return `${FAVORITE_DICE_KEY_PREFIX}:${worldId}:${userId}`;
}

function hasIdentity(worldId: string, userId: string): boolean {
  return worldId.length > 0 && userId.length > 0;
}

/** Pad or truncate to the three slots the row draws (REQ-ACH-050). */
function toSlots(list: readonly FavoriteDie[]): FavoriteDie[] {
  const slots: FavoriteDie[] = [];
  for (let i = 0; i < FAVORITE_SLOT_COUNT; i += 1) {
    const found = list[i];
    slots.push(found ?? { ...(DEFAULT_FAVORITE_DICE[i] as FavoriteDie) });
  }
  return slots;
}

/**
 * The favourites of this user in this world, always exactly three.
 *
 * Anything unusable — never saved, storage unavailable, corrupt JSON, a slot of the wrong
 * shape — resolves to the default for that slot. A broken entry costs one button, never the
 * row (and never a thrown error inside a component's mount).
 */
export function loadFavoriteDice(worldId: string, userId: string): FavoriteDie[] {
  if (!hasIdentity(worldId, userId)) return toSlots(DEFAULT_FAVORITE_DICE);

  try {
    if (typeof localStorage === "undefined") return toSlots(DEFAULT_FAVORITE_DICE);
    const stored = localStorage.getItem(favoriteDiceKey(worldId, userId));
    if (stored === null) return toSlots(DEFAULT_FAVORITE_DICE);

    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return toSlots(DEFAULT_FAVORITE_DICE);

    const list: FavoriteDie[] = [];
    for (let i = 0; i < FAVORITE_SLOT_COUNT; i += 1) {
      const entry: unknown = parsed[i];
      if (typeof entry !== "object" || entry === null) {
        list.push({ ...(DEFAULT_FAVORITE_DICE[i] as FavoriteDie) });
        continue;
      }
      const favorite = normalizeFavorite(entry);
      list.push(
        favorite.formula.length > 0 ? favorite : { ...(DEFAULT_FAVORITE_DICE[i] as FavoriteDie) },
      );
    }
    return list;
  } catch {
    /* localStorage unavailable (private mode, disabled, node tests) or unparseable. */
    return toSlots(DEFAULT_FAVORITE_DICE);
  }
}

// ---------------------------------------------------------------------------
// Change notification
// ---------------------------------------------------------------------------

type FavoriteListener = (worldId: string, userId: string) => void;

const listeners = new Set<FavoriteListener>();

/**
 * Be told when this device's favourites changed (REQ-ACH-055).
 *
 * The editor and the builder live in floating windows, outside the drawer, so the row has
 * no parent in common with them to hand a callback down. Returns the unsubscribe.
 */
export function subscribeFavoriteDice(listener: FavoriteListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Persist this user's favourites in this world (REQ-ACH-053).
 *
 * Client-only: the value never travels to the server and no other user's entry is touched.
 * Failures are swallowed (private mode, quota, storage disabled) — but subscribers are told
 * either way, so the row always shows what the editor just accepted.
 */
export function saveFavoriteDice(
  worldId: string,
  userId: string,
  favorites: readonly FavoriteDie[],
): void {
  if (!hasIdentity(worldId, userId)) return;

  const slots = toSlots(favorites.map((f) => normalizeFavorite(f)));
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(favoriteDiceKey(worldId, userId), JSON.stringify(slots));
    }
  } catch {
    /* ignore */
  }
  for (const listener of listeners) listener(worldId, userId);
}

/** Drop this user's favourites in this world; the defaults come back. */
export function clearFavoriteDice(worldId: string, userId: string): void {
  if (!hasIdentity(worldId, userId)) return;
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(favoriteDiceKey(worldId, userId));
    }
  } catch {
    /* ignore */
  }
  for (const listener of listeners) listener(worldId, userId);
}
