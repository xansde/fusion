/**
 * The size limit of an Athletics maneuver, judged by the server (BHR-F6-04 review M-1).
 *
 * PF2e remaster (Player Core, Athletics): Disarm, Grapple, Reposition, Shove and Trip "can't be more than one size
 * larger than you"; Titan Wrestler lifts it to two sizes (three when legendary in Athletics). The sheet already
 * disables the row; this is the part a forged client cannot skip. The rule itself is the engine's
 * (`checkManeuverSize`); this module only reads the facts from the database: the sizes, the limit feats of the
 * roller's actor and its Athletics rank.
 */

import type { Database as Db } from "better-sqlite3";
import {
  SIZE_LIMITED_MANEUVERS,
  checkManeuverSize,
  maneuverSizeLimitsOf,
  parseCreatureSize,
} from "@fusion/engine-2e";
import { readActorSizeCategory, resolveEffectiveActor } from "@fusion/shared";

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readActorDoc(db: Db, actorId: string): Rec | null {
  try {
    const row = db.prepare(`SELECT data FROM actors WHERE id = ?`).get(actorId) as
      | { data: string }
      | undefined;
    if (row === undefined) return null;
    const doc = JSON.parse(row.data) as unknown;
    return isRec(doc) ? doc : null;
  } catch {
    return null;
  }
}

/** The raw token (any scene) with this id. */
function readToken(db: Db, tokenId: string): Rec | null {
  try {
    const rows = db.prepare(`SELECT data FROM scenes`).all() as { data: string }[];
    for (const row of rows) {
      const scene = JSON.parse(row.data) as unknown;
      const tokens = isRec(scene) && Array.isArray(scene["tokens"]) ? scene["tokens"] : [];
      const found = (tokens as unknown[]).find((t) => isRec(t) && t["_id"] === tokenId);
      if (isRec(found)) return found;
    }
  } catch {
    return null;
  }
  return null;
}

function athleticsRank(system: unknown): number | undefined {
  if (!isRec(system)) return undefined;
  const pick = (container: unknown): number | undefined => {
    const stat = isRec(container) ? container["athletics"] : undefined;
    const rank = isRec(stat) ? stat["rank"] : undefined;
    return typeof rank === "number" && Number.isFinite(rank) ? rank : undefined;
  };
  return (
    pick(isRec(system["derived"]) ? system["derived"]["skills"] : undefined) ??
    pick(system["skills"])
  );
}

/** The size of the creature a token stands for: its actor, with the override of an unlinked token applied. */
function tokenSize(token: Rec, actor: Rec): string | undefined {
  const delta = isRec(token["actorDelta"]) ? token["actorDelta"] : null;
  const effective = resolveEffectiveActor(
    {
      actorLink: token["actorLink"] !== false,
      actorDelta: delta,
    },
    { name: "", system: isRec(actor["system"]) ? actor["system"] : {} },
  );
  return readActorSizeCategory(effective.system);
}

/**
 * Why `maneuver` may not be tried on the token, or `null` when it may. Anything the server cannot read (no such
 * actor or token, an unknown size, a maneuver the rule does not limit) is a "may": the rule never refuses on a guess.
 */
export function maneuverSizeRefusal(
  db: Db,
  input: { maneuver: string; rollerActorId: string; targetTokenId: string },
): string | null {
  if (!SIZE_LIMITED_MANEUVERS.includes(input.maneuver)) return null;
  const roller = readActorDoc(db, input.rollerActorId);
  const token = readToken(db, input.targetTokenId);
  const targetActorId =
    token !== null && typeof token["actorId"] === "string" ? token["actorId"] : null;
  const target = targetActorId === null ? null : readActorDoc(db, targetActorId);
  if (roller === null || token === null || target === null) return null;
  const actorSize = parseCreatureSize(readActorSizeCategory(roller["system"]));
  const targetSize = parseCreatureSize(tokenSize(token, target));
  if (actorSize === undefined || targetSize === undefined) return null;
  const check = checkManeuverSize({
    maneuver: input.maneuver,
    actorSize,
    targetSize,
    limits: maneuverSizeLimitsOf(roller["items"]),
    athleticsRank: athleticsRank(roller["system"]),
  });
  return check.ok
    ? null
    : `Maneuver "${input.maneuver}" cannot target a ${check.targetSize} creature: at most ${check.maxSize}`;
}
