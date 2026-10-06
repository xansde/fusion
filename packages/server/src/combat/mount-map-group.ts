/**
 * Who shares a MAP counter with a combatant (BHR-F5-05, D-B03, REQ-CBT-070..071).
 *
 * Mounted, rider and mount are ONE counter for the multiple attack penalty. The link is
 * `Scene.tokens[].flags.fusion.mount` (written only by `mount:mount` / `mount:dismount`,
 * BHR-F5-02), read live on every call: a dismount takes effect on the very next read, with no
 * event to forget. A flag that is not reciprocal (a token pointing at a token that does not point
 * back, or at one that left the scene) is stale and groups nobody.
 */

import { readMountState } from "@fusion/shared";
import type { DocumentStore } from "../documents/store.js";

type Rec = Record<string, unknown>;

/** What a combatant shares its MAP counter with while mounted. */
export interface MountPeers {
  /** Stable key of the pair (same from either side); what `mapGroupOf` returns. */
  groupKey: string;
  /** Combatants of the pair (the asked one first; the partner only when it is in the combat). */
  combatantIds: string[];
  /** Actors of the pair: their attacks as a non-combatant companion count in the group too. */
  actorIds: string[];
  /** Actor of the partner token (the one that reads the group count through `byActor`). */
  partnerActorId?: string;
}

export interface MountGrouping {
  /** `null` when the combatant is not mounted nor ridden. `combatId` narrows the search. */
  peersOf(combatantId: string, combatId?: string): MountPeers | null;
}

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function tryGet(store: DocumentStore, table: "combats" | "scenes", id: string): Rec | null {
  try {
    return store.get(table, id);
  } catch {
    return null;
  }
}

export function createMountGrouping(store: DocumentStore): MountGrouping {
  const findCombat = (combatantId: string, combatId?: string): Rec | null => {
    if (combatId !== undefined) return tryGet(store, "combats", combatId);
    try {
      for (const c of store.getAll("combats")) {
        if (
          Array.isArray(c["combatants"]) &&
          c["combatants"].some((x) => isRec(x) && x["_id"] === combatantId)
        ) {
          return c;
        }
      }
    } catch {
      return null;
    }
    return null;
  };

  return {
    peersOf(combatantId, combatId) {
      const combat = findCombat(combatantId, combatId);
      if (!combat || !Array.isArray(combat["combatants"])) return null;
      const combatants = (combat["combatants"] as unknown[]).filter(isRec);
      const me = combatants.find((c) => c["_id"] === combatantId);
      const sceneId = combat["sceneId"];
      if (!me || typeof me["tokenId"] !== "string" || typeof sceneId !== "string") return null;
      const scene = tryGet(store, "scenes", sceneId);
      if (!scene || !Array.isArray(scene["tokens"])) return null;
      const tokens = (scene["tokens"] as unknown[]).filter(isRec);

      const myToken = tokens.find((t) => t["_id"] === me["tokenId"]);
      if (!myToken) return null;
      const state = readMountState(myToken);
      const partnerTokenId = state.mountTokenId ?? state.riderTokenId;
      if (partnerTokenId === undefined) return null;
      const partnerToken = tokens.find((t) => t["_id"] === partnerTokenId);
      if (!partnerToken) return null;
      const back = readMountState(partnerToken);
      const reciprocal =
        state.mountTokenId !== undefined
          ? back.riderTokenId === myToken["_id"]
          : back.mountTokenId === myToken["_id"];
      if (!reciprocal) return null;

      const partnerCombatant = combatants.find((c) => c["tokenId"] === partnerTokenId);
      const actorIds = [myToken["actorId"], partnerToken["actorId"]].filter(
        (a): a is string => typeof a === "string" && a !== "",
      );
      return {
        groupKey: `mount:${[String(myToken["_id"]), partnerTokenId].sort().join("+")}`,
        combatantIds: [
          combatantId,
          ...(typeof partnerCombatant?.["_id"] === "string" ? [partnerCombatant["_id"]] : []),
        ],
        actorIds,
        ...(typeof partnerToken["actorId"] === "string" && partnerToken["actorId"] !== ""
          ? { partnerActorId: partnerToken["actorId"] }
          : {}),
      };
    },
  };
}
