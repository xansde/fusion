/**
 * npcsFooter.ts — the rules of the NPCs tab's fixed footer (spec 42 §5.8, G076).
 *
 * The footer holds exactly two controls (REQ-NPC-062): the chest, which lands on
 * the scene on air (REQ-NPC-060), and the door to "Quem conhece quem", which is
 * the SAME window the Contatos tab opens and therefore lives in
 * `lib/contacts/knowledgeWindow.ts`, not here (REQ-NPC-072).
 *
 * **The chest IS an actor** (DEC-ATR-09, `45`, which closed Q-NPC-04 and Q-NPC-05):
 * a subtype `loot` with the `container` facet, with `items` and `ownership` like
 * any other actor. What DEC-NPC-08 refused — and DEC-ATR-09 keeps refusing — is
 * the chest **in the directory**: no folder, no attitude, no row, no cell in the
 * knowledge window. That is why this tab's predicates (`isNpcRowActor`,
 * `isNonPlayableActor`, `isKnownContact`) do not admit the `loot` subtype, and why
 * `buildCreateChestActorOp` below never writes a folder, an attitude or a
 * knowledge entry for it.
 *
 * **"On the scene" is a real `Token`, not a metaphor.** `packages/shared/src/scene.ts`
 * already gives a `Scene`'s embedded `Token` a soft `actorId` (REQ-DOC-031), and the
 * server already has a dedicated write for landing ONE new token on a scene: a
 * `doc:create` with `documentType: "Token"` and `parent: { type: "Scene", id }`
 * (`handleEmbeddedCreate`, doc-handlers.ts — `_id` is generated server-side and the
 * token is appended to `Scene.tokens` atomically). `buildPlaceChestTokenOp` uses
 * exactly that.
 *
 * A004 (ajustes r1 item 22): this module (and `TokenAddDialog.svelte`, the sibling
 * call site) used to build the SECOND write as a `doc:update` with
 * `diff: { tokens: { $push: {...} } }` — a MongoDB-style pseudo-operator that does
 * not exist on the server, rejected with `tokens: Expected array, received object`
 * (`Scene.tokens` is `z.array(TokenDocumentSchema)`, and the server's generic diff
 * merge replaces an array key wholesale rather than understanding `$push`). Sending
 * the WHOLE array back as a plain `doc:update` diff is not the fix either: the
 * server's `rejectUnwritableField` refuses that too, on purpose —
 * `"Scene.tokens is not writable as a whole through doc:update — use embedded
 * operations (updates[].embedded)"` — precisely to keep every embedded-collection
 * write going through the dedicated, append-safe path used here.
 *
 * **What this module still does not decide** — and does not need to, to do its
 * job: whether a token is *linked* or *unlinked* to its actor (the `actorLink`/
 * `actorDelta` pair spec 02's "Herança token→actor" section describes) is
 * Q-NPC-03, owned by the Token spec (`41`), and neither field is implemented on
 * `TokenDocumentSchema` yet — only the bare `actorId` reference exists today.
 * The token this module creates carries `actorId` and nothing `41` would have
 * to undo.
 *
 * Kept out of the component so it can be exercised without a DOM: the client
 * project runs Vitest in a node environment.
 */

import type { Socket } from "socket.io-client";

import { t } from "../i18n/i18n.js";
import { sendOp } from "../docs/sendOp.js";

/**
 * The subtype the pf2e system declares for a container (Q-NPC-04, closed by
 * DEC-ATR-09): it is the subtype of the `container` facet, and the chest is the
 * only actor this tab's footer ever creates with it.
 */
export const CHEST_ACTOR_SUBTYPE = "loot";

/** What the footer's chest control can do right now, and where it would land. */
export interface ChestControlState {
  /** Whether the control can be activated at all. */
  readonly enabled: boolean;
  /** The scene the chest would land on — the one on air (REQ-NPC-060). */
  readonly sceneId: string | null;
  /** i18n key of the control's accessible name / tooltip. */
  readonly labelKey: string;
}

