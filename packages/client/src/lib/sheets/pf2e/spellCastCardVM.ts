/**
 * spellCastCardVM.ts — pure view-model for the interactive spell-cast chat card
 * (r17-P2).
 *
 * 100% testable TypeScript — no Svelte, no PIXI, no socket. The Svelte
 * component (SpellCastCard.svelte) owns the socket + worldMirror and delegates
 * every decision here:
 *   - which actor(s) the CLICKER may roll a save with (owner→their character(s),
 *     GM→any character);
 *   - the save-roll chat:send op (speaker = the chosen TARGET actor, mod from
 *     that actor's derived save total);
 *   - the damage-roll chat:send op (speaker = the CASTER, already-heightened
 *     formula from the card);
 *   - whether the current viewer may see/use the damage button (caster owner or
 *     GM only).
 *
 * The server is the authoritative gate: every roll runs on the server via
 * chat:send (RNG on server), the DC on the card was already coherence-checked
 * server-side, and the damage button's speaker=caster ride re-checks
 * ownership (REQ-CHT-022). These getters only decide what to SHOW/BUILD.
 */

import type { SpellCastCard, SpellSaveType, ChatSendFlags } from "@fusion/shared";

/** OwnershipLevel.OWNER (documents/ownership) — mirrored locally (dep-free VM). */
const OWNER = 3;

/** A character the clicker can roll a save with. */
export interface ClickerActorOption {
  id: string;
  name: string;
}

/** The chat:send op a card button emits (flat shape consumed by makeSendOpFn). */
export interface SpellCastChatOp {
  type: "chat:send";
  content: string;
  worldId: string;
  rollMode: "public";
  speakerActorId: string;
  /**
   * Optional structured flags carried to the server (r17.1). The save button
   * attaches `{ checkContext: { kind:"save", dcValue, saveType, basicSave? } }`
   * so the server can grade the roll's degree of success AUTHORITATIVELY. The
   * client never compares the total to the DC — it only forwards the (already
   * coherence-checked) DC + save metadata.
   */
  flags?: ChatSendFlags;
}

/** Minimal actor doc shape the VM reads (structural typing). */
export type ActorDocLike = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Ownership + actor reads (pure)
// ---------------------------------------------------------------------------

/** Effective ownership level of `userId` over an actor doc. */
export function actorOwnershipLevel(actor: ActorDocLike, userId: string): number {
  const ownership = actor["ownership"] as Record<string, number> | undefined;
  if (!ownership) return 0;
  return ownership[userId] ?? ownership["default"] ?? 0;
}

/** True when `userId` owns the actor (or is GM). */
export function ownsActor(actor: ActorDocLike, userId: string, isGm: boolean): boolean {
  if (isGm) return true;
  return actorOwnershipLevel(actor, userId) >= OWNER;
}

function actorName(actor: ActorDocLike): string {
  const raw = actor["name"];
  return typeof raw === "string" && raw.length > 0 ? raw : "?";
}

function actorId(actor: ActorDocLike): string {
  const raw = actor["_id"];
  return typeof raw === "string" ? raw : "";
}

function isCharacter(actor: ActorDocLike): boolean {
  const t = actor["type"];
  return t === "character" || t === "npc";
}

/**
 * The derived save modifier (total) of an actor for a given save statistic.
 * Reads `system.derived.saves[type].total`; falls back to 0 when absent so a
 * roll is still built (with +0) rather than silently doing nothing.
 */
export function actorSaveMod(actor: ActorDocLike, save: SpellSaveType): number {
  const system = actor["system"] as Record<string, unknown> | undefined;
  const derived = system?.["derived"] as Record<string, unknown> | undefined;
  const saves = derived?.["saves"] as Record<string, { total?: unknown }> | undefined;
  const total = saves?.[save]?.total;
  return typeof total === "number" ? total : 0;
}

// ---------------------------------------------------------------------------
// Clicker-actor resolution (save button)
// ---------------------------------------------------------------------------

/**
 * Which character(s) the clicking user may roll the save with (r17-P2):
 *   - a GM may roll with ANY character/npc actor (the whole roster);
 *   - a player may roll with the character(s) they OWN.
 * Sorted by name for a stable mini-selector. Returns [] when the user controls
 * no eligible actor (the save button is then disabled with a hint).
 */
