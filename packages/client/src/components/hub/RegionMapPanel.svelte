<script lang="ts">
  /**
   * RegionMapPanel.svelte — the Mapa panel of the System Window.
   *
   * Spec: 34 (DEC-MREG-08, REQ-MREG-025..030), 28 (the Hub).
   *
   * The map the table consults: one image, pins on it, and the conversation
   * about each place. It is NOT the active scene — opening it does not move
   * anybody, and closing it leaves the battle map exactly where it was. That
   * is the whole reason the map stopped being a Scene.
   *
   * Everything that is not layout lives in `lib/hub/regionMapStore.svelte.ts`
   * so the client's node-environment test runner can reach it. This file turns
   * documents into elements and clicks into ops.
   *
   * Zoom and pan are CSS transforms over a plain `<img>` rather than a canvas:
   * the pins are DOM buttons, which is what makes them focusable, hoverable
   * and reachable by keyboard for free. A region map is a picture with a few
   * dozen markers, not a scene graph.
   */

  import { onMount, onDestroy } from "svelte";
  import { OwnershipLevel, type MapPin } from "@fusion/shared";
  import { session, getSocket } from "$lib/session.svelte.js";
  import { fusionApi } from "$lib/api.js";
  import { resolveAssetUrl } from "$lib/assets/assetApi.js";
  import { HUB_SURFACE_CLASS } from "$lib/hub/layers.js";
  import {
    regionMapStore,
    createRegionMap,
    updateRegionMap,
    createPin,
    updatePin,
    deletePin,
    revealPin,
    commentOnPin,
    listTablePlayers,
    levelFor,
    readPin,
    isHiddenFromTable,
    type TablePlayer,
  } from "$lib/hub/regionMapStore.svelte.js";
  import FilePicker from "../assets/FilePicker.svelte";

  const userId = $derived(session.user?.id ?? "");
  const role = $derived(session.user?.role ?? 0);
  const isGm = $derived(role >= 3);

  const map = $derived(regionMapStore.selected);
  const openPin = $derived(regionMapStore.openPin);

  /** Terrain image with a fresh short-lived asset token (they expire in 5min). */
  let imageUrl = $state<string | null>(null);

  /** Camera over the image: scale, and translation in percent of the frame. */
  let zoom = $state(1);
  let panX = $state(0);
  let panY = $state(0);
  let dragging = $state(false);
  let dragMoved = $state(false);
  let lastPointer = { x: 0, y: 0 };

  /** True while the next click on the map drops a pin instead of panning. */
  let placing = $state(false);

  let showPicker = $state(false);
  let busy = $state(false);
  let errorMessage = $state<string | null>(null);
  let draftComment = $state("");
  let players = $state<TablePlayer[]>([]);

  let imageEl = $state<HTMLImageElement | null>(null);

  onMount(() => {
    regionMapStore.attach();
    players = listTablePlayers();
  });
  onDestroy(() => {
    regionMapStore.detach();
  });

  /**
   * Resolve the terrain image whenever it changes.
   *
   * The stored path carries no token — one would have expired long before the
   * document was read back — so a fresh one is minted here, which is exactly
   * what `resolveAssetUrl` exists for.
   */
  $effect(() => {
    const path = map?.image ?? null;
    if (path === null || path === "") {
      imageUrl = null;
      return;
    }
    const token = fusionApi.getToken();
    if (token === null || userId === "") return;
    let cancelled = false;
    void resolveAssetUrl(path, token, userId).then((url) => {
      if (!cancelled) imageUrl = url;
    });
    return () => {
      cancelled = true;
    };
  });

  /** Pins as the local viewer reads them, with their placement style. */
  const drawnPins = $derived(
    (map?.pins ?? []).map((pin) => ({
      pin,
      reading: readPin(pin, userId, role),
      dim: isGm && isHiddenFromTable(pin),
    })),
  );

  async function run(action: () => Promise<void>): Promise<void> {
    busy = true;
    errorMessage = null;
    try {
      await action();
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  function socketOrThrow() {
    const socket = getSocket();
    if (!socket) throw new Error("sem conexão com o servidor");
    return socket;
  }

  // -- camera ---------------------------------------------------------------

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    const next = zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15);
    zoom = Math.min(6, Math.max(1, next));
    if (zoom === 1) {
      panX = 0;
      panY = 0;
    }
  }

  /** Movement, in pixels, that turns a press into a drag rather than a click. */
  const DRAG_THRESHOLD_PX = 3;

  function onPointerDown(event: PointerEvent): void {
    if (placing) return;
    dragging = true;
    dragMoved = false;
    lastPointer = { x: event.clientX, y: event.clientY };
    // NOT captured here, deliberately. Capturing on press redirects every
    // later pointer event — including the one that becomes `click` — to the
    // frame, so a click on a pin never reached the pin's own button and the
    // only way to open a place was to focus it and press Enter. The capture
    // now happens on the first real movement, below, where it is actually
    // needed (to keep panning while the cursor leaves the frame).
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragging) return;
    const dx = event.clientX - lastPointer.x;
    const dy = event.clientY - lastPointer.y;
    if (!dragMoved && Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD_PX) {
      dragMoved = true;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }
    if (!dragMoved) return;
    lastPointer = { x: event.clientX, y: event.clientY };
    panX += dx;
    panY += dy;
  }

  function onPointerUp(event: PointerEvent): void {
    dragging = false;
    const frame = event.currentTarget as HTMLElement;
    if (frame.hasPointerCapture(event.pointerId)) frame.releasePointerCapture(event.pointerId);
  }

  function resetCamera(): void {
    zoom = 1;
    panX = 0;
    panY = 0;
  }

  // -- pins -----------------------------------------------------------------

  /**
   * Drop a pin where the user clicked.
   *
   * The click is measured against the IMAGE element rather than the frame, so
   * zoom and pan cancel out on their own — the same click lands on the same
   * place at any camera. The handler sits on the stage rather than on the
   * `<img>` itself: an image with a click handler is a control screen readers
   * cannot reach, and the stage is already marked presentational.
   */
  function onStageClick(event: MouseEvent): void {
    if (!placing || map === null || dragMoved || imageEl === null) return;
    const rect = imageEl.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    placing = false;
    void run(async () => {
      await createPin(socketOrThrow(), map._id, { x, y, text: "Novo pino" });
    });
  }

  function openDetails(pin: MapPin): void {
    if (dragMoved) return;
    regionMapStore.openPinId = pin._id;
    draftComment = "";
  }

  function mayEdit(pin: MapPin): boolean {
    return isGm || (pin.kind === "player" && pin.authorId === userId);
  }

  function renamePin(pin: MapPin, event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).value;
    if (map === null) return;
    void run(async () => {
      await updatePin(socketOrThrow(), map._id, pin._id, { text: value });
    });
  }

  function describePin(pin: MapPin, event: Event): void {
    const value = (event.currentTarget as HTMLTextAreaElement).value;
    if (map === null) return;
    void run(async () => {
      await updatePin(socketOrThrow(), map._id, pin._id, { description: value });
    });
  }

  function removePin(pin: MapPin): void {
    if (map === null) return;
    void run(async () => {
      await deletePin(socketOrThrow(), map._id, pin._id);
      regionMapStore.openPinId = null;
    });
  }

  function reveal(pin: MapPin, player: TablePlayer, level: OwnershipLevel): void {
    if (map === null) return;
    void run(async () => {
      await revealPin(socketOrThrow(), map._id, pin._id, [player.id], level);
    });
  }

  function revealToTable(pin: MapPin, level: OwnershipLevel): void {
    if (map === null) return;
    void run(async () => {
      await revealPin(socketOrThrow(), map._id, pin._id, [], level);
    });
  }

  function submitComment(pin: MapPin): void {
    const text = draftComment.trim();
    if (text === "" || map === null) return;
    void run(async () => {
      await commentOnPin(socketOrThrow(), map._id, pin._id, text);
      draftComment = "";
    });
  }

  // -- the map itself (GM) --------------------------------------------------

  function newMap(): void {
    void run(async () => {
      const id = await createRegionMap(socketOrThrow(), { name: "Novo mapa" });
      regionMapStore.select(id);
      showPicker = true;
    });
  }

  /**
   * Point the map at an uploaded image.
   *
   * The natural size is measured here rather than trusted from anywhere: it is
   * what an exported package carries so a replacement image can be checked
   * against the same aspect ratio.
   */
  function chooseImage(path: string): void {
    showPicker = false;
    if (map === null) return;
    const probe = new Image();
    probe.onload = () => {
      void run(async () => {
        await updateRegionMap(socketOrThrow(), map._id, {
          image: path,
          imageWidth: probe.naturalWidth,
          imageHeight: probe.naturalHeight,
        });
      });
    };
    probe.onerror = () => {
      void run(async () => {
        await updateRegionMap(socketOrThrow(), map._id, { image: path });
      });
    };
    const token = fusionApi.getToken();
    if (token !== null && userId !== "") {
      void resolveAssetUrl(path, token, userId).then((url) => {
        probe.src = url;
      });
    } else {
      probe.src = path;
    }
  }

  function renameMap(event: Event): void {
    const value = (event.currentTarget as HTMLInputElement).value;
    if (map === null) return;
    void run(async () => {
      await updateRegionMap(socketOrThrow(), map._id, { name: value });
    });
  }

  const levelLabel: Record<number, string> = {
    [OwnershipLevel.NONE]: "oculto",
    [OwnershipLevel.LIMITED]: "rumor",
    [OwnershipLevel.OBSERVER]: "revelado",
  };
