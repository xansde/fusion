/**
 * speakerColor.ts — deterministic accent color per chat speaker (A022, spec 38).
 *
 * The prototype (chat-tab.prototype.html:410, ~592, ~623-624) paints the author's
 * name and the message's left border with a color keyed to `who` — a fixed
 * per-sender map (`Gamemaster`/`Fofurinha`/`Tobias`) that lets a reader tell who is
 * talking without reading the header on every row. That map only covers the three
 * demo speakers; the real chat has an unbounded set of authors, so `speakerColor`
 * below reproduces the same visual idea with a pure hash instead of a lookup
 * table: the sender's identity picks a slot in a fixed accent palette, so the
 * SAME sender always gets the SAME color even with nothing else to go on.
 *
 * But REQ-CHT-008 (`09-chat-e-mensagens.md`) asks OOC text messages for "borda na
 * cor do jogador" — literally the user's own world color, REQ-USR-002
 * (`05-usuarios-e-permissoes.md`): the SAME `color` field already painted on that
 * user's live cursor, ruler and map pings (REQ-CNV-039/062, REQ-NET-041), edited
 * in Settings (`UsersSection.svelte`) and carried to every client by presence
 * (`OnlineUser.color`, `lib/presence/types.ts`). A hash that ignores it invents a
 * SECOND color for a person who already has one — the Mestre paints a player
 * green in Settings, the header shows green, and that player's name in chat
 * comes out some unrelated hue. `resolveSpeakerColor` is the entry point callers
 * should use: it resolves the real per-user color first and only falls back to
 * the hash when the id can't be resolved (offline/unknown sender). `speakerColor`
 * stays exported as that pure, table-free fallback — never called directly by UI
 * code that has a user directory in hand.
 *
 * "Same sender" (for the hash fallback) mirrors chatGrouping.ts's own definition
 * for REQ-ACH-025 — the pair (userId, alias): the Gamemaster voicing two
 * different NPCs is two different senders on screen, exactly like a run of
 * consecutive messages never groups across that boundary (see
 * canGroupWithPrevious). speakerColorKey exists so callers never re-derive that
 * pairing on their own. Once a sender resolves to a real user color, that
 * color applies regardless of alias — REQ-USR-002 fixes ONE color per user, not
 * one per (user, alias); the hash's per-alias split only survives as the
 * fallback for senders no user record can be found for.
 *
 * No Svelte, no DOM, no CSS custom properties — the app has no light/dark theme
 * toggle today (base.css defines a single dark palette), so the fixed HSL
 * lightness below is picked for legibility against that dark surface only
 * (--fusion-bg / --fusion-surface). If a light theme is ever added, this palette
 * needs its own light-mode lightness — tracked as an open question, not solved
 * here (see A022 report).
 *
 * DEC-ACH-02 (fixed search bar) and DEC-ACH-03 (full-width write box) shape the
 * chrome this message renders inside but do not touch color; they are cited here
 * only because the task that added this module ("Cobre: DEC-ACH-02/03,
 * REQ-ACH-025") names them alongside REQ-ACH-025.
 */

/** Number of distinct accent slots in the palette. */
const PALETTE_SIZE = 8;
/** Fixed saturation/lightness — legible on the dark --fusion-bg/--fusion-surface. */
const SATURATION_PCT = 72;
const LIGHTNESS_PCT = 64;
const HUE_STEP_DEG = 360 / PALETTE_SIZE;

/**
 * FNV-1a, 32-bit. Small, dependency-free, and stable across platforms/engines —
 * unlike relying on some ad-hoc string hashing, this has no reliance on
 * insertion order, iteration order, or any built-in that differs between
 * runtimes. Pure function: same string in, same number out, forever.
 */
function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The identity key chatGrouping.ts treats as "the same author" (REQ-ACH-025):
 * the (userId, alias) pair, joined the same way every other per-world-and-user
 * storage key in this codebase is (see lib/sidebar/preferences.ts,
 * lib/settings/clientPrefs.ts): a colon-joined string, cheap to build and cheap
 * to hash.
 */
export function speakerColorKey(speaker: {
  readonly userId: string;
  readonly alias: string;
}): string {
  return `${speaker.userId}:${speaker.alias}`;
}

/** Which of the PALETTE_SIZE accent slots a given identity key falls into. */
export function speakerColorIndex(key: string): number {
  return fnv1aHash(key) % PALETTE_SIZE;
}

/**
 * A CSS color for the given identity key — an `hsl()` string at a fixed
 * saturation/lightness, spanning PALETTE_SIZE evenly-spaced hues. Deterministic:
 * the same key always resolves to the same string.
 */
export function speakerColor(key: string): string {
  const hue = speakerColorIndex(key) * HUE_STEP_DEG;
  return `hsl(${String(hue)}, ${String(SATURATION_PCT)}%, ${String(LIGHTNESS_PCT)}%)`;
}

/** Exported for tests that want to assert against the palette's shape, not a magic number. */
export const SPEAKER_COLOR_PALETTE_SIZE = PALETTE_SIZE;

/**
 * The shape this module needs from whatever user directory the client has —
 * mirrors the narrow-interface pattern `invalidationDisplay.ts`'s `NamedUser`
 * uses for the same reason: this module must not grow a dependency on
 * `lib/presence/types.ts` just to read one field back out of it.
 */
export interface ColoredUser {
  readonly userId: string;
  readonly color: string;
}

/**
 * The color to paint for a given speaker: the user's own world-assigned color
 * (REQ-USR-002) when `users` has a record for `speaker.userId`, so the SAME
 * person reads as the SAME color everywhere in the app (cursor, ruler, pings,
 * chat — REQ-CHT-008). Falls back to the deterministic hash (`speakerColor`)
 * only when the id resolves to nobody — an offline sender, a user removed from
 * the world, or a test fixture with no directory at all. This is the function
 * UI code with a user list in hand should call; `speakerColor`/`speakerColorKey`
 * stay available underneath as the pure, table-free primitives this builds on.
 */
export function resolveSpeakerColor(
  speaker: { readonly userId: string; readonly alias: string },
  users: readonly ColoredUser[],
): string {
  const known = users.find((user) => user.userId === speaker.userId);
  if (known) return known.color;
  return speakerColor(speakerColorKey(speaker));
}
