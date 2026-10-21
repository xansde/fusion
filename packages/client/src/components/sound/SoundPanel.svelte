<script lang="ts">
  /**
   * SoundPanel.svelte — Ambient table track sidebar panel (M3 mapa-som).
   *
   * The "Som" tab of the side drawer (spec 36), visible to EVERYONE:
   *   - Everyone: current track name (or silence), a local volume slider
   *     (0–100%, persisted in localStorage — never sent to the server), and a
   *     clickable "click to enable sound" notice when the browser's autoplay
   *     policy is blocking playback.
   *   - GM only: quick-pick list of the world's audio tracks (the ones used
   *     before first) that switch the table's track with one click — the audio
   *     cross-fades — plus "Choose track" (FilePicker scoped to audio, which
   *     also uploads) and Stop.
   *
   * All state lives in soundStore.svelte.ts; the Howl instance lives in
   * ambientPlayer.ts (wired reactively by the store, not from here).
   *
   * Spec 13 REQ-AUD-020..046. Contract: packages/shared/src/sound/types.ts.
   */

  import { onMount } from "svelte";
  import {
    soundStore,
    soundActions,
    extractAmbientSrc,
    orderQuickTracks,
  } from "../../lib/sound/soundStore.svelte.js";
  import { OpError } from "../../lib/docs/sendOp.js";
  import FilePicker from "../../lib/components/assets/FilePicker.svelte";
  import { listAssets } from "../../lib/assets/assetApi.js";
  import { fusionApi } from "../../lib/api.js";
  import { t } from "../../lib/i18n/i18n.js";
  import type { SidebarPanelProps } from "../../lib/sidebar/registry.js";

  const { socket, isGm }: SidebarPanelProps = $props();

  // ---- Derived state ----

  const trackName = $derived(soundStore.track?.src ?? null);
  const volumePercent = $derived(Math.round(soundStore.volume * 100));
  // Non-intrusive by design (REQ-AUD-044): only a badge, never a blocking
  // modal — and only shown when there is actually something to unlock for.
  const showUnlockBadge = $derived(!soundStore.unlocked && soundStore.track !== null);

  // ---- Quick picks (GM): the world's audio files, used-before first ----

  let library = $state<string[]>([]);
  const quickTracks = $derived(orderQuickTracks(library, soundStore.recent));

  async function loadLibrary(): Promise<void> {
    const token = fusionApi.getToken();
    if (!isGm || !token) return;
    try {
      const entries = await listAssets(token);
      library = entries.filter((e) => e.mime_type.startsWith("audio/")).map((e) => e.name);
    } catch {
      // The quick list is a convenience; "Choose track" still works.
    }
  }

  onMount(() => {
    void loadLibrary();
  });

  // ---- Local state (GM only) ----

  // FilePicker's onSelect only STAGES a candidate — it does not call
  // soundActions.play() itself. The GM confirms with the explicit Play
  // button below, which also doubles as "restart the current track"
  // when nothing new has been picked (effectiveSrc falls back to the
  // currently-playing src).
  let selectedSrc = $state<string | null>(null);
  const effectiveSrc = $derived(selectedSrc ?? soundStore.track?.src ?? null);
  const hasPendingSelection = $derived(selectedSrc !== null && selectedSrc !== soundStore.track?.src);

  let showFilePicker = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  // ---- Handlers ----

  function handleVolumeInput(e: Event): void {
    const raw = Number((e.target as HTMLInputElement).value);
    soundActions.setVolume(raw / 100);
  }

  function handleFilePicked(path: string): void {
    const src = extractAmbientSrc(path);
    if (!src) {
      error = t("FUSION.Sound.InvalidAsset");
      return;
    }
    error = null;
    selectedSrc = src;
  }

  async function handlePlay(override?: string): Promise<void> {
    const src = override ?? effectiveSrc;
    if (!src || busy) return;
    busy = true;
    error = null;
    try {
      await soundActions.play(socket, src);
      // sound:state broadcast will echo this back into soundStore.track —
      // clear the pending selection now that it has been committed.
      selectedSrc = null;
    } catch (err) {
      const message = err instanceof OpError ? err.message : t("FUSION.Sound.UnexpectedError");
      error = t("FUSION.Sound.PlayFailed", { message });
    } finally {
      busy = false;
    }
  }

  async function handleStop(): Promise<void> {
    if (busy) return;
    busy = true;
    error = null;
    try {
      await soundActions.stop(socket);
    } catch (err) {
      const message = err instanceof OpError ? err.message : t("FUSION.Sound.UnexpectedError");
      error = t("FUSION.Sound.StopFailed", { message });
    } finally {
      busy = false;
    }
  }
