<script lang="ts">
  /**
   * CompendiumPreviewWindow.svelte — the preview of one compendium document
   * (spec 43 §5.6), mounted by `WindowHost` inside a floating window.
   *
   * It is a WINDOW and not a blade inside the drawer (DEC-CPD-03,
   * REQ-CPD-050): the list it was opened from stays exactly where it was, and
   * two of these can sit side by side while the reader compares two creatures
   * (REQ-CPD-054). Nothing here knows about the drawer — closing the drawer
   * therefore cannot close this, because no lifetime links them.
   *
   * The document is loaded on demand, once, when the window mounts
   * (REQ-CPD-051, REQ-CMP-015): the index line that opened it carries no prose
   * and no full system data (DEC-CMP-02). The three states are drawn honestly —
   * loading, failed with another try, and loaded — and a failure never closes
   * the window nor touches the list behind it.
   *
   * The socket is resolved live at load time rather than captured when the
   * window opened: a reconnection while the window stays open would otherwise
   * leave the retry button talking to a dead socket.
   *
   * The license block (REQ-CPD-052, DEC-CPD-07) is always drawn — the pack's
   * license, and the document's own only when it says something different. It
   * is the reason this project is clean-room, so "no space" is never a reason
   * to drop it: it is a block of its own, above the fold of the body, and it
   * wraps instead of truncating.
   *
   * Bringing the entry over (REQ-CPD-053) is offered here under the same rule
   * as on the line that opened the window — the caller passes the permission it
   * already resolved, and this window never widens it.
   */

  import type { PackLicense } from "@fusion/shared";
  import {
    buildPreviewLicense,
    hasLicenseOverride,
    previewError,
    previewReady,
    shouldResetToLoading,
    PREVIEW_LOADING,
    type PreviewLoadState,
  } from "../../lib/compendium/previewWindow.js";
  import { buildDocumentPreview, isKnownPlaceholderImg } from "../../lib/compendium/compendiumBrowser.js";
  import { resolveFieldLabel } from "../../lib/compendium/resultLine.js";
  import {
    getDocument,
    importToActor,
    importToWorld,
    requireConnectedSocket,
  } from "../../lib/compendium/compendiumApi.js";
  import { getSocket } from "../../lib/session.svelte.js";
  import { i18n, t } from "../../lib/i18n/i18n.js";

  interface Props {
    /** Compendium uuid of the document to show — the window's identity. */
    uuid: string;
    /** Name the line showed, used until the document itself arrives. */
    name: string;
    /** Document type of the entry, for the fallback glyph. */
    documentType?: string;
    /** Pack the entry belongs to. */
    packId?: string;
    /** Pack label, when the caller knew it. */
    packLabel?: string | null;
    /** The pack's license block (REQ-CPD-052). */
    packLicense?: PackLicense | null;
    /** Whether this reader may bring the entry into the WORLD (REQ-CPD-053). */
    canImport?: boolean;
    /**
     * The sheet the line would have brought it into, when that is the
     * destination in force (DEC-CPD-05, REQ-CPD-061). Inherited from the panel:
     * the window resolves no ownership of its own, so its offer can never
     * disagree with the line's (REQ-CPD-053).
     */
    sheetTarget?: { actorId: string; name: string } | null;
    /**
     * State the window starts in. Defaults to `loading`, which is what makes it
     * fetch on mount; a caller that already holds the document may hand it over
     * instead of paying for a second round trip.
     */
    initialState?: PreviewLoadState;
  }

  const {
    uuid,
    name,
    packLabel = null,
    packLicense = null,
    canImport = false,
    sheetTarget = null,
    initialState = PREVIEW_LOADING,
  }: Props = $props();

  // Deliberately the INITIAL value only: after mount the window owns its state.
  // svelte-ignore state_referenced_locally
  let loadState = $state<PreviewLoadState>(initialState);
  let importing = $state(false);
  let importMessage = $state<string | null>(null);
  let importFailed = $state(false);
  let imgBroken = $state(false);

  /** Loaded document, or null while loading/failed. */
  const document = $derived(loadState.status === "ready" ? loadState.document : null);

  const preview = $derived(document ? buildDocumentPreview(document, i18n.locale) : null);

  /** The loaded name once it arrives, the line's name until then. */
  const displayName = $derived(preview?.name ?? name);

  /**
   * The license is built whether or not the document arrived: the pack half is
   * known from the moment the window opens, so a failed load still shows under
   * what terms the entry is published.
   */
  const license = $derived(buildPreviewLicense(packLicense, document));

  const showImage = $derived(
    preview !== null && preview.img !== null && !isKnownPlaceholderImg(preview.img) && !imgBroken,
  );

  // REQ-CPD-051: loaded on demand, once, when the window mounts.
  $effect(() => {
    if (loadState.status === "loading") void load();
  });

  // Bugfix A003 (retry path): `retry()` calls `load()` directly while
  // `loadState.status === "error"`, so the reset a few lines below DOES run
  // and writes `loadState` back to `PREVIEW_LOADING` — a real "error" →
  // "loading" change, which reschedules the mount `$effect`. That effect then
  // reads the new "loading" status and calls `load()` a SECOND time while
  // THIS call is still awaiting `getDocument()`: two `compendium:get`
  // requests race, and whichever resolves last silently decides the window's
  // final state (content vs. the error block) — non-deterministic, and it
  // contradicts REQ-CPD-051's "a failure is recoverable" (recovery is meant
  // to be one load, not a race). `loadInFlight` closes the gap: it is set
  // BEFORE the reassignment that can retrigger the effect, so the effect's
  // re-entrant call sees it already true and returns without a second fetch.
  let loadInFlight = false;

  async function load(): Promise<void> {
    if (loadInFlight) return;
    loadInFlight = true;
    try {
      // Bugfix A003: do NOT reassign `loadState` when it already reads
      // "loading" — the mount `$effect` below calls `load()` BECAUSE
      // `loadState.status === "loading"`, and writing it again (even to a
      // value describing the same status) is what turned that effect into an
      // infinite self-retriggering loop (`effect_update_depth_exceeded`, see
      // `shouldResetToLoading`'s doc comment). The retry button still gets a
      // real "error" → "loading" transition drawn.
      if (shouldResetToLoading(loadState)) {
        loadState = PREVIEW_LOADING;
      }
      imgBroken = false;
      const socket = requireConnectedSocket(getSocket());
      const result = await getDocument(socket, uuid);
      loadState = previewReady(result.document);
    } catch (err) {
      loadState = previewError(err, t("FUSION.Compendium.Preview.Failed"));
    } finally {
      loadInFlight = false;
    }
  }

  /** REQ-CPD-051: a failure is recoverable, and recovering never closes anything. */
  function retry(): void {
    void load();
  }

  /**
   * REQ-CPD-053: the same action the line offers, under the same permission —
   * including WHICH of the two doors of §5.7 it is. The world door is the
   * privileged one (REQ-CPD-060); the sheet door is the destination's owner's
   * (REQ-CPD-061), and both are re-checked by the server on arrival.
   */
  async function bringOver(): Promise<void> {
    if (importing) return;
    if (!canImport && !sheetTarget) return;
    importing = true;
    importMessage = null;
    importFailed = false;
    try {
      const socket = requireConnectedSocket(getSocket());
      if (sheetTarget && !canImport) {
        await importToActor(socket, [uuid], sheetTarget.actorId);
        importMessage = t("FUSION.Compendium.Import.ToSheetDone", {
          name: displayName,
          sheet: sheetTarget.name,
        });
      } else {
        await importToWorld(socket, [uuid]);
        importMessage = t("FUSION.Compendium.Preview.Imported", { name: displayName });
      }
    } catch (err) {
      importFailed = true;
      importMessage =
        err instanceof Error && err.message.length > 0
          ? err.message
          : t("FUSION.Compendium.Preview.ImportFailed");
    } finally {
      importing = false;
    }
  }
