/**
 * Actor attitude, server side — who may write it, and onto what (spec 42 §5.5).
 *
 * The value itself and its storage path live in `@fusion/shared`
 * (`flags.fusion.attitude`). What this module owns is the pair of rules the
 * server has to enforce and the client cannot be trusted with:
 *
 *   1. WHO writes it — REQ-NPC-080 names `isRolePrivileged` for "alterar
 *      atitude", and the generic `doc:update` authorizes on `ownership`. A
 *      player who owns an actor would otherwise be able to declare that actor
 *      friendly to the party, which is the GM's line to write.
 *   2. WHAT may carry it — REQ-NPC-037 / CA-NPC-010: a hazard has no attitude,
 *      and there is no way to give it one. A refusal here is what makes "nada é
 *      exibido" a property of the data rather than of the panel that draws it.
 *
 * The subtype allow-list is hand-mirrored here for the same reason
 * `NON_PLAYABLE_SUBTYPES` in ./knowledge.ts is: the server package must not
 * import a system package (arch boundary), and each system names its own
 * non-playable Actor — pf2e/sf2e say `npc` and `hazard`.
 */

import {
  isActorAttitude,
  readAttitudeFlagValue,
  ATTITUDE_FLAG_NAMESPACE,
  ATTITUDE_FLAG_KEY,
} from "@fusion/shared";

/**
 * The Actor subtypes that may carry an attitude (REQ-NPC-037).
 *
 * A strict subset of `NON_PLAYABLE_SUBTYPES`: `hazard` is a non-playable that
 * has no attitude (DEC-NPC-09, CA-NPC-010). A player character has none either
 * — attitude is a stance TOWARDS the party, and the party is not its own
 * stranger.
 */
export const ATTITUDE_CAPABLE_SUBTYPES: ReadonlySet<string> = new Set(["npc"]);

/** True for an Actor document whose subtype may hold an attitude. */
export function actorAcceptsAttitude(doc: Record<string, unknown>): boolean {
  const type = doc["type"];
  return typeof type === "string" && ATTITUDE_CAPABLE_SUBTYPES.has(type);
}

/** Why an attitude write was refused, or `null` when it is acceptable. */
export type AttitudeWriteRejection =
  | { kind: "not-privileged" }
  | { kind: "not-applicable"; type: string }
  | { kind: "invalid-value"; value: unknown };

/**
 * Judge an attitude write carried by an expanded `doc:update` diff.
 *
 * `existing` is the stored document the diff is being applied to — the subtype
 * is read from the SERVER's copy, never from the patch, so a forged
 * `{type: "npc"}` riding on the same diff cannot buy an attitude for a hazard.
 *
 * `null` (or a JSON null) is an accepted value: it is how an attitude is
 * cleared, and REQ-NPC-037 makes carrying none a legal state.
 */
export function rejectAttitudeWrite(
  expandedDiff: Record<string, unknown>,
  privileged: boolean,
  existing: Record<string, unknown> | undefined,
): AttitudeWriteRejection | null {
  if (!privileged) return { kind: "not-privileged" };

  const value = readAttitudeFlagValue(expandedDiff);
  if (value !== null && value !== undefined && !isActorAttitude(value)) {
    return { kind: "invalid-value", value };
  }

  // Clearing an attitude is allowed on anything: a document that should never
  // have carried one is exactly the document that should be able to drop it.
  if (value === null || value === undefined) return null;

  if (existing && !actorAcceptsAttitude(existing)) {
    const type = existing["type"];
    return { kind: "not-applicable", type: typeof type === "string" ? type : "unknown" };
  }
  return null;
}

/**
 * Sanitize an attitude arriving on a `doc:create` payload.
 *
 * REQ-NPC-047 lets the GM choose the initial attitude at creation, so a
 * privileged creator keeps a valid value. Everyone else loses it: the only
 * Actor a player may create is their own companion (r17-P1), and letting the
 * create path author a field `doc:update` refuses would be the door left open
 * beside the one just locked. A value on a subtype that cannot carry one
 * (`hazard`) is dropped for the same reason it is refused on update.
 */
export function sanitizeAttitudeOnCreate(
  item: Record<string, unknown>,
  privileged: boolean,
): Record<string, unknown> {
  const raw = readAttitudeFlagValue(item);
  if (raw === undefined) return item;

  const keep = privileged && isActorAttitude(raw) && actorAcceptsAttitude(item);

  const flags = item["flags"] as Record<string, unknown>;
  const namespace = flags[ATTITUDE_FLAG_NAMESPACE] as Record<string, unknown>;
  const nextNamespace: Record<string, unknown> = { ...namespace };
  if (keep) {
    nextNamespace[ATTITUDE_FLAG_KEY] = raw;
  } else {
    Reflect.deleteProperty(nextNamespace, ATTITUDE_FLAG_KEY);
  }
  return { ...item, flags: { ...flags, [ATTITUDE_FLAG_NAMESPACE]: nextNamespace } };
}
