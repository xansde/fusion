<script lang="ts">
  /**
   * SceneImagesPanel.svelte — the GM's control over the images a scene is
   * composed of, and when each one appears.
   *
   * A scene is rarely one picture: the room before and after, the trapdoor
   * that opens mid-fight, the floor below the one the party is on. Each of
   * those is an image added once here and then shown or hidden.
   *
   * Hiding is real, not cosmetic: the server strips hidden tiles from every
   * player payload, so a player's client never receives the image at all.
   *
   * Thin by design — every op lives in tileController.ts, which is tested.
   */

  import type { Socket } from "socket.io-client";
  import type { SceneDocument, TileDocument } from "@fusion/shared";
  import FilePicker from "../assets/FilePicker.svelte";
  import { fusionApi } from "../../lib/api.js";
  import {
    addTile,
    setTileHidden,
    deleteTile,
    reorderTile,
    sortTiles,
    tilesOf,
    nextTileSort,
  } from "../../lib/scenes/tileController.js";
  import { t } from "../../lib/i18n/index.js";

  const {
    scene,
    socket,
    onClose,
  }: {
    scene: SceneDocument;
    socket: Socket | null;
    onClose: () => void;
  } = $props();

  // Newest on top of the list, matching how the images stack on the canvas.
  const tiles = $derived(sortTiles(tilesOf(scene)).reverse());

  let picking = $state(false);
  let busyId = $state<string | null>(null);
  let error = $state<string | null>(null);
  /** Id of the tile awaiting a second click to confirm deletion. */
  let confirmingDelete = $state<string | null>(null);

  async function run(id: string, op: () => Promise<void>): Promise<void> {
    if (!socket) {
      error = t("FUSION.Scene.Images.NoConnection");
      return;
    }
    error = null;
    busyId = id;
    try {
      await op();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busyId = null;
    }
  }

  async function handlePicked(path: string): Promise<void> {
    picking = false;
    if (!socket) {
      error = t("FUSION.Scene.Images.NoConnection");
      return;
    }
    await run("new", async () => {
      await addTile(
        socket,
        scene._id,
        {
          // Named after the file so the list is readable before the GM renames
          // anything; sized and placed to cover the scene, which is what a
          // second version of the map wants and the easiest thing to adjust
          // from if it is not.
          name: fileLabel(path),
          texture: path,
          x: 0,
          y: 0,
          width: scene.width,
          height: scene.height,
        },
        nextTileSort(tilesOf(scene)),
      );
    });
  }

  function fileLabel(path: string): string {
    const base = path.split("/").pop() ?? path;
    return base.replace(/\.[a-z0-9]+$/i, "");
  }

  function handleDelete(tile: TileDocument): void {
    if (confirmingDelete !== tile._id) {
      confirmingDelete = tile._id;
      return;
    }
    confirmingDelete = null;
    void run(tile._id, () => deleteTile(socket!, scene._id, tile._id));
  }
</script>

