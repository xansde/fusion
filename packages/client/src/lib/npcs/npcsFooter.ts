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
 * gives a `Scene`'s embedded `Token` a required `actorId` (REQ-DOC-031, REQ-TOK-002).
 * `buildPlaceChestTokenOp` lands one via the shared `doc:create` embedded-token
 * envelope (`lib/docs/tokenCreateOp.ts`, TK022-client) — the same one
 * `TokenAddDialog.svelte` uses. This module used to build a `doc:update` diff of
 * `{ tokens: { $push: {...} } }` instead: `$push` is not an operator this codebase's
 * merge (`packages/server/src/documents/merge.ts`) or its embedded-collection guard
 * (`doc-handlers.ts`'s `rejectUnwritableField`) implement, so that write could never
 * actually land a token — see `tokenCreateOp.ts`'s docstring for the full account.
 * `placeChest` does the two writes the gesture needs: create the actor, then create
 * a token for it, embedded in the scene on air. Nothing here is invented: both
 * writes go through document types and fields that already exist and are already
 * exercised elsewhere.
 *
 * **What this module still does not decide** — and does not need to, to do its
 * job: whether a token is *linked* or *unlinked* to its actor (the `actorLink`/
 * `actorDelta` pair spec 02's "Herança token→actor" section describes) is
 * Q-NPC-03, owned by the Token spec (`41`). Both fields exist on
 * `TokenDocumentSchema` now (TK020), but this module writes neither: the
 * chest is a plain linked token, which is exactly what the schema default
 * (`actorLink: true`) already says without a write.
 *
 * Kept out of the component so it can be exercised without a DOM: the client
 * project runs Vitest in a node environment.
 */

import type { Socket } from "socket.io-client";

import { t } from "../i18n/i18n.js";
import { sendOp } from "../docs/sendOp.js";
import { buildTokenCreateOp, type TokenCreateOp } from "../docs/tokenCreateOp.js";

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

export type PlaceChestTokenOp = TokenCreateOp;

/**
 * REQ-NPC-060: the `doc:create` (`lib/docs/tokenCreateOp.ts`) that lands the chest's
 * actor, embedded, on the scene on air — `actorId` set (REQ-DOC-031), and nothing
 * else the token no longer carries.
 *
 * TK022/TK023 (REQ-TOK-010, REQ-TOK-012, REQ-TOK-060): `name`/`texture`/`width`/
 * `height` are gone from `TokenDocumentSchema`. `name` is dropped on purpose, not
 * just because it no longer exists on the wire the same way: the chest's name IS
 * the actor's name (`buildCreateChestActorOp` already set it), so a `null` token
 * name inherits it instead of duplicating it.
 *
 * `x`/`y` ARE sent, and are not optional: REQ-TOK-020 (§7.2) makes them
 * obligatory content of every token creation, enforced server-side by
 * `validateTokenCreateContract` (`packages/server/src/tokens/tokenValidation.ts`)
 * before the payload ever reaches `TokenDocumentSchema`. This footer has no
 * canvas/viewport to center on (see the module docstring — it is kept
 * deliberately DOM-free so it can run under Vitest in node), unlike
 * `TokenInteractionManager.addToken`'s viewport-centered drop; the origin is
 * the same placeholder position the pre-TK022 payload used.
 *
 * `hidden` is deliberately ABSENT rather than spelled out as `false`: the chest
 * lands VISIBLE, and §7.2 makes `hidden` an overridable field whose absent value
 * inherits `TokenDocumentSchema`'s own default (`false`). Writing it explicitly
 * would only restate the default, and the same reasoning covers `disposition`,
 * `rotation`, `elevation` and `bar1`/`bar2` — every field the pre-merge payload
 * used to enumerate by hand.
 */
export function buildPlaceChestTokenOp(sceneId: string, actorId: string): PlaceChestTokenOp {
  return buildTokenCreateOp(sceneId, { actorId, x: 0, y: 0 });
}

interface DocCreateResult {
  readonly documents: readonly { readonly _id: string }[];
}

/**
 * REQ-NPC-060: create the chest actor, then land it on the scene on air.
 *
 * Two `doc:create` ops, in order: the first mints the actor (REQ-NPC-061: no
 * folder, no attitude), and its `_id` becomes the `actorId` of the second, which
 * creates a token for it, embedded in the target scene. Either can reject; the
 * caller (the footer) is responsible for reporting a failure of the second
 * write, which would otherwise leave an actor with no presence.
 */
export async function placeChest(socket: Socket, sceneId: string): Promise<void> {
  const created = await sendOp<DocCreateResult>(socket, buildCreateChestActorOp());
  const actor = created.documents[0];
  if (actor === undefined) {
    throw new Error("doc:create returned no chest actor");
  }
  await sendOp(socket, buildPlaceChestTokenOp(sceneId, actor._id));
}