/**
 * REQ-NPC-060: the chest goes to the scene on air, so with no scene on air there
 * is no destination and the control is off — with a reason in words, never only in
 * colour (REQ-NPC-093).
 */
export function chestControlState(activeSceneId: string | null | undefined): ChestControlState {
  const sceneId = typeof activeSceneId === "string" && activeSceneId !== "" ? activeSceneId : null;
  return {
    enabled: sceneId !== null,
    sceneId,
    labelKey: sceneId === null ? "FUSION.Npcs.Chest.NoScene" : "FUSION.Npcs.Chest.Open",
  };
}

// ---------------------------------------------------------------------------
// The first write — the chest's actor (REQ-NPC-061: no folder, no attitude)
// ---------------------------------------------------------------------------

export interface CreateChestActorOp {
  readonly type: "doc:create";
  readonly payload: {
    readonly documentType: "Actor";
    readonly data: readonly Record<string, unknown>[];
  };
}

/**
 * REQ-NPC-061 / DEC-NPC-08: a plain `loot` actor, with no folder and no
 * attitude — the tab's own predicates never list this subtype anyway, but the
 * document itself carries nothing to filter out either.
 */
export function buildCreateChestActorOp(): CreateChestActorOp {
  return {
    type: "doc:create",
    payload: {
      documentType: "Actor",
      data: [
        {
          name: t("FUSION.Npcs.Chest.DefaultName"),
          type: CHEST_ACTOR_SUBTYPE,
          folder: null,
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// The second write — a Token for it, on the scene on air (REQ-NPC-060)
// ---------------------------------------------------------------------------

export interface PlaceChestTokenOp {
  readonly type: "doc:create";
  readonly payload: {
    readonly documentType: "Token";
    readonly data: readonly Record<string, unknown>[];
    readonly parent: { readonly type: "Scene"; readonly id: string };
  };
}

/**
 * REQ-NPC-060 (A004, ajustes r1 item 22): an embedded `doc:create` of a Token
 * under the target scene — `parent: { type: "Scene", id: sceneId }` is what
 * routes this through `handleEmbeddedCreate`, which appends to
 * `Scene.tokens` and mints the `_id` server-side. Never a `$push`
 * pseudo-operator, and never a whole-array `doc:update` diff either — both
 * are refused by the server (see the module docstring).
 */
export function buildPlaceChestTokenOp(
  sceneId: string,
  actorId: string,
  name: string,
): PlaceChestTokenOp {
  return {
    type: "doc:create",
    payload: {
      documentType: "Token",
      data: [
        {
          name,
          actorId,
          texture: null,
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          rotation: 0,
          hidden: false,
          disposition: 0,
          elevation: 0,
          bar1: { attribute: null },
          bar2: { attribute: null },
        },
      ],
      parent: { type: "Scene", id: sceneId },
    },
  };
}

interface DocCreateResult {
  readonly documents: readonly { readonly _id: string; readonly name?: string }[];
}

/**
 * REQ-NPC-060: create the chest actor, then land it on the scene on air.
 *
 * Two ops, in order: `doc:create` mints the actor (REQ-NPC-061: no folder, no
 * attitude), and its `_id` becomes the `actorId` of the embedded `doc:create`
 * that lands a Token for it on the target scene. Either can reject; the
 * caller (the footer) is responsible for reporting a failure of the second
 * write, which would otherwise leave an actor with no presence.
 */
export async function placeChest(socket: Socket, sceneId: string): Promise<void> {
  const created = await sendOp<DocCreateResult>(socket, buildCreateChestActorOp());
  const actor = created.documents[0];
  if (actor === undefined) {
    throw new Error("doc:create returned no chest actor");
  }
  const name = actor.name ?? t("FUSION.Npcs.Chest.DefaultName");
  await sendOp(socket, buildPlaceChestTokenOp(sceneId, actor._id, name));
}