</script>

<div class="sound-panel">
  <header class="sound-panel__header">
    <span class="sound-panel__title">{t("FUSION.Sound.Title")}</span>
  </header>

  <div class="sound-panel__body">
    <!-- ---- Now playing ---- -->
    <div class="sound-panel__now-playing">
      <span class="sound-panel__now-playing-label">{t("FUSION.Sound.NowPlaying")}</span>
      <span class="sound-panel__now-playing-value" title={trackName ?? undefined}>
        {trackName ?? t("FUSION.Sound.Silence")}
      </span>
    </div>

    {#if showUnlockBadge}
      <button
        class="sound-panel__unlock-badge"
        type="button"
        data-testid="sound-unlock"
        onclick={() => void soundActions.unlock()}
      >
        {t("FUSION.Sound.UnlockBadge")}
      </button>
    {/if}

    <!-- ---- Volume (everyone) ---- -->
    <div class="sound-panel__volume">
      <label class="sound-panel__volume-label" for="sound-panel-volume">
        {t("FUSION.Sound.Volume")}
      </label>
      <div class="sound-panel__volume-row">
        <input
          id="sound-panel-volume"
          type="range"
          min="0"
          max="100"
          step="1"
          value={volumePercent}
          oninput={handleVolumeInput}
          aria-valuenow={volumePercent}
          aria-valuemin={0}
          aria-valuemax={100}
        />
        <span class="sound-panel__volume-pct">{volumePercent}%</span>
      </div>
    </div>

    {#if isGm && quickTracks.length > 0}
      <div class="sound-panel__quick" data-testid="sound-quick">
        <span class="sound-panel__quick-label">{t("FUSION.Sound.Favorites")}</span>
        <ul class="sound-panel__quick-list">
          {#each quickTracks as name (name)}
            <li>
              <button
                class="sound-panel__quick-item"
                class:sound-panel__quick-item--active={name === trackName}
                type="button"
                title={name}
                disabled={busy}
                onclick={() => void handlePlay(name)}
              >
                {name}
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if isGm && hasPendingSelection}
      <div class="sound-panel__pending" title={selectedSrc ?? undefined}>
        {t("FUSION.Sound.Selected", { name: selectedSrc ?? "" })}
      </div>
    {/if}

    {#if error}
      <div class="sound-panel__error" role="alert">{error}</div>
    {/if}

    <!-- ---- GM controls ---- -->
    {#if isGm}
      <div class="sound-panel__gm-controls">
        <button
          class="btn btn--ghost btn--sm"
          type="button"
          onclick={() => { showFilePicker = true; }}
          disabled={busy}
        >
          {t("FUSION.Sound.ChooseTrack")}
        </button>
        <button
          class="btn btn--primary btn--sm"
          type="button"
          onclick={() => void handlePlay()}
          disabled={busy || !effectiveSrc}
          title={t("FUSION.Sound.PlayTitle")}
        >
          {t("FUSION.Sound.Play")}
        </button>
        <button
          class="btn btn--ghost btn--sm"
          type="button"
          onclick={handleStop}
          disabled={busy || !trackName}
        >
          {t("FUSION.Sound.Stop")}
        </button>
      </div>
    {/if}
  </div>
</div>

{#if showFilePicker && isGm}
  <FilePicker
    category="audio"
    token={fusionApi.getToken() ?? ""}
    kinds={["audio"]}
    onSelect={handleFilePicked}
    onClose={() => {
      showFilePicker = false;
      void loadLibrary();
    }}
  />
{/if}

<style>
  .sound-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ---- Header ---- */
  .sound-panel__header {
    align-items: center;
    border-bottom: 1px solid var(--fusion-border);
    display: flex;
    flex-shrink: 0;
    gap: 0.5rem;
    justify-content: space-between;
    padding: 0.6rem 0.75rem;
  }

  .sound-panel__title {
    color: var(--fusion-text);
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  /* ---- Body ---- */
  .sound-panel__body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    overflow-y: auto;
    padding: 0.75rem;
  }

  /* ---- Now playing ---- */
  .sound-panel__now-playing {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .sound-panel__now-playing-label {
    color: var(--fusion-text-subtle);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .sound-panel__now-playing-value {
    color: var(--fusion-text);
    font-size: 0.875rem;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ---- Unlock badge — non-intrusive, never a blocking modal (REQ-AUD-044) ---- */
  .sound-panel__quick {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .sound-panel__quick-label {
    color: var(--fusion-text-subtle);
    font-size: 0.7rem;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .sound-panel__quick-list {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .sound-panel__quick-item {
    background: transparent;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: 0.8125rem;
    overflow: hidden;
    padding: 0.3rem 0.6rem;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
  }

  .sound-panel__quick-item:hover:not(:disabled) {
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
  }

  .sound-panel__quick-item--active {
    border-color: var(--fusion-accent);
    color: var(--fusion-text);
  }

  .sound-panel__unlock-badge {
    cursor: pointer;
    font-family: var(--fusion-font);
    text-align: left;
    background: rgba(255, 215, 0, 0.12);
    border: 1px solid #ffd700;
    border-radius: var(--fusion-radius-sm);
    color: #ffd700;
    font-size: 0.75rem;
    padding: 0.4rem 0.6rem;
  }

  /* ---- Pending selection (GM staged a track via FilePicker, not yet sent) ---- */
  .sound-panel__pending {
    color: var(--fusion-text-muted);
    font-size: 0.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ---- Volume ---- */
  .sound-panel__volume {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .sound-panel__volume-label {
    color: var(--fusion-text-subtle);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .sound-panel__volume-row {
    align-items: center;
    display: flex;
    gap: 0.5rem;
  }

  .sound-panel__volume-row input[type="range"] {
    accent-color: var(--fusion-accent);
    flex: 1;
  }

  .sound-panel__volume-pct {
    color: var(--fusion-text-muted);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    min-width: 2.5rem;
    text-align: right;
  }

  /* ---- Error ---- */
  .sound-panel__error {
    color: var(--fusion-danger);
    font-size: 0.75rem;
  }

  /* ---- GM controls ---- */
  .sound-panel__gm-controls {
    border-top: 1px solid var(--fusion-border);
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    padding-top: 0.6rem;
  }

  /* ---- Buttons (self-contained — same tokens as sibling panels) ---- */
  .btn {
    align-items: center;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    display: inline-flex;
    font-family: var(--fusion-font);
    font-size: 0.875rem;
    font-weight: 500;
    justify-content: center;
    padding: 0.5rem 1.25rem;
    transition: background-color var(--fusion-transition), opacity var(--fusion-transition);
    white-space: nowrap;
  }

  .btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .btn--primary {
    background: var(--fusion-accent);
    color: #fff;
  }

  .btn--primary:hover:not(:disabled) {
    background: var(--fusion-accent-hover);
  }

  .btn--ghost {
    background: transparent;
    border-color: var(--fusion-border);
    color: var(--fusion-text-muted);
  }

  .btn--ghost:hover:not(:disabled) {
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
  }

  .btn--sm {
    font-size: 0.8125rem;
    padding: 0.3rem 0.75rem;
  }
</style>
