/**
 * turn.ts — whose turn the status strip says it is, and when it offers "Encerrar turno"
 * (BAR-F1-04; spec 53 REQ-BAR-035, REQ-BAR-040, Q-BAR-08; spec 40 REQ-CBA-072/081/082).
 *
 * Pure: a combat document and three facts about the viewer go in, a small description comes out.
 * The strip answers Q-CBA-01 ("de quem é a vez", outside the drawer) with the combat tab's own data
 * and the same wording: the viewer's own turn, the turn of another participant, "Fora de combate" —
 * and a participant the viewer may not see is NEVER revealed (REQ-CBA-082).
 *
 * That last rule has two layers, on purpose. The server masks `activeCombatantId` to `null` for a
 * non-privileged viewer when the participant on the clock is hidden, so the normal case needs no
 * code here beyond not inventing a name. And if a hidden participant ever did reach a player's copy
 * (a leak), the `hidden` flag on it is honoured here too — the combat panel does the same
 * ("defense in depth", `redactCombatForViewer`).
 *
 * "Encerrar turno" is convenience, not protection: the server decides who may advance a turn
 * (REQ-CBA-080/081), so hiding the button proves nothing and showing it grants nothing.
 */

/** The part of a combat document this module reads (a structural subset of `CombatDocument`). */
export interface TurnCombat {
  readonly started: boolean;
  readonly ended: boolean;
  readonly round: number;
  readonly activeCombatantId: string | null;
  readonly combatants: ReadonlyArray<{
    readonly _id: string;
    readonly actorId: string | null;
    readonly name: string;
    readonly hidden: boolean;
  }>;
}

/** What the strip says about the turn. */
export type TurnView =
  /** No encounter in progress ("Fora de combate"). */
  | { kind: "out" }
  /** The participant on the clock is the viewer's ("Seu turno · Rodada N"). */
  | { kind: "mine"; round: number }
  /** It is the turn of the actor this bar draws — the Mestre looking at the NPC on the clock. */
  | { kind: "actor"; name: string; round: number }
  /** The turn of another participant the viewer may see ("Vez de: X"). */
  | { kind: "other"; name: string }
  /** An encounter is running but whose turn it is is not the viewer's to read ("Em combate"). */
  | { kind: "running"; round: number };

/** Whether an encounter is in progress: begun and not ended (a montagem is not "em combate"). */
export function inEncounter(combat: Pick<TurnCombat, "started" | "ended"> | null): boolean {
  return combat !== null && combat.started && !combat.ended;
}

export interface TurnInput {
  combat: TurnCombat | null;
  /** The participant on the clock belongs to the viewer (`activeCombatantIsOwnedBy`). */
  isMyTurn: boolean;
  /** The actor the bar is drawn for. */
  actorId: string;
  /** The privileged seat (`ctx.viewer.isGm`). */
  viewerIsGm: boolean;
}

export function turnView(input: TurnInput): TurnView {
  const { combat } = input;
  if (combat === null || !inEncounter(combat)) return { kind: "out" };
  if (input.isMyTurn) return { kind: "mine", round: combat.round };

  const activeId = combat.activeCombatantId;
  const active =
    activeId === null
      ? undefined
      : combat.combatants.find((candidate) => candidate._id === activeId);
  // Masked by the server, not in the (redacted) list, or hidden and not the viewer's to see.
  if (active === undefined || (active.hidden && !input.viewerIsGm)) {
    return { kind: "running", round: combat.round };
  }

  return active.actorId === input.actorId
    ? { kind: "actor", name: active.name, round: combat.round }
    : { kind: "other", name: active.name };
}

export interface EndTurnInput {
  combat: Pick<TurnCombat, "started" | "ended"> | null;
  isMyTurn: boolean;
  viewerIsGm: boolean;
}

/**
 * Whether "Encerrar turno" is offered (REQ-BAR-035, Q-BAR-08): never outside an encounter in
 * progress; for a player only on their own turn; for the privileged seat on any turn.
 */
export function endTurnAvailable(input: EndTurnInput): boolean {
  if (!inEncounter(input.combat)) return false;
  return input.viewerIsGm || input.isMyTurn;
}
