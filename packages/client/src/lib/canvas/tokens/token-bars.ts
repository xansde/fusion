/**
 * token-bars.ts — the token resource bar, as pure PIXI-free logic.
 *
 * Spec: `06-canvas-e-renderizacao.md`
 *   - REQ-CNV-089: `displayBars` carries one of the five canonical levels and
 *     defaults to `observer`.
 *   - REQ-CNV-090: the bar reflects the REAL value of the attribute the token
 *     points at; the fraction is clamped to [0,1]; the bar is ABSENT when the
 *     path does not resolve, when the token has no actor, or when `max <= 0` —
 *     never drawn full as a placeholder.
 *   - REQ-CNV-091: "the token's actor" is the EFFECTIVE one — base Actor plus
 *     `Token.actorDelta` for an unlinked token (REQ-DOC-033), rebuilt with the
 *     shared function the server also routes through, never a second copy.
 *   - DEC-CNV-15: the `observer` cut is OBSERVER(2)+ over the token's Actor
 *     (a token has no ownership of its own); a privileged role satisfies it
 *     always; only `never` hides the bar from the GM too.
 *
 * It lives beside `token-visuals.ts` instead of inside it because that module
 * is geometry, colour and animation — the bar asks a different question (what
 * does this actor hold, and may this viewer see it) and needs the ownership
 * ladder, which nothing else in `token-visuals.ts` does.
 *
 * The SECURITY boundary is not here. The server does not emit an Actor to a
 * user who may not see it (REQ-NET-096); this module decides what the client
 * DRAWS with data it legitimately holds. A wrong answer here is a bar that is
 * missing or shown to a teammate, not a leak.
 */

import { OwnershipLevel, effectiveTokenActor } from "@fusion/shared";
import type { ActorDelta, TokenDisplayMode, TokenDocument } from "@fusion/shared";
import { readResourceAt } from "../../actors/actorResource.js";
import { barFraction } from "./token-visuals.js";

// ---------------------------------------------------------------------------
// Display modes (REQ-CNV-089 / REQ-CNV-031)
// ---------------------------------------------------------------------------

/**
 * The five canonical levels, in ladder order (most private → most public).
 * The token config select renders them in this order.
 */
export const TOKEN_DISPLAY_MODES = [
  "never",
  "observer",
  "hoverObserver",
  "hoverAll",
  "always",
] as const satisfies readonly TokenDisplayMode[];

/** REQ-CNV-089: the default when a token does not say otherwise. */
export const DEFAULT_TOKEN_DISPLAY_MODE: TokenDisplayMode = "observer";

const MODE_SET: ReadonlySet<string> = new Set<string>(TOKEN_DISPLAY_MODES);

/**
 * Read `displayBars` off a token, defensively.
 *
 * The TS type declares the field as always present (Zod default), but scenes
 * persisted before REQ-CNV-089 existed carry tokens without the key at all —
 * the server's `SceneSchema.tokens` is a loose record on update, so nothing
 * back-fills them. Reading it raw would hand `undefined` to the switch below.
 * This is the same runtime-absence risk that made `grid` vanish from every
 * scene for rounds (see `docs/lessons.md`).
 */
export function tokenDisplayBars(doc: TokenDocument): TokenDisplayMode {
  const raw: unknown = (doc as Record<string, unknown>)["displayBars"];
  return typeof raw === "string" && MODE_SET.has(raw)
    ? (raw as TokenDisplayMode)
    : DEFAULT_TOKEN_DISPLAY_MODE;
}

// ---------------------------------------------------------------------------
// Value resolution (REQ-CNV-090)
// ---------------------------------------------------------------------------

/** What the sprite needs to paint one bar. */
export interface TokenBarReading {
  readonly value: number;
  readonly max: number;
  /** `value / max`, clamped to [0,1]. */
  readonly fraction: number;
}

/**
 * The derivation pipeline writes its results under `system.derived.*`, using
 * `system.attributes.*` as input (see `characterSheetVM` / `npcSheetVM`, which
 * both read derived-first). A bar configured as `attributes.hp` therefore has a
 * more truthful twin at `derived.hp` whenever the pipeline has run — showing
 * 12/40 for a character who really has 12/55 is a WRONG bar, not a stale one,
 * so the derived block wins when it resolves.
 */