<div class="images" role="dialog" aria-label={t("FUSION.Scene.Images.Title")}>
  <header class="images__head">
    <h2 class="images__title">{t("FUSION.Scene.Images.Title")}</h2>
    <button class="btn btn--ghost btn--sm" onclick={onClose}>
      {t("FUSION.Scene.Images.Close")}
    </button>
  </header>

  <p class="images__hint">{t("FUSION.Scene.Images.Hint")}</p>

  {#if tiles.length === 0}
    <p class="images__empty">{t("FUSION.Scene.Images.Empty")}</p>
  {:else}
    <ul class="images__list">
      {#each tiles as tile (tile._id)}
        <li class="images__row" class:images__row--hidden={tile.hidden}>
          <button
            class="images__toggle"
            title={tile.hidden
              ? t("FUSION.Scene.Images.Show")
              : t("FUSION.Scene.Images.Hide")}
            aria-label={tile.hidden
              ? t("FUSION.Scene.Images.Show")
              : t("FUSION.Scene.Images.Hide")}
            aria-pressed={!tile.hidden}
            disabled={busyId === tile._id}
            onclick={() =>
              run(tile._id, () => setTileHidden(socket!, scene._id, tile._id, !tile.hidden))}
          >
            {tile.hidden ? "○" : "◉"}
          </button>

          <span class="images__name" title={tile.texture ?? ""}>
            {tile.name || t("FUSION.Scene.Images.Untitled")}
          </span>

          <span class="images__state">
            {tile.hidden ? t("FUSION.Scene.Images.StateHidden") : t("FUSION.Scene.Images.StateShown")}
          </span>

          <button
            class="images__icon"
            title={t("FUSION.Scene.Images.MoveUp")}
            aria-label={t("FUSION.Scene.Images.MoveUp")}
            disabled={busyId === tile._id}
            onclick={() =>
              run(tile._id, () =>
                reorderTile(socket!, scene._id, tilesOf(scene), tile._id, "up"),
              )}
          >
            &uarr;
          </button>
          <button
            class="images__icon"
            title={t("FUSION.Scene.Images.MoveDown")}
            aria-label={t("FUSION.Scene.Images.MoveDown")}
            disabled={busyId === tile._id}
            onclick={() =>
              run(tile._id, () =>
                reorderTile(socket!, scene._id, tilesOf(scene), tile._id, "down"),
              )}
          >
            &darr;
          </button>

          <button
            class="images__icon images__icon--danger"
            title={t("FUSION.Scene.Images.Remove")}
            aria-label={t("FUSION.Scene.Images.Remove")}
            disabled={busyId === tile._id}
            onclick={() => {
              handleDelete(tile);
            }}
          >
            {confirmingDelete === tile._id ? t("FUSION.Scene.Images.ConfirmRemove") : "✕"}
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if error}
    <p class="images__error">{error}</p>
  {/if}

  <button
    class="btn btn--primary btn--sm"
    disabled={busyId === "new"}
    onclick={() => {
      picking = true;
    }}
  >
    {busyId === "new" ? t("FUSION.Scene.Images.Adding") : t("FUSION.Scene.Images.Add")}
  </button>
</div>

{#if picking}
  {@const tok = fusionApi.getToken() ?? ""}
  <FilePicker
    token={tok}
    kinds={["image"]}
    onSelect={(path: string) => {
      void handlePicked(path);
    }}
    onClose={() => {
      picking = false;
    }}
  />
{/if}

<style>
  .images {
    background: var(--fusion-surface, #1c1c22);
    border: 1px solid rgba(124, 92, 252, 0.35);
    border-radius: var(--fusion-radius-md, 8px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    left: 1.5rem;
    max-height: min(60vh, 32rem);
    overflow-y: auto;
    padding: 0.9rem 1rem;
    position: absolute;
    top: 4.5rem;
    width: min(24rem, calc(100vw - 3rem));
    z-index: 40;
  }

  .images__head {
    align-items: center;
    display: flex;
    justify-content: space-between;
  }

  .images__title {
    color: var(--fusion-text, #eee);
    font-size: 0.95rem;
    font-weight: 600;
    margin: 0;
  }

  .images__hint,
  .images__empty {
    color: var(--fusion-text-muted, #aaa);
    font-size: 0.78rem;
    line-height: 1.35;
    margin: 0;
  }

  .images__list {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .images__row {
    align-items: center;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 4px;
    display: flex;
    gap: 0.35rem;
    padding: 0.3rem 0.4rem;
  }

  .images__row--hidden .images__name {
    color: var(--fusion-text-muted, #888);
  }

  .images__toggle,
  .images__icon {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    color: var(--fusion-text, #eee);
    cursor: pointer;
    flex-shrink: 0;
    font-size: 0.8rem;
    line-height: 1;
    padding: 0.25rem 0.4rem;
  }

  .images__toggle:disabled,
  .images__icon:disabled {
    cursor: default;
    opacity: 0.4;
  }

  .images__icon--danger {
    color: #ff8866;
  }

  .images__name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .images__state {
    color: var(--fusion-text-muted, #aaa);
    flex-shrink: 0;
    font-size: 0.7rem;
  }

  .images__error {
    color: #ff8866;
    font-size: 0.78rem;
    margin: 0;
  }
</style>
