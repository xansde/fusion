/**
 * tokenActor.ts — the client half of "this token has its own copy of the actor".
 *
 * Spec: `02-modelo-de-dados.md`
 *   - REQ-DOC-031/032: a token names a base `Actor` and either IS it (linked)
 *     or owns a private difference from it (unlinked).
 *   - REQ-DOC-033: that difference is `Token.actorDelta`, a merge patch; the
 *     effective actor is rebuilt in memory, never stored as an Actor row.
 *   - REQ-DOC-034: a mutation of an unlinked token's actor is `token:updateActor`
 *     — the SERVER decides whether it lands on the world Actor or on the delta.
 * Spec: `06-canvas-e-renderizacao.md`
 *   - REQ-CNV-094 / DEC-CNV-16: a sheet opened FROM a token shows that token's
 *     actor, is keyed by the token, and REFUSES the edits a merge patch cannot
 *     represent instead of writing them through to every sibling token.
 *
 * Pure TS, no Svelte, no PIXI — safe for Vitest.
 *
 * Two jobs, both of which exist because a sheet opened from a token cannot keep
 * addressing the Actor by id:
 *
 *   READ  — `subscribeEffectiveActorDoc` feeds a sheet the reconstructed actor
 *           and keeps it live against BOTH collections, because an unlinked
 *           token's hit points change inside the Scene and a linked one's change
 *           inside the Actor.
 *   WRITE — `routeSheetOp` rewrites the sheet's `doc:update` into the op that
 *           names the token. Not doing this is not a cosmetic bug: six skeletons
 *           share one Actor, so an unrouted write damages all six.
 *
 * The reconstruction itself is NOT here. It is `effectiveTokenActor` in
 * `@fusion/shared`, the same function the server routes mutations through.
 */

import { effectiveTokenActor, isDeltaSafeDiff } from "@fusion/shared";

// ---------------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------------

/**
 * "This sheet belongs to THAT token" — everything a caller needs to address an
 * unlinked token's actor.
 *
 * `linked` is the client's current reading of `Token.actorLink`, used only to
 * choose a route; the server re-reads it and remains the authority, so a stale
 * value here costs a rejected op, never a write to the wrong document.
 */
export interface TokenActorBinding {
  readonly sceneId: string;
  readonly tokenId: string;
  readonly actorId: string;
  readonly linked: boolean;
}

/** The token fields a binding is built from. Structural, so a raw record fits. */
export interface TokenActorLinkSource {
  readonly _id?: string;
  readonly actorId?: string | null | undefined;
  readonly actorLink?: boolean | undefined;
}

/**
 * Read `actorLink` off a token, defensively — REQ-DOC-031.
 *
 * The TS type declares the field as always present (Zod fills the default on
 * read), but a scene persisted before this feature carries tokens without the
 * key at all, and the server's `SceneSchema.tokens` is a loose record on update
 * so nothing back-fills them. Absent reads as LINKED: the only value that
 * leaves every already-persisted token behaving exactly as it did. This is the
 * same runtime-absence trap that made `grid` vanish from every scene for rounds
 * (see `docs/lessons.md`).
 */
export function tokenActorLink(token: TokenActorLinkSource): boolean {
  return token.actorLink !== false;
}

/**
 * Build the binding for a token, or `null` when there is no actor to bind to.
 *
 * A token without `actorId` is scenery: no sheet, no hit points, nothing for a
 * delta to be a difference FROM.
 */
export function tokenActorBindingFor(
  sceneId: string,
  token: TokenActorLinkSource,
): TokenActorBinding | null {
  const actorId = token.actorId;
  const tokenId = token._id;
  if (!actorId || !tokenId) return null;
  return { sceneId, tokenId, actorId, linked: tokenActorLink(token) };
}

/** The flat `token:updateActor` op, in the shape every sheet VM emits. */
export interface TokenUpdateActorOp {
  readonly type: "token:updateActor";
  readonly sceneId: string;
  readonly tokenId: string;
  readonly diff: Record<string, unknown>;
}

/**
 * Build the op that mutates the actor OF A TOKEN (REQ-DOC-034).
 *
 * Flat (`{ type, ...fields }`) because that is what `makeSendOpFn` splits into
 * `{ type, payload }`; the payload keys match `TokenUpdateActorPayloadSchema`.
 */
export function buildTokenUpdateActorOp(
  binding: Pick<TokenActorBinding, "sceneId" | "tokenId">,
  diff: Record<string, unknown>,
): TokenUpdateActorOp {
  return {
    type: "token:updateActor",
    sceneId: binding.sceneId,
    tokenId: binding.tokenId,
    diff,
  };
}

// The WRITE of `actorLink` itself is NOT here. It rides the token config
// dialog's ordinary Save (`tokenConfigForm.buildTokenConfigPatch` →
// `tokenController.updateToken`, REQ-CNV-093), because a token's link is a
// token field like its name — a second dedicated setter would be a second
// wire shape for the same write, and the dialog has already been burnt once
// by exactly that (it saved to a shape the server rejects, silently).

// ---------------------------------------------------------------------------
// Write routing (REQ-DOC-034)
// ---------------------------------------------------------------------------

/**
 * Which edits a delta can hold is decided in `@fusion/shared`, by the SAME
 * predicate the server refuses with. Re-exported (not re-implemented) so a
 * future loosening cannot land on one side only — a client that sends what the
 * server rejects produces a button that silently does nothing, and a server
 * that accepts what the client refuses produces the corruption this predicate
 * exists to prevent.
 */
export { isDeltaSafeDiff };