const RAW_PREFIX = "attributes.";
const DERIVED_PREFIX = "derived.";

function derivedAliasFor(path: string): string | null {
  return path.startsWith(RAW_PREFIX) ? DERIVED_PREFIX + path.slice(RAW_PREFIX.length) : null;
}

/**
 * Resources whose maximum is a RULE, not a stored field. Hero points cap at 3
 * in PF2e Remaster no matter what the document carries — `characterSheetVM`
 * already defaults exactly this way — so a `{ value: 2 }` block (or none at
 * all) is a 2/3 (or 0/3) bar, not an absent one. The focus pool is the
 * counter-example and is deliberately NOT here: its max is derived per
 * character and 0 means "no pool", so inventing one would draw a wrong bar.
 */
const RULE_SUPPLIED_MAX: ReadonlyMap<string, number> = new Map([["resources.heroPoints", 3]]);

/**
 * Read a rule-capped resource: stored numbers win, the rule fills the gaps.
 * Returns `null` for paths that have no rule-supplied max.
 */
function readRuleCappedResource(
  system: unknown,
  path: string,
): { value: number; max: number } | null {
  const ruleMax = RULE_SUPPLIED_MAX.get(path);
  if (ruleMax === undefined) return null;

  let cursor: unknown = system;
  for (const segment of path.split(".")) {
    if (typeof cursor !== "object" || cursor === null) {
      cursor = undefined;
      break;
    }
    const record = cursor as Record<string, unknown>;
    cursor = Object.hasOwn(record, segment) ? record[segment] : undefined;
  }

  const leaf =
    typeof cursor === "object" && cursor !== null ? (cursor as Record<string, unknown>) : null;
  const value = typeof leaf?.["value"] === "number" ? (leaf["value"]) : 0;
  const max = typeof leaf?.["max"] === "number" ? (leaf["max"]) : ruleMax;
  return { value, max };
}

/**
 * Resolve what a bar should show for a token, given the `system` blob of its
 * effective actor and the configured attribute path.
 *
 * Returns `null` (bar ABSENT — REQ-CNV-090) when the bar is unconfigured, when
 * there is no actor system, when the path does not resolve, when the value is
 * not numeric, or when `max <= 0`. Never a full bar as a placeholder.
 */
export function resolveTokenBarValue(
  system: unknown,
  attribute: string | null | undefined,
): TokenBarReading | null {
  if (typeof attribute !== "string" || attribute.trim() === "") return null;
  const path = attribute.trim();

  const alias = derivedAliasFor(path);
  const pair =
    (alias === null ? null : readResourceAt(system, alias)) ??
    readResourceAt(system, path) ??
    readRuleCappedResource(system, path);
  if (!pair) return null;
  if (pair.max <= 0) return null;

  return { value: pair.value, max: pair.max, fraction: barFraction(pair.value, pair.max) };
}

// ---------------------------------------------------------------------------
// Visibility decision (REQ-CNV-089 / DEC-CNV-15)
// ---------------------------------------------------------------------------

/** Everything the decision depends on — no document, no PIXI, no session. */
export interface BarVisibilityQuery {
  /** The token's `displayBars` level. */
  readonly mode: TokenDisplayMode;
  /** The viewer's effective ownership level over the token's ACTOR. */
  readonly level: number;
  /** Whether the viewer holds a privileged role (GM / Assistant). */
  readonly privileged: boolean;
  /** Whether the pointer is currently over this token. */
  readonly hovered: boolean;
}

/**
 * DEC-CNV-15: reading a companion's HP is OBSERVER, not OWNER — OWNER is the
 * right to EDIT the sheet, and gating on it would empty both this bar and the
 * Comitiva panel for every ally.
 */
const OBSERVER_CUT: number = OwnershipLevel.OBSERVER;

function meetsOwnershipCut(q: BarVisibilityQuery): boolean {
  return q.privileged || q.level >= OBSERVER_CUT;
}

