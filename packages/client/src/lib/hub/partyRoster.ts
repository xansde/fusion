/**
 * partyRoster.ts — the Comitiva panel's pure logic.
 *
 * Spec: `specs/28-hub-do-jogador.md` — REQ-HUB-043 (list the table's active
 * player characters), REQ-HUB-044 (name, portrait, HP, active conditions),
 * REQ-HUB-045 (the cut of what each user sees comes from the server-redacted
 * payload — this module reads whatever the DocumentMirror holds and never
 * re-decides visibility), RNF-HUB-02 (logic worth testing lives outside the
 * component).
 *
 * "Party member" is defined structurally: a `character`-type Actor whose
 * ownership map names at least one concrete user at OWNER level. The `default`
 * entry does not count — a world-open actor is a pre-gen on a shelf, not
 * someone's character at the table.
 *
 * HP reads server-derived data first (`system.derived.hp`, written by the
 * derivation pipeline) and falls back to the raw `system.attributes.hp` blob,
 * the same derived-first posture as `characterSheetVM`. The dotted-path read
 * itself lives in `lib/actors/actorResource.ts` — the token resource bar
 * (REQ-CNV-090) asks the same question of the same blob, and two copies of that
 * reader would eventually give two different answers on the same screen.
 */

import { readResourceAt } from "../actors/actorResource.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal Actor shape the roster needs — the full schema is system-specific. */
export interface PartyActorDoc {
  readonly _id: string;
  readonly name: string;
  readonly type: string;
  readonly img?: string | null;
  readonly ownership: Readonly<Record<string, number>>;
  readonly system?: Readonly<Record<string, unknown>>;
  readonly items?: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

export interface PartyHp {
  readonly value: number;
  readonly max: number;
  readonly temp: number;
}

export interface PartyCondition {
  readonly key: string;
  readonly label: string;
  /** Condition value (frightened 2), when the condition carries one. */
  readonly value?: number;
}

/** Everything the panel renders for one member. */
export interface PartyMemberVM {
  readonly id: string;
  readonly name: string;
  readonly img: string | null;
  readonly hp: PartyHp | null;
  /** Current HP over max, clamped to [0, 1]; 0 when hp is null. */
  readonly hpFraction: number;
  readonly conditions: readonly PartyCondition[];
  readonly heroPoints: { readonly value: number; readonly max: number } | null;
}

const OWNER = 3;

// ---------------------------------------------------------------------------
// Selection — REQ-HUB-043
// ---------------------------------------------------------------------------

/**
 * Pick the party out of every Actor the mirror holds: character-type, with a
 * named user at OWNER level. Sorted by name (pt-BR collation, like the actor
 * directory).
 */
export function selectPartyActors(actors: readonly PartyActorDoc[]): PartyActorDoc[] {
  return actors
    .filter((actor) => {
      if (actor.type !== "character") return false;
      return Object.entries(actor.ownership).some(
        ([userId, level]) => userId !== "default" && level >= OWNER,
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

// ---------------------------------------------------------------------------
// Member view-model — REQ-HUB-044
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readHp(system: Record<string, unknown> | null): PartyHp | null {
  return readResourceAt(system, "derived.hp") ?? readResourceAt(system, "attributes.hp");
}

function readConditions(items: PartyActorDoc["items"]): PartyCondition[] {
  if (!items) return [];
  return items
    .filter((item) => item["type"] === "condition")
    .map((item) => {
      const sys = asRecord(item["system"]);
      const name = typeof item["name"] === "string" ? item["name"] : "—";
      const rawSlug = sys?.["slug"];
      const slug = typeof rawSlug === "string" ? rawSlug : name;
      const value = sys?.["value"];
      const row: PartyCondition = { key: slug, label: name };
      return typeof value === "number" ? { ...row, value } : row;
    });
}

function readHeroPoints(
  system: Record<string, unknown> | null,
): { value: number; max: number } | null {
  const hp = asRecord(asRecord(system?.["resources"])?.["heroPoints"]);
  if (!hp) return null;
  const value = hp["value"];
  if (typeof value !== "number") return null;
  const max = hp["max"];
  return { value, max: typeof max === "number" ? max : 3 };
}

/** Build the render model for one member. Pure — call again on every change. */
export function buildPartyMember(actor: PartyActorDoc): PartyMemberVM {
  const system = asRecord(actor.system);
  const hp = readHp(system);
  const hpFraction = hp && hp.max > 0 ? Math.min(1, Math.max(0, hp.value / hp.max)) : 0;

  return {
    id: actor._id,
    name: actor.name,
    img: actor.img ?? null,
    hp,
    hpFraction,
    conditions: readConditions(actor.items),
    heroPoints: readHeroPoints(system),
  };
}
