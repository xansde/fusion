/**
 * Extra damage on a Strike's damage roll — BHR-F4-09 (REQ-PET-119, REQ-CHT-064).
 *
 * The system's roll resolver names the extra dice an actor's effects add to a Strike (the Apoio of an animal
 * companion: +1d8 slashing from the bear). This module is the part only the SERVER can judge, and it judges
 * from what it owns, never from what the client says:
 *
 *   1. the Strike HIT — the damage roll is nested under a card (`parentMessageId`) and the server itself graded
 *      an attack under that card, by the same speaker and against the same target token, as a success or a
 *      critical success (a miss adds nothing; the damage button is not even offered, but a forged roll buys
 *      nothing);
 *   2. the gate — `withinReachOf: "companion"` is measured with `PositionQuery.distanceBetween` between the
 *      token of the companion and the token of the target, in the scene the target stands in;
 *   3. the critical hit — the dice are doubled only when the rule says so (`doubleOnCrit` !== false). The Apoio
 *      of the bear is a separate damage ("the creature takes 1d8"), not dice of the Strike, so it is NOT doubled
 *      on a critical hit (Player Core).
 *
 * `settleExtraDamage` is pure (scenes and actors in, parts out) so the rule is testable without a socket.
 * Persistent parts (the antelope's bleed) are not dice of the formula: they leave as a note, never rolled here.
 */

import {
  extractFlavor,
  readActorSizeCategory,
  readMountState,
  resolveEffectiveActor,
  type ResolvedRollNote,
} from "@fusion/shared";
import type { ResolvedExtraDamage, RollTargetSnapshotEntry } from "@fusion/system-api";

import { distanceBetween, type PositionGrid, type PositionedToken } from "../combat/position.js";

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The degrees of success that hit. */
export type StrikeHitDegree = "success" | "criticalSuccess";

/** What the server needs from the world to measure the gate. */
export interface ExtraDamageWorld {
  /** Every scene, with its tokens (raw rows). */
  readonly scenes: readonly Rec[];
  readonly getActor: (actorId: string) => Rec | null;
}

/** One extra part that counted, as the damage card shows it. */
export interface AppliedExtraDamage {
  readonly slug: string;
  readonly label: string;
  /** `1d8` — the dice that went into the formula (already doubled on a critical hit when the rule says so). */
  readonly dice: string;
  readonly damageType: string;
  readonly category?: string;
  /** False for a persistent part: it is announced, not rolled with the formula. */
  readonly rolled: boolean;
  /** The line the damage card shows, in pt-BR: `Apoio do urso: +1d8 de dano cortante`. */
  readonly summary: string;
}

export interface SettledExtraDamage {
  /** ` + 1d8` pieces to append to the damage formula, or "" when nothing counts. */
  readonly formulaSuffix: string;
  readonly applied: readonly AppliedExtraDamage[];
  readonly notes: readonly ResolvedRollNote[];
}

export const NO_EXTRA_DAMAGE: SettledExtraDamage = Object.freeze({
  formulaSuffix: "",
  applied: [],
  notes: [],
});

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function gridOf(scene: Rec): PositionGrid {
  const g = isRec(scene["grid"]) ? scene["grid"] : {};
  const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
  return {
    size: num(g["size"], 100),
    distance: num(g["distance"], 5),
    ...(typeof g["offsetX"] === "number" ? { offsetX: g["offsetX"] } : {}),
    ...(typeof g["offsetY"] === "number" ? { offsetY: g["offsetY"] } : {}),
    ...(typeof g["diagonalRule"] === "string"
      ? { diagonalRule: g["diagonalRule"] as NonNullable<PositionGrid["diagonalRule"]> }
      : {}),
    ...(typeof g["type"] === "string"
      ? { type: g["type"] as NonNullable<PositionGrid["type"]> }
      : {}),
  };
}

function tokensOf(scene: Rec): Rec[] {
  return Array.isArray(scene["tokens"]) ? (scene["tokens"] as Rec[]) : [];
}

