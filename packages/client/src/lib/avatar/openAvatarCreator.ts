/**
 * openAvatarCreator.ts — the Avatar button every character sheet window gets.
 *
 * The core adds it as a window header action (see `WindowHeaderAction`), so no
 * game-system sheet has to know the avatar exists. The creator and the window
 * manager are imported lazily: a table whose players never open it pays nothing
 * for the renderer.
 */

import { readAvatarFlag } from "@fusion/shared";
import type { WindowHeaderAction } from "../windows/window-manager.js";
import { displayName } from "../docs/displayName.js";
import { worldMirror } from "../docs/worldSync.js";
import { t } from "../i18n/i18n.js";

/** OWNER permission level (matches the document ownership scale). */
const OWNER = 3;

/** Whether a sheet with this permission may EDIT the avatar (else read-only). */
export function canEditAvatar(ownership: number, isGm: boolean): boolean {
  return isGm || ownership >= OWNER;
}

/** Only player characters carry an avatar; NPCs never show one in the corner. */
export function actorHasAvatar(actorDoc: Record<string, unknown>): boolean {
  return actorDoc["type"] === "character";
}

/** The creator's opening size: 940×640, shrunk to the viewport (never under the minimum). */
export function tamanhoDaJanela(
  viewportWidth: number | undefined,
  viewportHeight: number | undefined,
): { width: number; height: number } {
  const vw = typeof viewportWidth === "number" && viewportWidth > 0 ? viewportWidth : 1280;
  const vh = typeof viewportHeight === "number" && viewportHeight > 0 ? viewportHeight : 800;
  return {
    width: Math.max(620, Math.min(940, vw - 40)),
    // Header (48) + the window's own top offset and some air.
    height: Math.max(460, Math.min(640, vh - 110)),
  };
}

export async function openAvatarCreator(
  actorId: string,
  fallbackDoc: Record<string, unknown>,
  permissions: { ownership: number; isGm: boolean },
): Promise<void> {
  const [{ windowManager }, { default: AvatarCreator }] = await Promise.all([
    import("../windows/window-manager.js"),
    import("../../components/avatar/AvatarCreator.svelte"),
  ]);
  // The freshest copy: the flag may have changed since the sheet opened.
  const live = worldMirror.getDoc<Record<string, unknown>>("Actor", actorId) ?? fallbackDoc;
  const name = displayName(live);
  windowManager.open({
    singletonKey: `avatar:Actor:${actorId}`,
    title: t("FUSION.Avatar.Title", { name }),
    icon: "user",
    resizable: true,
    minimizable: true,
    minWidth: 620,
    minHeight: 460,
    // Fits the screen it opens on: a fixed 640 px ran past the bottom of a short
    // viewport and hid the creator's action buttons below the fold.
    position: tamanhoDaJanela(globalThis.innerWidth, globalThis.innerHeight),
    component: AvatarCreator,
    componentProps: {
      actorId,
      nome: name,
      avatarAtual: readAvatarFlag(live),
      podeEditar: canEditAvatar(permissions.ownership, permissions.isGm),
    },
  });
}

/** The header action for a character sheet window, or an empty list. */
export function avatarHeaderActions(
  actorId: string,
  actorDoc: Record<string, unknown>,
  permissions: { ownership: number; isGm: boolean },
): WindowHeaderAction[] {
  if (!actorHasAvatar(actorDoc)) return [];
  return [
    {
      id: "avatar",
      icon: "user",
      label: t("FUSION.Avatar.Button"),
      title: t("FUSION.Avatar.Open"),
      onclick: () => {
        void openAvatarCreator(actorId, actorDoc, permissions);
      },
    },
  ];
}
