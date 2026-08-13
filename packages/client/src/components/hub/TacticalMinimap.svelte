<script lang="ts">
  /**
   * TacticalMinimap.svelte — the Mapa panel of the System Window (spec 32).
   *
   * Svelte 5 Runes component. Draws the active scene reduced to a box: the
   * scene image, one marker per token the canvas is showing, and the rectangle
   * of the scene the local camera currently frames. Clicking moves the camera.
   *
   * Deliberately thin. Every decision — how the scene fits the box, where a
   * marker lands, how big the viewport rectangle is, whether anything changed
   * since the last frame — lives in `lib/hub/minimap.ts` and
   * `lib/hub/minimapSource.ts`, which the node-environment test runner can
   * reach. This file turns numbers into `style` strings and nothing else.
   *
   * Two rules worth stating out loud:
   *
   *  - It never asks the server for anything. The token list arrives already
   *    filtered by `TokenLayer.visibleTokenIds()`, so the minimap cannot show a
   *    token the canvas is hiding (DEC-MMT-02, REQ-MMT-005).
   *  - It never changes game state. Every interaction ends in `centerOn` —
   *    camera and nothing else (REQ-MMT-011).
   */

  import {
    buildMarkers,
    clampToScene,
    computeLayout,
    computeViewportBox,
    minimapToWorld,
    resolveBackground,
    type MinimapLayout,
  } from "$lib/hub/minimap.js";
  import { snapshotChanged, type MinimapSnapshot, type MinimapSource } from "$lib/hub/minimapSource.js";

  interface Props {
    /** Live wiring to the canvas. `null` before the canvas is up. */
    source: MinimapSource | null;
  }

  const { source }: Props = $props();

  let boxWidth = $state(0);
  let boxHeight = $state(0);
  let snapshot = $state<MinimapSnapshot | null>(null);
  let dragging = $state(false);

  const layout = $derived<MinimapLayout>(computeLayout(snapshot?.scene ?? null, boxWidth, boxHeight));
  const background = $derived(resolveBackground(snapshot?.scene ?? null));
  const markers = $derived(buildMarkers(snapshot?.tokens ?? [], snapshot?.gridSize ?? 100, layout));
  const viewportBox = $derived(
    snapshot === null
      ? { x: 0, y: 0, width: 0, height: 0 }
      : computeViewportBox(snapshot.camera, snapshot.viewportWidth, snapshot.viewportHeight, layout),
  );

  /** The drawn map rectangle, as a style string shared by image and colour fills. */
  const mapRect = $derived(
    `left:${String(layout.offsetX)}px;top:${String(layout.offsetY)}px;` +
      `width:${String(layout.width)}px;height:${String(layout.height)}px`,
  );

  // -------------------------------------------------------------------------
  // Read loop
  // -------------------------------------------------------------------------

  // One read per animation frame — that is the whole coalescing story
  // (REQ-MMT-012): however many token updates landed since the last frame, the
  // widget sees one reading and re-renders at most once.
  $effect(() => {
    const live = source;
    if (live === null) return;

    let frame = 0;
    const read = (): void => {
      const next = live.snapshot();
      if (snapshotChanged(snapshot, next)) snapshot = next;
      frame = requestAnimationFrame(read);
    };
    frame = requestAnimationFrame(read);
    return () => {
      cancelAnimationFrame(frame);
    };
  });

  // -------------------------------------------------------------------------
  // Navigation (REQ-MMT-008/009/010)
  // -------------------------------------------------------------------------

  function centerFromEvent(event: PointerEvent, animate: boolean): void {
    const live = source;
    const scene = snapshot?.scene;
    if (live === null || scene === undefined || scene === null || layout.scale <= 0) return;

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const world = minimapToWorld(event.clientX - rect.left, event.clientY - rect.top, layout);
    const target = clampToScene(world, scene);
    live.centerOn(target.x, target.y, animate);
  }

  function onPointerDown(event: PointerEvent): void {
    // Left button only; the middle button is the canvas's own pan gesture.
    if (event.button !== 0) return;
    dragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    centerFromEvent(event, true);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragging) return;
    // Instant while dragging: this is a pan, and the pan follows the finger.
    centerFromEvent(event, false);
  }

  function onPointerUp(event: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    const el = event.currentTarget as HTMLElement;
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
  }

  function centerOnMarker(worldX: number, worldY: number): void {
    source?.centerOn(worldX, worldY, true);
  }
</script>