/** The positioned token (effective size, token delta applied), or null when it cannot be measured. */
function positionedToken(token: Rec, world: ExtraDamageWorld): PositionedToken | null {
  const actorId = token["actorId"];
  if (typeof actorId !== "string" || actorId === "") return null;
  const actor = world.getActor(actorId);
  if (actor === null) return null;
  const system = isRec(actor["system"]) ? actor["system"] : {};
  const effective = resolveEffectiveActor(
    {
      actorLink: token["actorLink"] !== false,
      actorDelta: isRec(token["actorDelta"])
        ? (token["actorDelta"] as { system?: Record<string, unknown> })
        : null,
    },
    { name: "", system },
  );
  const size = readActorSizeCategory(effective.system);
  if (size === undefined) return null;
  return {
    ...(typeof token["_id"] === "string" ? { id: token["_id"] } : {}),
    x: Number(token["x"] ?? 0),
    y: Number(token["y"] ?? 0),
    size,
  };
}

/**
 * Is the target token within `reachFeet` of the token of `companionActorId`, in the scene the target stands
 * in? Anything that cannot be measured (no companion token in that scene, unknown size, a hex grid) is a
 * "no": a gate the server cannot prove does not open.
 */
function withinReachOfCompanion(
  target: RollTargetSnapshotEntry,
  companionActorId: string,
  reachFeet: number,
  world: ExtraDamageWorld,
  riderActorId?: string,
  requiresMounted = false,
): boolean {
  const scene =
    world.scenes.find(
      (s) => (target.sceneId === "" || s["_id"] === target.sceneId) && hasToken(s, target.tokenId),
    ) ?? null;
  if (scene === null) return false;
  const targetToken = tokensOf(scene).find((t) => t["_id"] === target.tokenId);
  // A part that needs the mount is measured from the token the rider is ON (the actor may have other tokens).
  const companionToken =
    requiresMounted && riderActorId !== undefined
      ? (mountTokenOf(scene, riderActorId, companionActorId) ?? undefined)
      : tokensOf(scene).find((t) => t["actorId"] === companionActorId);
  if (targetToken === undefined || companionToken === undefined) return false;
  const a = positionedToken(companionToken, world);
  const b = positionedToken(targetToken, world);
  if (a === null || b === null) return false;
  try {
    return distanceBetween(a, b, gridOf(scene)) <= reachFeet;
  } catch (err) {
    if (err instanceof RangeError) return false;
    throw err;
  }
}

/**
 * Is `riderActorId` mounted on the token of `companionActorId`, in the scene the target stands in? The rider's token
 * and the companion's token must confirm each other in the mount flag (a flag the other side does not confirm is
 * stale, as in `mount-follow`). Anything that cannot be proven is a "no".
 */
function mountTokenOf(scene: Rec, riderActorId: string, companionActorId: string): Rec | null {
  const tokens = tokensOf(scene);
  for (const rider of tokens) {
    if (rider["actorId"] !== riderActorId) continue;
    const mountTokenId = readMountState(rider).mountTokenId;
    if (mountTokenId === undefined) continue;
    const mount = tokens.find((t) => t["_id"] === mountTokenId);
    if (
      mount !== undefined &&
      mount["actorId"] === companionActorId &&
      readMountState(mount).riderTokenId === rider["_id"]
    ) {
      return mount;
    }
  }
  return null;
}

function mountedOnCompanion(
  target: RollTargetSnapshotEntry,
  riderActorId: string | undefined,
  companionActorId: string,
  world: ExtraDamageWorld,
): boolean {
  if (riderActorId === undefined) return false;
  const scene =
    world.scenes.find(
      (s) => (target.sceneId === "" || s["_id"] === target.sceneId) && hasToken(s, target.tokenId),
    ) ?? null;
  return scene !== null && mountTokenOf(scene, riderActorId, companionActorId) !== null;
}