</script>

<div class="panel {HUB_SURFACE_CLASS}">
  <!-- ---------------------------------------------------------------- -->
  <!-- Toolbar                                                          -->
  <!-- ---------------------------------------------------------------- -->
  <div class="toolbar">
    {#if regionMapStore.maps.length > 1}
      <select
        class="control"
        value={map?._id ?? ""}
        onchange={(e) => regionMapStore.select((e.currentTarget as HTMLSelectElement).value)}
      >
        {#each regionMapStore.maps as candidate (candidate._id)}
          <option value={candidate._id}>{candidate.name}</option>
        {/each}
      </select>
    {:else if map}
      <span class="map-name">{map.name}</span>
    {/if}

    <span class="spacer"></span>

    {#if map}
      <button
        class="control"
        class:armed={placing}
        type="button"
        disabled={busy}
        onclick={() => (placing = !placing)}
      >
        {placing ? "clique no mapa…" : "+ pino"}
      </button>
      <button class="control" type="button" onclick={resetCamera} disabled={zoom === 1}>
        centralizar
      </button>
    {/if}

    {#if isGm}
      {#if map}
        <button class="control" type="button" onclick={() => (showPicker = true)}>
          imagem
        </button>
      {/if}
      <button class="control" type="button" onclick={newMap} disabled={busy}>+ mapa</button>
    {/if}
  </div>

  {#if errorMessage}
    <p class="error">{errorMessage}</p>
  {/if}

  <!-- ---------------------------------------------------------------- -->
  <!-- The map                                                          -->
  <!-- ---------------------------------------------------------------- -->
  {#if map === null}
    <p class="empty">
      {#if isGm}
        Nenhum mapa ainda. <strong>+ mapa</strong> cria um e abre a escolha da imagem.
      {:else}
        O mestre ainda não abriu um mapa para a mesa.
      {/if}
    </p>
  {:else}
    <div
      class="frame"
      role="presentation"
      onwheel={onWheel}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerUp}
      class:grabbing={dragging}
      class:placing
    >
      <div
        class="stage"
        role="presentation"
        style="transform: translate({panX}px, {panY}px) scale({zoom})"
        onclick={onStageClick}
      >
        {#if imageUrl}
          <img class="terrain" src={imageUrl} alt={map.name} draggable="false" bind:this={imageEl} />
        {:else}
          <div class="no-image">
            {isGm ? "Escolha uma imagem para este mapa." : "Mapa sem imagem."}
          </div>
        {/if}

        {#each drawnPins as entry (entry.pin._id)}
          <button
            class="pin"
            class:rumour={entry.reading === "rumour"}
            class:player={entry.pin.kind === "player"}
            class:dim={entry.dim}
            class:open={entry.pin._id === regionMapStore.openPinId}
            style="left: {entry.pin.x * 100}%; top: {entry.pin.y * 100}%; transform: translate(-50%, -50%) scale({1 /
              zoom})"
            type="button"
            title={entry.reading === "rumour" ? "algo aqui" : entry.pin.text}
            onclick={(e) => {
              e.stopPropagation();
              openDetails(entry.pin);
            }}
          >
            <span class="glyph">
              {entry.reading === "rumour" ? "?" : entry.pin.icon || (entry.pin.kind === "player" ? "✦" : "◆")}
            </span>
            {#if entry.reading === "known" && entry.pin.text}
              <span class="label">{entry.pin.text}</span>
            {/if}
          </button>
        {/each}
      </div>
    </div>

    <!-- -------------------------------------------------------------- -->
    <!-- Pin details                                                    -->
    <!-- -------------------------------------------------------------- -->
    {#if openPin}
      {@const pin = openPin}
      <div class="details">
        <div class="details-head">
          {#if mayEdit(pin)}
            <input
              class="title-input"
              value={pin.text}
              onchange={(e) => renamePin(pin, e)}
              aria-label="Nome do pino"
            />
          {:else}
            <span class="title">{pin.text}</span>
          {/if}
          <button
            class="control"
            type="button"
            onclick={() => (regionMapStore.openPinId = null)}
            aria-label="Fechar detalhes">×</button
          >
        </div>

        {#if pin.kind === "player"}
          <p class="byline">pino de {pin.authorName}</p>
        {/if}

        {#if mayEdit(pin)}
          <textarea
            class="description-input"
            rows="2"
            placeholder="Descrição (opcional)"
            value={pin.description}
            onchange={(e) => describePin(pin, e)}
          ></textarea>
        {:else if pin.description}
          <p class="description">{pin.description}</p>
        {/if}

        <!-- Comments — the table's conversation about this place. -->
        <div class="comments">
          {#each pin.comments as comment (comment._id)}
            <p class="comment">
              <span class="author">{comment.authorName}</span>
              <span class="text">{comment.text}</span>
            </p>
          {:else}
            <p class="comment empty-comment">Ninguém comentou ainda.</p>
          {/each}
        </div>

        <form
          class="comment-form"
          onsubmit={(e) => {
            e.preventDefault();
            submitComment(pin);
          }}
        >
          <input
            class="comment-input"
            bind:value={draftComment}
            placeholder="Comentar…"
            maxlength="2000"
            aria-label="Comentar neste pino"
          />
          <button class="control" type="submit" disabled={busy || draftComment.trim() === ""}>
            enviar
          </button>
        </form>

        {#if isGm}
          <div class="reveal">
            <span class="reveal-label">Revelação</span>
            <div class="reveal-row">
              <span class="who">todos</span>
              {#each [OwnershipLevel.NONE, OwnershipLevel.LIMITED, OwnershipLevel.OBSERVER] as level (level)}
                <button
                  class="control tiny"
                  type="button"
                  disabled={busy}
                  onclick={() => revealToTable(pin, level)}>{levelLabel[level]}</button
                >
              {/each}
            </div>
            {#each players as player (player.id)}
              <div class="reveal-row">
                <span class="who">{player.name}</span>
                {#each [OwnershipLevel.NONE, OwnershipLevel.LIMITED, OwnershipLevel.OBSERVER] as level (level)}
                  <button
                    class="control tiny"
                    class:on={levelFor(pin, player.id) === level}
                    type="button"
                    disabled={busy}
                    onclick={() => reveal(pin, player, level)}>{levelLabel[level]}</button
                  >
                {/each}
              </div>
            {/each}
          </div>
        {/if}

        {#if mayEdit(pin)}
          <button class="control danger" type="button" onclick={() => removePin(pin)}>
            remover pino
          </button>
        {/if}
      </div>
    {/if}

    {#if isGm && map}
      <div class="map-meta">
        <input
          class="map-name-input"
          value={map.name}
          onchange={renameMap}
          aria-label="Nome do mapa"
        />
      </div>
    {/if}
  {/if}
</div>

{#if showPicker}
  <FilePicker
    token={fusionApi.getToken() ?? ""}
    onSelect={chooseImage}
    onClose={() => (showPicker = false)}
  />
{/if}

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .spacer {
    flex: 1;
  }

  .map-name {
    font-size: 11px;
    letter-spacing: var(--fusion-sw-track-label);
    text-transform: uppercase;
    color: var(--fusion-sw-ink);
  }

  .control {
    padding: 4px 9px;
    border: 1px solid var(--fusion-sw-line);
    background: var(--fusion-sw-fill);
    color: var(--fusion-sw-ink);
    font: 600 10px var(--fusion-sw-font);
    letter-spacing: var(--fusion-sw-track-label);
    text-transform: uppercase;
    cursor: pointer;
    transition: var(--fusion-sw-transition);
  }
  .control:hover:not(:disabled) {
    background: var(--fusion-sw-fill-active);
  }
  .control:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .control.armed {
    border-color: var(--fusion-sw-gold);
    color: var(--fusion-sw-gold);
  }
  .control.on {
    border-color: var(--fusion-sw-blue);
    color: var(--fusion-sw-blue);
    background: var(--fusion-sw-fill-active);
  }
  .control.tiny {
    padding: 2px 6px;
    font-size: 9px;
  }
  .control.danger {
    align-self: flex-start;
    border-color: var(--fusion-sw-bad);
    color: var(--fusion-sw-bad);
  }

  .error {
    margin: 0;
    font-size: 11px;
    color: var(--fusion-sw-bad);
  }

  .empty {
    margin: 0;
    padding: 24px 8px;
    font-size: 12px;
    line-height: 1.6;
    color: var(--fusion-sw-dim);
    text-align: center;
  }

  /* The window onto the map. Overflow is hidden so panning cannot push the
     image over the panel's chrome — and `resize` needs a non-visible overflow
     to offer its handle at all, which is how the frame gets a drag corner.

     `height` rather than `max-height`: the browser writes the dragged size
     into the element's own height, and a max-height cap would silently undo
     the drag past that point. */
  .frame {
    position: relative;
    overflow: hidden;
    height: 46vh;
    min-height: 160px;
    resize: vertical;
    border: 1px solid var(--fusion-sw-line);
    background: #05121a;
    touch-action: none;
    cursor: grab;

    /* Centres the picture in whatever height the frame currently has, so
       resizing reframes the map instead of cropping it from the top. */
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .frame.grabbing {
    cursor: grabbing;
  }
  .frame.placing {
    cursor: crosshair;
  }

  /* The stage is exactly the size of the picture — never of the frame around
     it. Pins are placed in percent of this box, so the two have to be the same
     rectangle or every pin would drift as the frame is resized. */
  .stage {
    position: relative;
    transform-origin: center center;
    max-width: 100%;
    max-height: 100%;
  }

  .terrain {
    display: block;
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    user-select: none;
    -webkit-user-drag: none;
  }

  .no-image {
    width: 280px;
    height: 160px;
    display: grid;
    place-items: center;
    padding: 0 16px;
    font-size: 11px;
    text-align: center;
    color: var(--fusion-sw-dim);
  }

  /* A pin is a DOM button so it is focusable and hoverable for free. Its
     inverse scale keeps it the same size on screen at any zoom — the world
     scales, the interface does not (DEC-MREG-04). */
  .pin {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    transform-origin: center center;
  }

  .glyph {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid #1b1a24;
    background: #f2e2c4;
    color: #1b1a24;
    font-size: 12px;
    line-height: 1;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
  }

  .pin.rumour .glyph {
    background: #8d7fb8;
    color: #f7f3ff;
  }

  .pin.player .glyph {
    background: #57c8ff;
    color: #04202c;
  }

  /* GM affordance: a pin nobody can see yet reads as a draft. */
  .pin.dim {
    opacity: 0.45;
  }

  .pin.open .glyph {
    outline: 2px solid var(--fusion-sw-gold);
    outline-offset: 2px;
  }

  .label {
    font: 600 10px var(--fusion-sw-font);
    color: #f2e2c4;
    text-shadow:
      0 0 3px #000,
      0 1px 2px #000;
    white-space: nowrap;
  }

  .details {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--fusion-sw-line);
    background: var(--fusion-sw-fill);
  }

  .details-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .title,
  .title-input {
    flex: 1;
    font: 700 12px var(--fusion-sw-font);
    letter-spacing: var(--fusion-sw-track-label);
    color: var(--fusion-sw-ink);
  }

  .title-input,
  .description-input,
  .comment-input,
  .map-name-input {
    padding: 4px 6px;
    border: 1px solid var(--fusion-sw-line);
    background: rgba(0, 0, 0, 0.25);
    color: var(--fusion-sw-ink);
    font-family: var(--fusion-sw-font);
    font-size: 12px;
  }

  .description-input {
    resize: vertical;
  }

  .byline {
    margin: 0;
    font-size: 10px;
    letter-spacing: var(--fusion-sw-track-label);
    text-transform: uppercase;
    color: var(--fusion-sw-dim);
  }

  .description {
    margin: 0;
    font-size: 12px;
    line-height: 1.55;
    color: var(--fusion-sw-ink);
  }

  .comments {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-height: 120px;
    overflow-y: auto;
  }

  .comment {
    margin: 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--fusion-sw-ink);
  }

  .comment .author {
    color: var(--fusion-sw-blue);
    font-weight: 700;
    margin-right: 6px;
  }

  .empty-comment {
    color: var(--fusion-sw-dim);
    font-style: italic;
  }

  .comment-form {
    display: flex;
    gap: 6px;
  }

  .comment-input {
    flex: 1;
  }

  .reveal {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 6px;
    border-top: 1px dashed var(--fusion-sw-line);
  }

  .reveal-label {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: var(--fusion-sw-track-title);
    text-transform: uppercase;
    color: var(--fusion-sw-dim);
  }

  .reveal-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .who {
    width: 96px;
    font-size: 11px;
    color: var(--fusion-sw-ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .map-meta {
    display: flex;
    gap: 6px;
  }

  .map-name-input {
    flex: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .control {
      transition: none;
    }
  }
</style>
