/**
 * badges.svelte.ts — the badge contract of the side drawer rail.
 *
 * Spec 36 (`specs/36-gaveta-lateral.md`) §5.3 and DEC-GAV-06. A tab gets **one**
 * badge, of one of two kinds (REQ-GAV-020):
 *
 *  - **counter** — "new things you have not seen": an integer ≥ 1, drawn as
 *    `99+` above 99 (chat unread, future invites);
 *  - **state dot** — "something is happening": a boolean with no number
 *    (combat running, later "it is your turn").
 *
 * What this module is for:
 *  - `formatSidebarBadge` / `readSidebarBadge` — the pure rendering decision the
 *    rail asks for. It takes the value and nothing else, so an open, collapsed or
 *    active drawer literally cannot change what is drawn (REQ-GAV-021);
 *  - `resolveSidebarBadgeTone` / `readSidebarBadgeTone` — how loud a lit dot is
 *    drawn. A dot has two intensities and a counter has none; which one is asked
 *    for is, again, the owning child's call (REQ-CBA-004 is the first caller);
 *  - `createCounterBadge` / `createDotBadge` — reactive stores a child tab owns,
 *    satisfying `SidebarBadgeStore` from `registry.ts` so they can be handed
 *    straight to `registerSidebarTab({ badge })` (REQ-GAV-030).
 *
 * What this module is NOT for, on purpose:
 *  - any rule that lights a badge up or puts it out. The unread rule is the
 *    chat's (REQ-CHT-039, spec 38), the active-combat rule is spec 10's. The
 *    container never writes a badge on open, switch or collapse (REQ-GAV-022,
 *    REQ-GAV-023) — that is what makes these helpers generic;
 *  - anything that blinks, animates or makes a sound: a badge only appears and
 *    disappears (REQ-GAV-024). There is no timer in here.
 *
 * The `.svelte.ts` extension is required, not decorative: `$state` is a compiler
 * rune, so a reactive store cannot live in a plain `.ts` (same reason as
 * `lib/windows/dialogs.svelte.ts`). Importers use `./badges.svelte.js`.
 */

import type { SidebarBadgeStore, SidebarBadgeTone, SidebarBadgeValue } from "./registry.js";

export type { SidebarBadgeTone } from "./registry.js";

// ---------------------------------------------------------------------------
// Formatting (pure)
// ---------------------------------------------------------------------------

/** Highest number drawn as itself; anything above becomes the overflow text. */
export const SIDEBAR_BADGE_MAX_COUNT = 99;

/** What a counter above `SIDEBAR_BADGE_MAX_COUNT` reads as (REQ-GAV-020). */
export const SIDEBAR_BADGE_OVERFLOW_TEXT = "99+";

/** What the rail has to draw: a counter, a state dot, or nothing at all. */
export type SidebarBadgeKind = "counter" | "dot" | "none";

/**
 * The whole drawing instruction. Two fields and no third one: there is no
 * channel here for a blink, an animation or a sound (REQ-GAV-024).
 */
export interface SidebarBadgeDisplay {
  /** Which of the two kinds to draw, or `"none"` when there is nothing. */
  readonly kind: SidebarBadgeKind;
  /** Text inside the badge — only for counters; `null` for a dot or nothing. */
  readonly text: string | null;
}

const NOTHING: SidebarBadgeDisplay = { kind: "none", text: null };
const STATE_DOT: SidebarBadgeDisplay = { kind: "dot", text: null };

/**
 * Turn a badge value into what the rail draws (REQ-GAV-020, REQ-GAV-021).
 *
 * Deliberately a function of the value alone — it receives no drawer state, so
 * the badge of the active tab and the badge of a collapsed drawer are the same
 * badge. Values that make no sense as a badge (0, negative, NaN, `null`) simply
 * draw nothing rather than throwing: a child tab counting down to zero is the
 * normal way a counter goes away.
 */
export function formatSidebarBadge(value: SidebarBadgeValue | undefined): SidebarBadgeDisplay {
  if (typeof value === "boolean") return value ? STATE_DOT : NOTHING;

  if (typeof value === "number") {
    if (Number.isNaN(value)) return NOTHING;
    const count = Number.isFinite(value) ? Math.floor(value) : value;
    if (count < 1) return NOTHING;
    return {
      kind: "counter",
      text: count > SIDEBAR_BADGE_MAX_COUNT ? SIDEBAR_BADGE_OVERFLOW_TEXT : String(count),
    };
  }

  return NOTHING;
}

/** Whether a value draws anything at all (REQ-GAV-021). */
export function isSidebarBadgeVisible(value: SidebarBadgeValue | undefined): boolean {
  return formatSidebarBadge(value).kind !== "none";
}