function hasToken(scene: Rec, tokenId: string): boolean {
  return tokensOf(scene).some((t) => t["_id"] === tokenId);
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

const DAMAGE_TYPE_PT: Readonly<Record<string, string>> = {
  slashing: "cortante",
  piercing: "perfurante",
  bludgeoning: "contundente",
  bleed: "sangramento",
  fire: "fogo",
  cold: "frio",
  acid: "ácido",
  electricity: "eletricidade",
  sonic: "sônico",
  poison: "veneno",
  mental: "mental",
  force: "força",
  vitality: "vitalidade",
  void: "vazio",
  spirit: "espírito",
  precision: "precisão",
};

function typePt(type: string): string {
  return DAMAGE_TYPE_PT[type] ?? type;
}

/**
 * Settle the extra damage of a Strike's damage roll. `hit` is the degree of the attack the server graded
 * under the same card (null = no proof of a hit); `target` is the roll's single target (null = none).
 */
export function settleExtraDamage(input: {
  extra: readonly ResolvedExtraDamage[];
  target: RollTargetSnapshotEntry | null;
  hit: StrikeHitDegree | null;
  world: ExtraDamageWorld;
  /** The actor that rolls: needed to prove the mount of a part with `gate.requiresMounted`. */
  rollerActorId?: string;
}): SettledExtraDamage {
  const { extra, target, hit, world } = input;
  if (extra.length === 0 || hit === null || target === null) return NO_EXTRA_DAMAGE;

  const applied: AppliedExtraDamage[] = [];
  const notes: ResolvedRollNote[] = [];
  let suffix = "";
  for (const part of extra) {
    if (part.gate !== undefined) {
      if (
        !withinReachOfCompanion(
          target,
          part.gate.companionActorId,
          part.gate.reachFeet,
          world,
          input.rollerActorId,
          part.gate.requiresMounted === true,
        )
      ) {
        continue;
      }
      if (
        part.gate.requiresMounted === true &&
        !mountedOnCompanion(target, input.rollerActorId, part.gate.companionActorId, world)
      ) {
        continue;
      }
    }
    const persistent = part.category === "persistent";
    // Persistent damage is its own damage, never dice of the Strike: a critical hit does not double it.
    const doubled = hit === "criticalSuccess" && part.doubleOnCrit && !persistent;
    const count = part.count * (doubled ? 2 : 1);
    const dice = `${String(count)}${part.die}`;
    const type = persistent ? `${typePt(part.damageType)} persistente` : typePt(part.damageType);
    const text = persistent
      ? `${dice} de dano de ${type} (não entra na rolagem)`
      : `+${dice} de dano ${type}`;
    applied.push({
      slug: part.slug,
      label: part.label,
      dice,
      damageType: part.damageType,
      ...(part.category !== undefined ? { category: part.category } : {}),
      rolled: !persistent,
      summary: `${part.label}: ${text}`,
    });
    if (!persistent) suffix += ` + ${dice}`;
    notes.push({
      selector: "strike-damage",
      title: part.label,
      text,
      sourceItemId: part.sourceItemId ?? "",
      slug: part.slug,
    });
  }
  return { formulaSuffix: suffix, applied, notes };
}

/**
 * The formula with the extra dice appended BEFORE its flavor (`2d8+4 # Dano` + ` + 1d8` -> `2d8+4 + 1d8`,
 * flavor `Dano`). Unchanged when there is nothing to append.
 */
export function withExtraDice(
  rolled: { formula: string; flavor?: string },
  suffix: string,
): { formula: string; flavor?: string } {
  if (suffix === "") return rolled;
  const split = extractFlavor(rolled.formula);
  const flavor = rolled.flavor ?? split.flavor;
  return flavor !== undefined
    ? { formula: `${split.formula}${suffix}`, flavor }
    : { formula: `${split.formula}${suffix}` };
}

// ---------------------------------------------------------------------------
// The proof of a hit
// ---------------------------------------------------------------------------

/** The slice of the database the proof needs (better-sqlite3 compatible). */
export interface ChatMessageReader {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
}

/**
 * The degree of the LATEST attack the server graded under `parentMessageId` for this speaker and this target token
 * (any degree: a hit or a miss), or `null` when there is none. The most recent attack of the card wins (a card may
 * carry several).
 */
export function readStrikeAttackDegree(
  db: ChatMessageReader,
  input: { parentMessageId: string; userId: string; actorId: string; targetTokenId: string },
): string | null {
  const rows = db
    .prepare(
      `SELECT data FROM chat_messages
       WHERE json_extract(data, '$.flags.fusion.parentMessageId') = ?
       ORDER BY timestamp DESC LIMIT 50`,
    )
    .all(input.parentMessageId) as { data: string }[];
  for (const row of rows) {
    let msg: Rec;
    try {
      msg = JSON.parse(row.data) as Rec;
    } catch {
      continue;
    }
    const flags = isRec(msg["flags"]) ? msg["flags"] : {};
    const check =
      isRec(flags["pf2e"]) && isRec(flags["pf2e"]["checkContext"])
        ? flags["pf2e"]["checkContext"]
        : null;
    if (check === null || check["kind"] !== "attack") continue;
    const speaker = isRec(msg["speaker"]) ? msg["speaker"] : {};
    if (speaker["userId"] !== input.userId || speaker["actorId"] !== input.actorId) continue;
    const fusion = isRec(flags["fusion"]) ? flags["fusion"] : {};
    const snapshot = Array.isArray(fusion["targetSnapshot"])
      ? (fusion["targetSnapshot"] as unknown[])
      : [];
    const aimed = snapshot.some((e) => isRec(e) && e["tokenId"] === input.targetTokenId);
    if (!aimed) continue;
    const rolls = Array.isArray(msg["rolls"]) ? (msg["rolls"] as unknown[]) : [];
    const degree = isRec(rolls[0]) ? rolls[0]["degreeOfSuccess"] : undefined;
    // Only the latest attack counts: a later miss is not overruled by an earlier hit.
    return typeof degree === "string" ? degree : null;
  }
  return null;
}

/**
 * The degree of the attack the server graded under `parentMessageId` for this speaker and this target token,
 * when it hit. `null` = no proof of a hit.
 */
export function readStrikeHit(
  db: ChatMessageReader,
  input: { parentMessageId: string; userId: string; actorId: string; targetTokenId: string },
): StrikeHitDegree | null {
  const degree = readStrikeAttackDegree(db, input);
  return degree === "success" || degree === "criticalSuccess" ? degree : null;
}

// ---------------------------------------------------------------------------
// The roll as the chat handler sees it
// ---------------------------------------------------------------------------

/** The slice of the document store the settlement reads. */
export interface ExtraDamageStore {
  getAll(collection: "scenes" | "actors"): Rec[];
  getRaw(collection: "scenes", id: string): Rec;
  get(collection: "actors", id: string): Rec;
}

/**
 * The degree of the attack the server graded under the card a Strike's damage roll nests under (same speaker, same
 * target token), or `null` when the roll is not a Strike's damage, is not nested or has no single target. One proof
 * for everything the damage roll needs the attack for: the extra dice, the critical doubling, the notes by degree.
 */
export function proveStrikeAttackDegree(input: {
  db: ChatMessageReader;
  userId: string;
  actorId: string;
  selectors: readonly string[];
  snapshot: readonly RollTargetSnapshotEntry[];
  parentMessageId: string | undefined;
}): string | null {
  if (!input.selectors.includes("strike-damage")) return null;
  if (input.parentMessageId === undefined || input.snapshot.length !== 1) return null;
  const target = input.snapshot[0];
  if (target === undefined) return null;
  return readStrikeAttackDegree(input.db, {
    parentMessageId: input.parentMessageId,
    userId: input.userId,
    actorId: input.actorId,
    targetTokenId: target.tokenId,
  });
}

/**
 * Settle the extra damage of ONE chat roll. Only a Strike's damage roll counts (the selector the sheet
 * declares, `strike-damage`), nested under its card, with exactly one live target: anything else, and the
 * roll goes out as the client wrote it.
 */
export function settleChatRollExtraDamage(input: {
  /** The proven attack degree when the caller already read it (`proveStrikeAttackDegree`); read here when absent. */
  attackDegree?: string | null;
  db: ChatMessageReader;
  store: ExtraDamageStore;
  userId: string;
  actorId: string;
  selectors: readonly string[];
  extra: readonly ResolvedExtraDamage[];
  snapshot: readonly RollTargetSnapshotEntry[];
  parentMessageId: string | undefined;
}): SettledExtraDamage {
  if (input.extra.length === 0) return NO_EXTRA_DAMAGE;
  if (!input.selectors.includes("strike-damage")) return NO_EXTRA_DAMAGE;
  if (input.parentMessageId === undefined || input.snapshot.length !== 1) return NO_EXTRA_DAMAGE;
  const target = input.snapshot[0];
  if (target === undefined) return NO_EXTRA_DAMAGE;
  const proven =
    input.attackDegree !== undefined ? input.attackDegree : proveStrikeAttackDegree(input);
  const hit = proven === "success" || proven === "criticalSuccess" ? proven : null;
  const scenes: Rec[] = [];
  for (const listed of input.store.getAll("scenes")) {
    const id = listed["_id"];
    if (typeof id !== "string") continue;
    // `getRaw`: the tokens exactly as stored (no legacy-token read filter).
    scenes.push(input.store.getRaw("scenes", id));
  }
  return settleExtraDamage({
    extra: input.extra,
    target,
    hit,
    rollerActorId: input.actorId,
    world: {
      scenes,
      getActor: (actorId) => {
        try {
          return input.store.get("actors", actorId);
        } catch {
          return null;
        }
      },
    },
  });
}
