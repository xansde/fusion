/**
 * combatant-name.ts — what a combatant is called when its token has no name of its own.
 *
 * It inherits the actor's name (spec 41, REQ-TOK-060). An actor brought from a compendium keeps its
 * EN name but carries the pt-BR label the import snapshotted (`flags.fusion.i18n["pt-BR"].name`,
 * REQ-CMP-055); that is the name every other surface of the app shows ("Águia"), so the combat
 * lists it too instead of "Eagle". An `actorDelta` that renames this token's actor wins over both.
 */
export function inheritedCombatantName(
  actor: Record<string, unknown>,
  actorDeltaName: string | undefined,
): string {
  if (typeof actorDeltaName === "string" && actorDeltaName !== "") return actorDeltaName;
  const fusion = (
    actor["flags"] as { fusion?: { i18n?: Record<string, { name?: unknown }> } } | undefined
  )?.fusion;
  const snapshot = fusion?.i18n?.["pt-BR"]?.name;
  if (typeof snapshot === "string" && snapshot !== "") return snapshot;
  return typeof actor["name"] === "string" ? actor["name"] : "";
}