/** Emphasis of a dot that carries none — the answer for almost every badge. */
export const SIDEBAR_BADGE_DEFAULT_TONE: SidebarBadgeTone = "default";

/**
 * Which emphasis a lit **state dot** is drawn with (REQ-CBA-004).
 *
 * Pure in the value and the declared tone, for the same reason `formatSidebarBadge`
 * is pure in the value alone: an open, collapsed or active drawer cannot change it
 * (REQ-GAV-021, REQ-GAV-022). Two things fall out of that and are deliberate:
 *
 *  - a **counter** never has a tone. A tone is an intensity of the dot, and the two
 *    kinds do not mix (REQ-GAV-020) — asking for one on a number is answered with
 *    the default rather than with a throw;
 *  - a badge that draws nothing has the default tone too, so "amber" can never be
 *    the reason something appears. Appearing is the value's business.
 *
 * Changing tone is a redraw and nothing else: no blink, no animation, no sound
 * (REQ-GAV-024) — there is no timer behind this function.
 */
export function resolveSidebarBadgeTone(
  value: SidebarBadgeValue | undefined,
  tone: SidebarBadgeTone | undefined,
): SidebarBadgeTone {
  if (formatSidebarBadge(value).kind !== "dot") return SIDEBAR_BADGE_DEFAULT_TONE;
  return tone ?? SIDEBAR_BADGE_DEFAULT_TONE;
}

/**
 * The rail's entry point for emphasis: read a tab's optional badge store and decide
 * how loud its dot is. Reading `.tone` here is what registers the reactive
 * dependency, exactly as `readSidebarBadge` does for the value.
 */
export function readSidebarBadgeTone(badge: SidebarBadgeStore | undefined): SidebarBadgeTone {
  return resolveSidebarBadgeTone(badge?.value, badge?.tone);
}

/**
 * The rail's entry point: read a tab's optional badge store and format it.
 *
 * Reading `.value` here is what registers the reactive dependency, so the rail
 * redraws when the owning child moves the store — and only then.
 */
export function readSidebarBadge(badge: SidebarBadgeStore | undefined): SidebarBadgeDisplay {
  return formatSidebarBadge(badge?.value);
}

// ---------------------------------------------------------------------------
// Stores (reactive, owned by the child tab)
// ---------------------------------------------------------------------------

/** Clamp anything a child hands us into a usable count: integer, never negative. */
function normalizeCount(count: number): number {
  if (!Number.isFinite(count)) return count > 0 ? count : 0;
  return Math.max(0, Math.floor(count));
}

/** A counter badge: the child owns the number, the rail only reads it. */
export interface SidebarCounterBadge extends SidebarBadgeStore {
  /** Current count; `0` means the badge is not drawn. */
  readonly value: number;
  /** Set the count outright (e.g. from a server-sent unread total). */
  set(count: number): void;
  /** Add to the count; defaults to one more thing to see. */
  increment(by?: number): void;
  /** Put the badge out — the child's decision, never the container's. */
  clear(): void;
}

/**
 * Create a counter badge to hand to `registerSidebarTab({ badge })`.
 *
 * The store only ever yields a number, which is how "a tab cannot have both
 * kinds" (REQ-GAV-020) is enforced structurally instead of by a check.
 */
export function createCounterBadge(initial = 0): SidebarCounterBadge {
  const state = $state({ count: normalizeCount(initial) });

  return {
    get value(): number {
      return state.count;
    },
    set(count: number): void {
      state.count = normalizeCount(count);
    },
    increment(by = 1): void {
      state.count = normalizeCount(state.count + by);
    },
    clear(): void {
      state.count = 0;
    },
  };
}

/** A state-dot badge: on or off, never a number. */
export interface SidebarDotBadge extends SidebarBadgeStore {
  /** Whether the dot is lit; `false` means the badge is not drawn. */
  readonly value: boolean;
  /** Set the dot outright. */
  set(on: boolean): void;
  /** Light the dot — "something is happening". */
  light(): void;
  /** Put the dot out. */
  clear(): void;
}

/**
 * Create a state-dot badge to hand to `registerSidebarTab({ badge })`.
 *
 * Same structural guarantee as the counter: it only ever yields a boolean.
 */
export function createDotBadge(initial = false): SidebarDotBadge {
  const state = $state({ on: initial });

  return {
    get value(): boolean {
      return state.on;
    },
    set(on: boolean): void {
      state.on = on;
    },
    light(): void {
      state.on = true;
    },
    clear(): void {
      state.on = false;
    },
  };
}