/** What `routeSheetOp` decided to do with one op. */
export type TokenActorRouting =
  /** Send it as it is — it does not touch this token's actor. */
  | { readonly kind: "passthrough"; readonly op: unknown }
  /** Send this instead — it names the token, so the server can pick the target. */
  | { readonly kind: "routed"; readonly op: TokenUpdateActorOp }
  /** Send NOTHING — obeying would have written through to every other token. */
  | { readonly kind: "refused"; readonly reason: string };

interface FlatDocUpdateOp {
  readonly type: string;
  readonly documentType?: unknown;
  readonly id?: unknown;
  readonly diff?: unknown;
}

/**
 * Decide where a sheet's op should go when the sheet was opened from a token.
 *
 * Passthrough covers everything that is not a write to THIS actor: rolls,
 * chat, writes to some other document. A roll still resolves against the base
 * Actor server-side — see the module note in the spec change; that is a known
 * gap, not an accident of this function.
 *
 * A LINKED token passes through untouched, which is exactly today's behaviour:
 * the world Actor IS its actor, `doc:update` already addresses it correctly,
 * and routing it would only add a hop.
 */
export function routeSheetOp(op: unknown, binding: TokenActorBinding): TokenActorRouting {
  if (op === null || typeof op !== "object") return { kind: "passthrough", op };

  const candidate = op as FlatDocUpdateOp;
  if (candidate.type !== "doc:update") return { kind: "passthrough", op };
  if (candidate.documentType !== "Actor") return { kind: "passthrough", op };
  if (candidate.id !== binding.actorId) return { kind: "passthrough", op };
  if (binding.linked) return { kind: "passthrough", op };

  const diff = candidate.diff;
  if (diff === null || typeof diff !== "object" || Array.isArray(diff)) {
    return { kind: "refused", reason: "doc:update without a diff object" };
  }

  const record = diff as Record<string, unknown>;
  if (!isDeltaSafeDiff(record)) {
    return {
      kind: "refused",
      reason:
        "this edit touches items/effects/ownership, which an unlinked token cannot hold on its own yet (REQ-DOC-035)",
    };
  }

  return { kind: "routed", op: buildTokenUpdateActorOp(binding, record) };
}

/**
 * Wrap a sheet's `sendOpFn` so its writes reach the right document.
 *
 * Refusals are dropped with a console warning rather than sent: sending them
 * would silently damage every other token of the same Actor, and there is no
 * "partly correct" version of that.
 */
export function makeTokenActorSendOpFn(
  inner: (op: unknown) => void,
  binding: TokenActorBinding,
): (op: unknown) => void {
  return (op) => {
    const decision = routeSheetOp(op, binding);
    if (decision.kind === "refused") {
      console.warn(`[tokenActor] op refused for token ${binding.tokenId}: ${decision.reason}`, op);
      return;
    }
    inner(decision.op);
  };
}

// ---------------------------------------------------------------------------
// Read: the live effective actor (REQ-DOC-032/033)
// ---------------------------------------------------------------------------

/** The slice of DocumentMirror this module reads. Structural, so tests can fake it. */
export interface EffectiveActorMirror {
  // Type parameters mirror DocumentMirror's own signatures so the real mirror
  // satisfies this shape.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  subscribe<T>(type: string, cb: (docs: T[]) => void): () => void;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  getDoc<T>(type: string, id: string): T | undefined;
}

interface SceneLike {
  readonly _id?: unknown;
  readonly tokens?: unknown;
}

function findToken(
  mirror: EffectiveActorMirror,
  sceneId: string,
  tokenId: string,
): Record<string, unknown> | null {
  const scene = mirror.getDoc<SceneLike>("Scene", sceneId);
  const tokens = scene?.tokens;
  if (!Array.isArray(tokens)) return null;
  const found = (tokens as Record<string, unknown>[]).find((t) => t["_id"] === tokenId);
  return found ?? null;
}

/**
 * Read the actor a sheet should display, right now.
 *
 * Returns `null` when the base Actor is not in this viewer's mirror (the normal
 * shape of an NPC they may not see) or when the bound token has vanished from
 * the scene — a sheet is better closed than showing a token that is no longer
 * on the map.
 */
export function readEffectiveActorDoc(
  mirror: EffectiveActorMirror,
  actorId: string,
  binding: TokenActorBinding | null,
): Record<string, unknown> | null {
  const base = mirror.getDoc<Record<string, unknown>>("Actor", actorId);
  if (!base) return null;
  if (!binding) return base;

  const token = findToken(mirror, binding.sceneId, binding.tokenId);
  if (!token) return null;
  return effectiveTokenActor(token, base);
}

/**
 * Keep a sheet's document live.
 *
 * Subscribes to BOTH collections when a token is bound, and that is the whole
 * point: a linked token's hit points change on the Actor and emit no scene op,
 * an unlinked token's change inside the Scene and emit no Actor op. Watching
 * one of the two produces a sheet that is correct exactly half the time — and
 * frozen, with no error, the other half.
 *
 * Fires once immediately so the caller never renders an empty first frame.
 * Returns an unsubscribe that releases both subscriptions.
 */
export function subscribeEffectiveActorDoc(
  mirror: EffectiveActorMirror,
  actorId: string,
  binding: TokenActorBinding | null,
  onDoc: (doc: Record<string, unknown>) => void,
): () => void {
  const push = (): void => {
    const doc = readEffectiveActorDoc(mirror, actorId, binding);
    if (doc) onDoc(doc);
  };

  const unsubActor = mirror.subscribe<unknown>("Actor", push);
  const unsubScene = binding ? mirror.subscribe<unknown>("Scene", push) : null;

  push();

  return () => {
    unsubActor();
    unsubScene?.();
  };
}
