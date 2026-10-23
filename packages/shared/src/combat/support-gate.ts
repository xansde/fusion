/**
 * support-gate.ts — why the Support (Apoio) of an animal companion is blocked (BHR-F4-10, BHR-F5-04,
 * REQ-PET-121, REQ-BHR-178, DC-07). ONE predicate shared by the server (`effect:apply` refuses) and the
 * sheets (the button is disabled with the same reason), so the two can never disagree.
 *
 * Two rules:
 *   - only the ACTIVE companion supports (`system.companion.active`, absent = active);
 *   - a companion that carries its rider and MOVED this turn cannot Support, unless its type is a `mount`.
 *
 * "This turn" is the combat NAMED by the movement stamp (`flags.fusion.mount.movedTurn.combatId`) at its
 * current round and turn index, whoever the active combatant is: an animal companion acts on its master's
 * turn and is not a combatant (B-1).
 */

type Rec = Record<string, unknown>;

export interface SupportTurnRef {
  combatId: string;
  round: number;
  turn: number;
}

export const SUPPORT_BLOCK_TEXT_PT = {
  inactive:
    "Companheiro inativo: só o companheiro ativo apoia. Use Chamar Companheiro para trocá-lo.",
  afterMove: "A montaria carregando o cavaleiro já se moveu neste turno e não pode Apoiar.",
} as const;

function rec(v: unknown): Rec | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Rec) : null;
}

function readTurnRef(raw: unknown): SupportTurnRef | null {
  const r = rec(raw);
  if (r === null) return null;
  const { combatId, round, turn } = r;
  if (typeof combatId !== "string" || typeof round !== "number" || typeof turn !== "number")
    return null;
  return { combatId, round, turn };
}

/** The reason Support is blocked by the move rule, or null. Pure: rider on it, not a mount, moved THIS turn. */
export function mountSupportBlock(input: {
  carriesRider: boolean;
  isMountType: boolean;
  movedTurn: SupportTurnRef | null;
  current: SupportTurnRef | null;
}): string | null {
  if (!input.carriesRider || input.isMountType) return null;
  const { movedTurn, current } = input;
  if (movedTurn === null || current === null) return null;
  const same =
    movedTurn.combatId === current.combatId &&
    movedTurn.round === current.round &&
    movedTurn.turn === current.turn;
  return same ? SUPPORT_BLOCK_TEXT_PT.afterMove : null;
}

/** Where the (not ended) combat `combatId` is now, or null when it is gone or ended. */
function currentTurnOfCombat(combats: ReadonlyArray<Rec>, combatId: string): SupportTurnRef | null {
  for (const combat of combats) {
    if (combat["_id"] !== combatId || combat["ended"] === true) continue;
    const round = combat["round"];
    const turn = combat["turnIndex"];
    if (typeof round !== "number" || typeof turn !== "number") continue;
    return { combatId, round, turn };
  }
  return null;
}

/** The move-rule reason for ONE companion actor (its tokens in the scenes), or null. */
export function companionMountBlock(input: {
  scenes: ReadonlyArray<Rec>;
  combats: ReadonlyArray<Rec>;
  companion: Rec;
}): string | null {
  const { scenes, combats, companion } = input;
  const actorId = companion["_id"];
  if (typeof actorId !== "string") return null;
  const isMountType =
    rec(rec(rec(companion["system"])?.["derived"])?.["companion"])?.["mount"] === true;
  for (const scene of scenes) {
    const tokens = Array.isArray(scene["tokens"]) ? (scene["tokens"] as Rec[]) : [];
    for (const token of tokens) {
      if (token["actorId"] !== actorId) continue;
      const flag = rec(rec(rec(token["flags"])?.["fusion"])?.["mount"]);
      const riderTokenId = flag?.["riderTokenId"];
      const movedTurn = readTurnRef(flag?.["movedTurn"]);
      const reason = mountSupportBlock({
        carriesRider: typeof riderTokenId === "string" && riderTokenId !== "",
        isMountType,
        movedTurn,
        current: movedTurn === null ? null : currentTurnOfCombat(combats, movedTurn.combatId),
      });
      if (reason !== null) return reason;
    }
  }
  return null;
}

/** Every reason the Support of THIS companion actor is blocked (empty = available). */
export function companionSupportBlockReasons(input: {
  scenes: ReadonlyArray<Rec>;
  combats: ReadonlyArray<Rec>;
  companion: Rec;
}): string[] {
  const reasons: string[] = [];
  if (rec(rec(input.companion["system"])?.["companion"])?.["active"] === false) {
    reasons.push(SUPPORT_BLOCK_TEXT_PT.inactive);
  }
  const mount = companionMountBlock(input);
  if (mount !== null) reasons.push(mount);
  return reasons;
}