/**
 * What a token's Actor looks like from ONE viewer's chair.
 *
 * `system` is deliberately `unknown`: the blob is system-specific (PF2e, SF2e,
 * Etmos) and this layer only walks a dotted path through it.
 */
export interface TokenActorView {
  /** The Actor's `system` blob, as the mirror holds it. */
  readonly system: unknown;
  /** The viewer's effective ownership level over that Actor. */
  readonly level: number;
}

/**
 * The token fields that decide WHICH actor a token plays with — REQ-DOC-031.
 *
 * Structural (not `TokenDocument`) so a caller holding a raw mirror record can
 * pass it, and declared with the two link fields OPTIONAL because a scene
 * persisted before this feature carries neither at runtime: the TS type says
 * Zod filled the defaults, the wire says otherwise. Absent `actorLink` reads as
 * linked, which is the only value that leaves those tokens behaving as before.
 */
export interface TokenActorRef {
  readonly actorId: string | null;
  readonly actorLink?: boolean | undefined;
  readonly actorDelta?: ActorDelta | null | undefined;
}

/**
 * The sprite's window onto actor data. Injected instead of imported so that
 * `TokenSprite` stays free of the DocumentMirror (and testable in Node):
 * `TokenLayer` builds the real one over the mirror, tests hand in a literal.
 *
 * `resolve` takes the TOKEN, not its `actorId`, because for an unlinked token
 * (REQ-DOC-033) the actor is not a document anyone can look up — it is the base
 * Actor with that token's own `actorDelta` merged over it. Six skeletons of one
 * Actor share one `actorId` and differ only in the delta, so an `actorId` is no
 * longer enough to answer "what does THIS token hold".
 *
 * Returns `null` when the token has no actor, or when the viewer has no such
 * Actor in their mirror at all — which, per REQ-NET-096, is exactly what the
 * server produces for a user who may not see it.
 */
export interface TokenBarContext {
  /** Whether the viewer holds a privileged role (GM / Assistant). */
  readonly privileged: boolean;
  resolve(token: TokenActorRef): TokenActorView | null;
}

/**
 * The `system` blob the bars must read for this token — base Actor for a linked
 * token, the reconstructed TokenActor for an unlinked one (REQ-DOC-032/033).
 *
 * A one-line wrapper on purpose: the merge itself is `effectiveTokenActor` in
 * `@fusion/shared`, the SAME function the server routes mutations through. A
 * second implementation here would be two different actors on one token, which
 * is the failure this codebase has already paid for with `grid`.
 */
export function effectiveActorSystem(
  token: TokenActorRef,
  baseActor: Record<string, unknown> | null | undefined,
): unknown {
  return effectiveTokenActor(token, baseActor)?.["system"];
}

/**
 * A comparable fingerprint of "which actor is this token playing with".
 *
 * `TokenSprite.update()` decides whether to repaint from a closed list of
 * fields, and an unlinked token's hit points arrive INSIDE that token document
 * — no Actor op is emitted at all. Without the delta in that list the bar of a
 * damaged skeleton renders once and then freezes, with nothing to point at it.
 *
 * Serialising is acceptable here and reference equality is not: the mirror
 * hands out a fresh object on every scene op, so `!==` would repaint every bar
 * on every token move. Key ORDER is not normalised — two orderings of the same
 * delta produce different strings and one redundant repaint, which costs two
 * rectangles. The error that must never happen is the opposite one (a changed
 * delta reading as unchanged), and stringification cannot produce it.
 */
export function tokenActorFingerprint(token: TokenActorRef): string {
  if (token.actorLink !== false) return `linked:${token.actorId ?? ""}`;
  return `unlinked:${token.actorId ?? ""}:${JSON.stringify(token.actorDelta ?? {})}`;
}

/** Decide whether this viewer sees this token's bars right now. */
export function shouldShowTokenBars(q: BarVisibilityQuery): boolean {
  switch (q.mode) {
    case "never":
      // The one level that hides from the GM too (DEC-CNV-15).
      return false;
    case "observer":
      return meetsOwnershipCut(q);
    case "hoverObserver":
      return q.hovered && meetsOwnershipCut(q);
    case "hoverAll":
      return q.hovered;
    case "always":
      return true;
  }
}