</script>

<div class="compendium-preview">
  {#if loadState.status === "loading"}
    <p class="compendium-preview__status" role="status">
      {t("FUSION.Compendium.Preview.Loading")}
    </p>
  {:else if loadState.status === "error"}
    <div class="compendium-preview__error" role="alert">
      <p class="compendium-preview__error-msg">{t("FUSION.Compendium.Preview.Failed")}</p>
      <p class="compendium-preview__error-detail">{loadState.message}</p>
      <button class="compendium-preview__retry" type="button" onclick={retry}>
        {t("FUSION.Compendium.Retry")}
      </button>
    </div>
  {:else if preview !== null}
    <div class="compendium-preview__head">
      <span class="compendium-preview__figure">
        {#if showImage && preview.img !== null}
          <img
            class="compendium-preview__img"
            src={preview.img}
            alt=""
            aria-hidden="true"
            onerror={() => {
              imgBroken = true;
            }}
          />
        {:else}
          <!-- Drawn, never a pictograph: an emoji changes shape per OS. -->
          <svg
            class="compendium-preview__icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M6 3h8l4 4v14H6V3Zm8 0v4h4M9 12h6M9 16h6" />
          </svg>
        {/if}
      </span>
      <div class="compendium-preview__titles">
        <h2 class="compendium-preview__name">{preview.name}</h2>
        {#if preview.nameSecondary !== null}
          <!-- The original name, so the reader can check the book (DEC-CPD-06). -->
          <span class="compendium-preview__name-original">{preview.nameSecondary}</span>
        {/if}
        <span class="compendium-preview__meta">
          {#if packLabel !== null}
            <span class="compendium-preview__pack">{packLabel}</span>
          {/if}
          {#if preview.type !== null}
            <span class="compendium-preview__type">{preview.type}</span>
          {/if}
        </span>
      </div>
    </div>

    {#if preview.description !== null}
      <p class="compendium-preview__description">{preview.description}</p>
    {/if}

    {#if preview.fields.length > 0}
      <dl class="compendium-preview__fields">
        {#each preview.fields as field (field.key)}
          <div class="compendium-preview__field">
            <dt class="compendium-preview__field-label">{resolveFieldLabel(field, t)}</dt>
            <dd class="compendium-preview__field-value">{field.value}</dd>
          </div>
        {/each}
      </dl>
    {/if}
  {/if}

  <!--
    REQ-CPD-052 / DEC-CPD-07: drawn in every state, including the failed one —
    the terms under which the entry is published do not depend on the document
    having arrived.
  -->
  <section class="compendium-preview__license" aria-label={t("FUSION.Compendium.Preview.License")}>
    <h3 class="compendium-preview__license-title">{t("FUSION.Compendium.Preview.License")}</h3>
    <p class="compendium-preview__license-line">
      <span class="compendium-preview__license-label">
        {t("FUSION.Compendium.Preview.LicensePack")}
      </span>
      <span class="compendium-preview__license-value">
        {license.packLicense ?? t("FUSION.Compendium.Preview.LicenseUnknown")}
      </span>
    </p>
    {#if hasLicenseOverride(license)}
      <p class="compendium-preview__license-line compendium-preview__license-line--override">
        <span class="compendium-preview__license-label">
          {t("FUSION.Compendium.Preview.LicenseDocument")}
        </span>
        <span class="compendium-preview__license-value">
          {license.documentLicense ?? license.documentTitle}
        </span>
        {#if license.documentLicense !== null && license.documentTitle !== null}
          <span class="compendium-preview__license-value">{license.documentTitle}</span>
        {/if}
      </p>
    {/if}
    {#if license.attribution.length > 0}
      <p class="compendium-preview__license-attribution">{license.attribution}</p>
    {/if}
    {#if license.reservedNotice.length > 0}
      <p class="compendium-preview__license-reserved">{license.reservedNotice}</p>
    {/if}
    {#if license.source !== null}
      <p class="compendium-preview__license-source">{license.source}</p>
    {/if}
  </section>

  {#if canImport || sheetTarget}
    <!-- REQ-CPD-053: same action as the line, same permission, no widening. -->
    <div class="compendium-preview__actions">
      <button
        class="compendium-preview__import"
        type="button"
        disabled={importing}
        onclick={() => void bringOver()}
      >
        {canImport
          ? t("FUSION.Compendium.Line.ImportShort")
          : t("FUSION.Compendium.Line.ImportToSheetShort")}
      </button>
    </div>
  {/if}

  {#if importMessage !== null}
    <p
      class="compendium-preview__import-msg"
      class:compendium-preview__import-msg--failed={importFailed}
      role={importFailed ? "alert" : "status"}
    >
      {importMessage}
    </p>
  {/if}
</div>

<style>
  /*
   * The window owns its size (the window manager sets it), so this body only
   * fills what it is given and scrolls its own overflow — the drawer is not
   * involved in any of it (REQ-GAV-012).
   */
  .compendium-preview {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    height: 100%;
    overflow-y: auto;
    padding: 0.6rem;
    font-size: 0.85rem;
    color: var(--fusion-text, #eee);
  }

  .compendium-preview__status,
  .compendium-preview__error-msg,
  .compendium-preview__error-detail {
    margin: 0;
  }

  .compendium-preview__error {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    color: var(--fusion-danger, #e06c6c);
  }

  .compendium-preview__error-detail {
    color: var(--fusion-text-muted, #9aa);
    font-size: 0.78rem;
  }

  .compendium-preview__retry {
    align-self: flex-start;
    background: var(--fusion-surface-alt, #2a2a2a);
    border: 1px solid var(--fusion-border, #444);
    border-radius: var(--fusion-radius-sm, 3px);
    color: var(--fusion-text, #eee);
    cursor: pointer;
    font: inherit;
    padding: 0.2rem 0.6rem;
  }

  .compendium-preview__head {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
  }

  .compendium-preview__figure {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 2.6rem;
    width: 2.6rem;
    color: var(--fusion-text-subtle, #778);
  }

  .compendium-preview__img,
  .compendium-preview__icon {
    height: 100%;
    width: 100%;
    object-fit: contain;
  }

  .compendium-preview__titles {
    min-width: 0;
  }

  .compendium-preview__name {
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
  }

  .compendium-preview__name-original {
    color: var(--fusion-text-muted, #9aa);
    display: block;
    font-size: 0.78rem;
  }

  .compendium-preview__meta {
    color: var(--fusion-text-subtle, #778);
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    font-size: 0.75rem;
  }

  .compendium-preview__description {
    margin: 0;
    white-space: pre-wrap;
  }

  .compendium-preview__fields {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin: 0;
  }

  .compendium-preview__field {
    display: flex;
    gap: 0.35rem;
  }

  .compendium-preview__field-label {
    color: var(--fusion-text-subtle, #778);
  }

  .compendium-preview__field-value {
    margin: 0;
  }

  /*
   * The license never truncates (DEC-CPD-07): it wraps and breaks long words
   * instead. No `text-overflow`, no `nowrap` — losing the end of a reserved
   * material notice is exactly the failure this project cannot afford.
   */
  .compendium-preview__license {
    border-top: 1px solid var(--fusion-border, #444);
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding-top: 0.4rem;
    font-size: 0.75rem;
    overflow-wrap: anywhere;
    white-space: normal;
  }

  .compendium-preview__license-title {
    color: var(--fusion-text-subtle, #778);
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    margin: 0;
    text-transform: uppercase;
  }

  .compendium-preview__license-line,
  .compendium-preview__license-attribution,
  .compendium-preview__license-reserved,
  .compendium-preview__license-source {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .compendium-preview__license-label {
    color: var(--fusion-text-subtle, #778);
  }

  .compendium-preview__license-value {
    color: var(--fusion-text, #eee);
  }

  .compendium-preview__actions {
    display: flex;
    gap: 0.4rem;
  }

  .compendium-preview__import {
    background: var(--fusion-accent, #3a6ea5);
    border: none;
    border-radius: var(--fusion-radius-sm, 3px);
    color: #fff;
    cursor: pointer;
    font: inherit;
    padding: 0.25rem 0.7rem;
  }

  .compendium-preview__import:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .compendium-preview__import-msg {
    color: var(--fusion-success, #6ea55a);
    margin: 0;
    font-size: 0.78rem;
  }

  .compendium-preview__import-msg--failed {
    color: var(--fusion-danger, #e06c6c);
  }
</style>