{#if source === null}
  <p class="empty">O canvas ainda não está pronto — abra uma cena para ver o minimapa.</p>
{:else if snapshot?.scene == null}
  <p class="empty">Nenhuma cena ativa. O minimapa desenha a cena que estiver na mesa.</p>
{:else}
  <div
    class="surface"
    class:dragging
    bind:clientWidth={boxWidth}
    bind:clientHeight={boxHeight}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    role="presentation"
  >
    {#if background.kind === "image"}
      <img class="bg" src={background.src} alt="" style={mapRect} draggable="false" />
    {:else}
      <div class="bg" style="{mapRect};background:{background.color}"></div>
    {/if}

    <!-- Viewport rectangle: what the camera frames right now (REQ-MMT-004). -->
    {#if viewportBox.width > 0}
      <div
        class="viewport"
        aria-hidden="true"
        style="left:{viewportBox.x}px;top:{viewportBox.y}px;width:{viewportBox.width}px;height:{viewportBox.height}px"
      ></div>
    {/if}

    {#each markers as marker (marker.id)}
      {#if marker.controlled}
        <!-- Controllable token: a real button, so the camera can be sent there
             from the keyboard too (REQ-MMT-010/021). -->
        <button
          class="marker mine"
          class:hidden-token={marker.hidden}
          type="button"
          title={marker.name}
          aria-label="Centralizar em {marker.name}"
          style="left:{marker.x}px;top:{marker.y}px;width:{marker.radius * 2}px;height:{marker.radius *
            2}px;--marker-color:{marker.color}"
          onpointerdown={(event) => {
            event.stopPropagation();
          }}
          onclick={() => {
            centerOnMarker(marker.worldX, marker.worldY);
          }}
        ></button>
      {:else}
        <span
          class="marker"
          class:hidden-token={marker.hidden}
          title={marker.name}
          style="left:{marker.x}px;top:{marker.y}px;width:{marker.radius * 2}px;height:{marker.radius *
            2}px;--marker-color:{marker.color}"
        ></span>
      {/if}
    {/each}
  </div>

  <p class="legend">
    <span>{snapshot.scene.width} × {snapshot.scene.height} px</span>
    <span aria-hidden="true">·</span>
    <span>{markers.length} {markers.length === 1 ? "token" : "tokens"}</span>
    <span aria-hidden="true">·</span>
    <span>clique move a câmera</span>
  </p>
{/if}

<style>
  .surface {
    position: relative;
    width: 100%;
    /* Wide and short: a battle map is usually landscape, and the panel sits
       above the command bar where vertical room is the scarce one. */
    aspect-ratio: 16 / 9;
    max-height: 42vh;
    overflow: hidden;
    border: 1px solid var(--fusion-sw-line);
    background: #000;
    cursor: crosshair;
    touch-action: none;
  }
  .surface.dragging {
    cursor: grabbing;
  }

  .bg {
    position: absolute;
    object-fit: fill;
    /* The map is a reduced sketch, not art: crisp edges beat smoothing when a
       4000px scene lands in 500px. */
    image-rendering: auto;
    user-select: none;
    pointer-events: none;
  }

  .viewport {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid var(--fusion-sw-blue);
    background: color-mix(in srgb, var(--fusion-sw-blue) 10%, transparent);
    box-shadow: var(--fusion-sw-halo-soft);
    pointer-events: none;
  }

  .marker {
    position: absolute;
    display: block;
    padding: 0;
    box-sizing: border-box;
    /* Positioned by centre — the layout math returns the token's centre. */
    transform: translate(-50%, -50%);
    border-radius: 50%;
    border: 1px solid rgb(0 0 0 / 60%);
    background: var(--marker-color);
    pointer-events: none;
  }

  .marker.mine {
    border: 1px solid var(--fusion-sw-ink);
    box-shadow: 0 0 0 1px rgb(0 0 0 / 70%);
    cursor: pointer;
    pointer-events: auto;
  }
  .marker.mine:focus-visible {
    outline: 2px solid var(--fusion-sw-blue);
    outline-offset: 2px;
  }

  /* Hidden tokens only ever reach a GM's list; drawn hollow so "the players
     cannot see this one" is legible at a glance (REQ-MMT-005). */
  .marker.hidden-token {
    background: transparent;
    border: 1px dashed var(--marker-color);
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 8px 0 10px;
    font: 400 10px var(--fusion-sw-font-mono);
    letter-spacing: 0.04em;
    color: var(--fusion-sw-dim);
  }

  .empty {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--fusion-sw-ink);
  }
</style>
