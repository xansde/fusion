/**
 * npcsFooter.ts — the rules of the NPCs tab's fixed footer (spec 42 §5.8, G076).
 *
 * The footer holds exactly two controls (REQ-NPC-062): the chest, which lands on
 * the scene on air (REQ-NPC-060), and the door to "Quem conhece quem", which is
 * the SAME window the Contatos tab opens and therefore lives in
 * `lib/contacts/knowledgeWindow.ts`, not here (REQ-NPC-072).
 *
 * Two things this module deliberately does NOT do:
 *
 *  - **It never creates an Actor for the chest** (REQ-NPC-061, DEC-NPC-08). The
 *    chest is a narration tool that lives on the scene; giving it an actor would
 *    put it in the folder tree, in the search, in every folder count and in the
 *    knowledge window. There is no `doc:create` of an Actor anywhere in this file,
 *    and the tab's own predicates (`isNpcRowActor`, `isNonPlayableActor`,
 *    `isKnownContact`) do not admit the `loot` subtype, so nothing has to be
 *    filtered out after the fact.
 *  - **It does not decide where the chest's content lives** (Q-NPC-05). That is
 *    the Token/Cenas spec's (`41`), which does not exist yet, so the control opens
 *    a window that says so instead of writing a shape the future spec would have
 *    to undo. What is already settled — the chest goes to the scene on air, and is
 *    not an actor — is what this module encodes.
 *
 * Kept out of the component so it can be exercised without a DOM: the client
 * project runs Vitest in a node environment.
 */

import { t } from "../i18n/i18n.js";
import { windowManager } from "../windows/window-manager.js";
import ChestWindow from "../../components/npcs/ChestWindow.svelte";

import type { WindowHandle } from "../windows/window-manager.js";

/**
 * The subtype the pf2e system declares for a container (Q-NPC-04). Named here so
 * the tab can prove it never lists one, and used by nothing else: the chest is not
 * an actor, so no code path of this tab creates a document of this subtype.
 */
export const CHEST_ACTOR_SUBTYPE = "loot";

/** One chest window per table, however often the footer is pressed (REQ-UIF-014). */
export const CHEST_WINDOW_KEY = "npcs:chest";

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

/**
 * Open (or focus) the chest window for the scene on air.
 *
 * The window is a placeholder on purpose while `41` is unwritten (Q-NPC-05): it
 * names the destination scene and says what is still undecided. It creates no
 * document — least of all an Actor (REQ-NPC-061).
 */
export function openChestWindow(sceneId: string): WindowHandle {
  return windowManager.open({
    singletonKey: CHEST_WINDOW_KEY,
    title: t("FUSION.Npcs.Chest.Window"),
    resizable: true,
    minimizable: true,
    minWidth: 260,
    minHeight: 180,
    position: { width: 360, height: 240 },
    component: ChestWindow,
    componentProps: { sceneId },
  });
}