export function resolveClickerActors(
  actors: ActorDocLike[],
  userId: string,
  isGm: boolean,
): ClickerActorOption[] {
  const out: ClickerActorOption[] = [];
  for (const actor of actors) {
    if (!isCharacter(actor)) continue;
    const id = actorId(actor);
    if (!id) continue;
    if (isGm || actorOwnershipLevel(actor, userId) >= OWNER) {
      out.push({ id, name: actorName(actor) });
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// ---------------------------------------------------------------------------
// Button visibility
// ---------------------------------------------------------------------------

/** The save button shows when the card carries both a save type and a DC. */
export function showSaveButton(card: SpellCastCard): boolean {
  return card.saveType !== undefined && card.dcValue !== undefined;
}

/** The damage button shows when the card carries a damage formula. */
export function hasDamage(card: SpellCastCard): boolean {
  return typeof card.damageFormula === "string" && card.damageFormula.length > 0;
}

/**
 * Whether the viewer may see/use the "Rolar dano" button: only the caster's
 * owner or a GM. `casterActor` may be undefined when the actor isn't in the
 * viewer's mirror (a player who can't see the caster) — then only a GM passes.
 */
export function canRollDamage(
  card: SpellCastCard,
  casterActor: ActorDocLike | undefined,
  userId: string,
  isGm: boolean,
): boolean {
  if (!hasDamage(card)) return false;
  if (isGm) return true;
  if (!casterActor) return false;
  return ownsActor(casterActor, userId, false);
}

// ---------------------------------------------------------------------------
// Roll op builders
// ---------------------------------------------------------------------------

/** Format a modifier with an explicit sign for a dice formula (+3, -1, +0). */
function fmtMod(value: number): string {
  return value >= 0 ? `+${String(value)}` : String(value);
}

/**
 * Build the save-roll chat:send op for a chosen TARGET actor (r17-P2). The
 * roll runs on the server (RNG server-side); the flavor names the save type
 * and DC. Speaker = the target actor (the one who rolls), NOT the caster.
 */
export function buildSaveRollOp(
  card: SpellCastCard,
  targetActor: ActorDocLike,
  saveTypeLabel: string,
  worldId: string,
): SpellCastChatOp | null {
  if (card.saveType === undefined || card.dcValue === undefined) return null;
  const targetId = actorId(targetActor);
  if (!targetId) return null;
  const mod = actorSaveMod(targetActor, card.saveType);
  const flavor = `Salvaguarda de ${saveTypeLabel} (CD ${String(card.dcValue)})`;
  // Attach the structured save checkContext (r17.1) so the SERVER grades the
  // degree of success against the DC. The DC on the card was already
  // coherence-checked server-side when the card was created; we only forward it.
  const checkContext: NonNullable<ChatSendFlags["checkContext"]> = {
    kind: "save",
    dcValue: card.dcValue,
    saveType: card.saveType,
    ...(card.basicSave !== undefined ? { basicSave: card.basicSave } : {}),
  };
  return {
    type: "chat:send",
    content: `/r 1d20${fmtMod(mod)} # ${flavor}`,
    worldId,
    rollMode: "public",
    speakerActorId: targetId,
    flags: { checkContext },
  };
}

/**
 * Build the damage-roll chat:send op (r17-P2). Speaker = the CASTER; the
 * formula is the already-heightened `damageFormula` from the card. Flavor names
 * the spell + rank (+ damage type when known). Returns null when the card has
 * no damage.
 */
export function buildDamageRollOp(
  card: SpellCastCard,
  worldId: string,
  flavorPrefix: string,
): SpellCastChatOp | null {
  if (!card.damageFormula) return null;
  const typeSuffix = card.damageType ? ` ${card.damageType}` : "";
  const flavor = `${flavorPrefix}${typeSuffix}`;
  return {
    type: "chat:send",
    content: `/r ${card.damageFormula} # ${flavor}`,
    worldId,
    rollMode: "public",
    speakerActorId: card.casterActorId,
  };
}
