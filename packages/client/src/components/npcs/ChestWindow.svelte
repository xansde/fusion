<script lang="ts">
  /**
   * ChestWindow.svelte — what the NPCs footer's chest control opens (spec 42 §5.8).
   *
   * The chest is **not an actor** (REQ-NPC-061, DEC-NPC-08): it lives on the scene,
   * which is why it never reaches the folder tree, the search, a folder count or
   * the "Quem conhece quem" window. That much the spec settles.
   *
   * What it does not settle is **where the chest's content lives** (Q-NPC-05): that
   * is the Token/Cenas spec's, and `41` is not written. So this window names the
   * destination scene and says plainly what is still missing, instead of writing a
   * shape on the scene that the future spec would have to undo. It creates no
   * document at all — there is no `sendOp` in this file.
   */

  import { worldMirror } from "../../lib/docs/worldSync.js";
  import { t } from "../../lib/i18n/i18n.js";

  interface SceneLike {
    _id: string;
    name?: string;
  }

  const { sceneId }: { sceneId: string } = $props();

  const sceneName = $derived(
    worldMirror.getByType<SceneLike>("Scene").find((scene) => scene._id === sceneId)?.name ??
      sceneId,
  );
</script>

<div class="chest-window" data-chest-window data-scene-id={sceneId}>
  <h2 class="chest-window__title">{t("FUSION.Npcs.Chest.Pending.Title")}</h2>
  <p class="chest-window__scene">{t("FUSION.Npcs.Chest.Pending.Scene", { scene: sceneName })}</p>
  <p class="chest-window__body">{t("FUSION.Npcs.Chest.Pending.Body")}</p>
</div>

<style>
  .chest-window {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    font-family: var(--fusion-font);
    color: var(--fusion-text);
  }

  .chest-window__title {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 600;
  }

  .chest-window__scene {
    margin: 0;
    font-size: 0.78rem;
    color: var(--fusion-text-muted);
  }

  .chest-window__body {
    margin: 0;
    font-size: 0.78rem;
    line-height: 1.45;
    color: var(--fusion-text-muted);
  }
</style>
