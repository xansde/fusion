/**
 * TargetSelection — the server's single source of truth for a user's LIVE
 * target selection, and for the "photo" a roll message freezes it into.
 *
 * Spec: 10-combate-e-iniciativa.md REQ-CBT-056; plan §2.3 (ALQ-F1-05).
 *
 * `resolveTargetSelection(store, targetingStore, userId)` reads the live
 * selection from `TargetingStore` (ephemeral, REQ-CBT-053..055) and resolves
 * each tokenId's `actorId`/`sceneId` by scanning every Scene document's
 * embedded `tokens[]` — there is no dedicated tokens table (DEC-PER-02), so a
 * token is only ever found by scanning scenes, mirroring
 * `chat-handler.ts::findTokenById`. A tokenId that does not resolve to a real
 * token anywhere (stale id, or the token was deleted) is silently dropped: it
 * cannot carry a meaningful `sceneId`, so it would not be a valid
 * ApplyDamage/ApplyCondition target either.
 *
 * `chat-handler.ts` calls this once per roll message and copies the result
 * into `flags.fusion.targetSnapshot` — a COPY (D-02/DEC-CBT-10): once
 * persisted, that array never changes again, regardless of what the live
 * selection does afterwards (further `combat:target`, the REQ-CBT-055
 * turnEnd cleanup, or the token being removed from its scene).
 *
 * `assertTargetsSelected(store, targetingStore, userId, role, tokenIds)` is
 * the live-selection gate `actor:applyCondition` uses (REQ-SYS-142): a
 * privileged role (GM/assistant) always passes — targeting is a player
 * convenience, never a restriction on the GM. A non-privileged caller must
 * currently be targeting EVERY id in `tokenIds`; anything else is reported in
 * `missing` so the caller can return FORBIDDEN.
 */

import type { DocumentStore } from "../documents/store.js";
import { isRolePrivileged } from "../documents/ownership.js";
import type { UserRole } from "../documents/ownership.js";
import type { TargetingStore } from "./targeting-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One resolved target, as recorded on `flags.fusion.targetSnapshot` (plan §2.3). */
export interface ResolvedTarget {
  tokenId: string;
  actorId: string | null;
  sceneId: string;
}

export interface AssertTargetsOk {
  ok: true;
}

export interface AssertTargetsForbidden {
  ok: false;
  code: "FORBIDDEN";
  missing: string[];
}

export type AssertTargetsResult = AssertTargetsOk | AssertTargetsForbidden;

// ---------------------------------------------------------------------------
// Token lookup — tokens live embedded in Scene.tokens[], not their own table.
// ---------------------------------------------------------------------------

/**
 * Locate a tokenId across every Scene's embedded `tokens[]`.
 * Returns null when no scene has a token with that id (dangling/foreign id).
 */
function locateToken(
  store: DocumentStore,
  tokenId: string,
): { actorId: string | null; sceneId: string } | null {
  const scenes = store.getAll("scenes");
  for (const scene of scenes) {
    const tokens = scene["tokens"];
    if (!Array.isArray(tokens)) continue;
    for (const raw of tokens as Record<string, unknown>[]) {
      if (raw["_id"] !== tokenId) continue;
      const sceneId = scene["_id"];
      if (typeof sceneId !== "string") continue;
      const actorId = typeof raw["actorId"] === "string" ? raw["actorId"] : null;
      return { actorId, sceneId };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// resolveTargetSelection
// ---------------------------------------------------------------------------

/**
 * Resolve `userId`'s CURRENT live target selection into the shape the chat
 * snapshot, ApplyDamage and ApplyCondition all consume. `[]` when the user has
 * no live targets — REQ-CBT-056 requires the empty case to still be recorded
 * on the chat message (never omitted).
 */
export function resolveTargetSelection(
  store: DocumentStore,
  targetingStore: TargetingStore,
  userId: string,
): ResolvedTarget[] {
  const tokenIds = targetingStore.getTargetsForUser(userId);
  const result: ResolvedTarget[] = [];
  for (const tokenId of tokenIds) {
    const loc = locateToken(store, tokenId);
    if (!loc) continue;
    result.push({ tokenId, actorId: loc.actorId, sceneId: loc.sceneId });
  }
  return result;
}

// ---------------------------------------------------------------------------
// assertTargetsSelected
// ---------------------------------------------------------------------------

/**
 * Live-selection gate for `actor:applyCondition` (REQ-SYS-142): a privileged
 * caller (GM/assistant) always passes — GM can target any actor regardless of
 * canvas selection. A non-privileged caller must currently be targeting every
 * id in `tokenIds`; anything not in their live selection comes back in
 * `missing` under a FORBIDDEN result.
 */
export function assertTargetsSelected(
  store: DocumentStore,
  targetingStore: TargetingStore,
  userId: string,
  role: UserRole,
  tokenIds: readonly string[],
): AssertTargetsResult {
  if (isRolePrivileged(role)) return { ok: true };

  const selected = new Set(
    resolveTargetSelection(store, targetingStore, userId).map((t) => t.tokenId),
  );
  const missing = tokenIds.filter((id) => !selected.has(id));
  if (missing.length > 0) {
    return { ok: false, code: "FORBIDDEN", missing };
  }
  return { ok: true };
}
