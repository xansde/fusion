<script lang="ts">
  /**
   * FilePicker.svelte — reusable asset-picker modal.
   *
   * Usage:
   *   <FilePicker
   *     token={accessToken}
   *     onSelect={(path) => { formData.background = path; }}
   *     onClose={() => { showPicker = false; }}
   *   />
   *
   * Props:
   *   token     string    — Bearer token for API calls.
   *   onSelect  (path: string) => void — called with the /assets/<name> URL path.
   *   onClose   () => void             — called when the user dismisses the modal.
   *   mode      "assets" (default) | "actionbar-icons" — the action bar's icon gallery (BAR-F3-05):
   *             lists only the shared icons (any role), uploads with the "icon" purpose, offers no
   *             external URL, and lets the GM delete an icon. Every other caller is unchanged.
   *   kinds     AssetKind[]            — media kinds this picker offers to browse
   *                                      for. Defaults to ["image"], which is what
   *                                      every current caller (scene background,
   *                                      token texture) wants. Drives the file
   *                                      dialog's `accept` and the hint line.
   *
   * Note: `kinds` narrows the BROWSE dialog, not drag & drop — the browser hands
   * dropped files over regardless of `accept`, and the upload is then validated
   * by clientValidation (and, for real, by the server).
   *
   * Features:
   *   - Grid of existing world assets with <img> preview.
   *   - Search by filename (client-side, real-time).
   *   - Drag & drop area + click-to-browse button for uploads.
   *   - Per-file progress bar and human-readable errors.
   *   - Clicking an asset calls onSelect with the HTTP URL path.
   *   - Supports URL input for external images.
   *
   * Logic lives in assetStore.svelte.ts and assetApi.ts — this component is UI only.
   */

  import { onMount } from "svelte";
  import { assetStore } from "$lib/assets/assetStore.svelte.js";
  import {
    assetUrl,
    fetchAssetToken,
    listIconGallery,
    iconGalleryUrl,
    deleteIconAsset,
    type AssetQueryToken,
    type IconGallery,
  } from "$lib/assets/assetApi.js";
  import {
    isImageExtension,
    formatBytes,
    acceptAttrFor,
    formatsLabelFor,
    maxBytesFor,
    type AssetKind,
  } from "$lib/assets/clientValidation.js";
  import { canDeleteGalleryIcons, pickerUploadOptions } from "$lib/assets/iconPicker.js";
  import { t } from "$lib/i18n/i18n.js";
  import { session } from "$lib/session.svelte.js";

  // ---- Props ----

  const {
    token,
    onSelect,
    onClose,
    mode = "assets",
    kinds = ["image"],
  }: {
    token: string;
    onSelect: (path: string) => void;
    onClose: () => void;
    mode?: "assets" | "actionbar-icons";
    kinds?: AssetKind[];
  } = $props();

  // ---- Icon mode (BAR-F3-05) ----
  //
  // The gallery is the server's: `GET /api/assets/icons` lists only the reserved icon area, for any
  // role, with the caller's read grant for each icon. Maps, portraits and handouts never reach it.

  const iconMode = $derived(mode === "actionbar-icons");
  // Deleting stays STORAGE_DELETE — the GM only (REQ-BAR-081); the server refuses anyone else.
  const canDeleteIcons = $derived(canDeleteGalleryIcons(session.user?.role));
  let gallery = $state<IconGallery>({ assets: [], exp: 0, grants: {} });
  let galleryLoading = $state(false);
  let galleryError = $state<string | null>(null);
  let iconQuery = $state("");

  async function loadGallery(): Promise<void> {
    galleryLoading = true;
    galleryError = null;
    try {
      gallery = await listIconGallery(token);
    } catch (err) {
      galleryError = err instanceof Error ? err.message : t("FUSION.IconPicker.LoadFailed");
    } finally {
      galleryLoading = false;
    }
  }

  /** The file name of an icon, without the area in front of it. */
  function iconFileName(name: string): string {
    return name.slice(name.lastIndexOf("/") + 1);
  }

  async function handleDeleteIcon(name: string): Promise<void> {
    const ok = window.confirm(t("FUSION.IconPicker.DeleteConfirm", { name: iconFileName(name) }));
    if (!ok) return;
    try {
      await deleteIconAsset(token, name);
    } catch (err) {
      galleryError = err instanceof Error ? err.message : t("FUSION.IconPicker.DeleteFailed");
      return;
    }
    await loadGallery();
  }

  const filteredIcons = $derived.by(() => {
    const q = iconQuery.trim().toLowerCase();
    if (!q) return gallery.assets;
    return gallery.assets.filter((a) => iconFileName(a.name).toLowerCase().includes(q));
  });

  // ---- Local state ----

  let externalUrl = $state("");
  let isDragOver = $state(false);
  let fileInput: HTMLInputElement | null = $state(null);

  // BUG A FIX: grid thumbnails hit the same auth-token gap as the scene
  // background — /assets/* 401s without a query-token. A single short-lived
  // token is fetched once when the picker opens and reused for every
  // thumbnail in the grid (they all render within the picker's lifetime,
  // well under the 5-minute TTL). The value onSelect() hands back to the
  // caller stays a clean path — callers resolve a fresh token at render time
  // via resolveAssetUrl(), matching how scene.background / token.texture work.
  let previewToken = $state<AssetQueryToken | null>(null);

  // ---- Lifecycle ----

  onMount(() => {
    if (mode === "actionbar-icons") {
      void loadGallery();
      return;
    }
    void assetStore.loadAssets(token);
    const userId = session.user?.id;
    if (userId) {
      void fetchAssetToken(token, userId)
        .then((t) => { previewToken = t; })
        .catch(() => { previewToken = null; });
    }
  });

  // ---- Handlers ----

  function handleSearch(e: Event): void {
    assetStore.setSearch((e.target as HTMLInputElement).value);
  }

  function handleSelectAsset(name: string): void {
    onSelect(assetUrl(name));
    onClose();
  }

  function handleSelectExternal(): void {
    const url = externalUrl.trim();
    if (url) {
      onSelect(url);
      onClose();
    }
  }

  function handleDragOver(e: DragEvent): void {
    e.preventDefault();
    isDragOver = true;
  }

  function handleDragLeave(e: DragEvent): void {
    e.preventDefault();
    isDragOver = false;
  }

  async function handleDrop(e: DragEvent): Promise<void> {
    e.preventDefault();
    isDragOver = false;

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    startUploads(Array.from(files));
  }

  async function handleFileInput(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;

    startUploads(Array.from(files));

    // Reset so the same file can be re-selected after an error
    input.value = "";
  }

  /**
   * BUG #5a FIX: a single file is auto-selected once its upload finishes (mirrors
   * handleSelectAsset's assetUrl(name) + onClose()); several files are left for the user to pick.
   * In icon mode every upload declares the "icon" purpose and refreshes the gallery.
   */
  function startUploads(fileList: File[]): void {
    const single = fileList.length === 1;
    const onDone = (path: string): void => {
      if (iconMode) void loadGallery();
      if (single) {
        onSelect(assetUrl(path));
        onClose();
      }
    };
    for (const file of fileList) {
      void assetStore.startUpload(
        token,
        file,
        single || iconMode ? onDone : undefined,
        pickerUploadOptions(mode),
      );
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") onClose();
  }

  // ---- Computed ----

  // Read uploadsVersion to subscribe to upload map changes
  const activeUploads = $derived(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    assetStore.uploadsVersion;
    return Array.from(assetStore.uploads.entries());
  });

  const hasActiveUploads = $derived(() => activeUploads().length > 0);

  // Everything the drop zone advertises is derived from the same map that
  // validates the file — the UI can never offer a format the upload rejects.
  const acceptAttr = $derived(acceptAttrFor(kinds));
  const dropLabel = $derived(kinds.length === 1 ? `Drop ${kinds[0]} files here` : "Drop files here");
  const limitHint = $derived(`${formatsLabelFor(kinds)} · up to ${formatBytes(maxBytesFor(kinds))}`);
</script>

<!-- Backdrop -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="picker-backdrop"
  role="presentation"
  onclick={onClose}
  onkeydown={handleKeydown}
></div>

<!-- Modal -->
<dialog
  class="picker-dialog"
  open
  aria-label={iconMode ? t("FUSION.IconPicker.DialogLabel") : "Pick an asset"}
  onkeydown={handleKeydown}
>
  <!-- Header -->
  <header class="picker__header">
    <h2 class="picker__title">{iconMode ? t("FUSION.IconPicker.Title") : "Asset Browser"}</h2>
    <button class="picker__close btn btn--icon" onclick={onClose} aria-label="Close">
      &#x2715;
    </button>
  </header>

  <!-- Search -->
  <div class="picker__search-row">
    {#if iconMode}
      <input
        class="picker__search field__input"
        type="search"
        placeholder={t("FUSION.IconPicker.Search")}
        bind:value={iconQuery}
        aria-label={t("FUSION.IconPicker.SearchLabel")}
      />
      <p class="picker__notice">
        {t("FUSION.IconPicker.Notice")}
      </p>
    {:else}
      <input
        class="picker__search field__input"
        type="search"
        placeholder="Search by name…"
        value={assetStore.searchQuery}
        oninput={handleSearch}
        aria-label="Search assets"
      />
    {/if}
  </div>

  <!-- Upload zone -->
  <div
    class="picker__drop-zone"
    class:picker__drop-zone--over={isDragOver}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
    role="region"
    aria-label={iconMode ? t("FUSION.IconPicker.DropLabel") : "Drop files here to upload"}
  >
    <span class="picker__drop-icon" aria-hidden="true">&#8679;</span>
    <span class="picker__drop-text">{iconMode ? t("FUSION.IconPicker.Drop") : dropLabel}</span>
    <span class="picker__drop-sep">{iconMode ? t("FUSION.IconPicker.Or") : "or"}</span>
    <button
      class="btn btn--ghost btn--sm"
      onclick={() => fileInput?.click()}
      type="button"
    >
      {iconMode ? t("FUSION.IconPicker.Browse") : "Browse files"}
    </button>
    <!-- Hidden file input -->
    <input
      bind:this={fileInput}
      type="file"
      accept={acceptAttr}
      multiple
      style="display:none"
      onchange={handleFileInput}
      aria-hidden="true"
      tabindex="-1"
    />
    <!-- Formats and size ceiling: today the user only discovers them by failing -->
    <span class="picker__drop-hint">{limitHint}</span>
  </div>

  <!-- Upload progress items -->
  {#if hasActiveUploads()}
    <ul class="picker__uploads" aria-label="Upload progress" role="list">
      {#each activeUploads() as [file, state] (file.name + file.size)}
        <li class="upload-item">
          <span class="upload-item__name" title={file.name}>{file.name}</span>

          {#if state.status === "uploading"}
            <div class="upload-item__bar-wrap" role="progressbar" aria-valuenow={state.percent ?? 0} aria-valuemin={0} aria-valuemax={100}>
              <div class="upload-item__bar" style="width: {state.percent ?? 0}%"></div>
            </div>
            <span class="upload-item__pct">{state.percent ?? 0}%</span>

          {:else if state.status === "done"}
            <span class="upload-item__ok" aria-label="Upload complete">&#10003;</span>

          {:else if state.status === "error"}
            <span class="upload-item__err" role="alert">{state.errorMessage}</span>
            <button
              class="btn btn--icon upload-item__dismiss"
              onclick={() => assetStore.clearUploadError(file)}
              aria-label="Dismiss error"
              type="button"
            >&#x2715;</button>

          {:else}
            <span class="upload-item__wait">Preparing…</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <!-- Asset grid -->
  <div class="picker__grid-wrap">
    {#if iconMode}
      {#if galleryLoading}
        <div class="picker__empty">{t("FUSION.IconPicker.Loading")}</div>
      {:else if galleryError}
        <div class="picker__empty picker__empty--error" role="alert">
          {galleryError}
          <button class="btn btn--ghost btn--sm" onclick={() => void loadGallery()} type="button"
            >{t("FUSION.IconPicker.Retry")}</button
          >
        </div>
      {:else if filteredIcons.length === 0}
        <div class="picker__empty">
          {gallery.assets.length === 0
            ? t("FUSION.IconPicker.EmptyGallery")
            : t("FUSION.IconPicker.NoMatch")}
        </div>
      {:else}
        <ul class="picker__grid" role="list" aria-label={t("FUSION.IconPicker.GalleryLabel")}>
          {#each filteredIcons as icon (icon.name)}
            <li class="icon-cell">
              <button
                class="asset-card"
                type="button"
                onclick={() => handleSelectAsset(icon.name)}
                title={iconFileName(icon.name)}
                aria-label={t("FUSION.IconPicker.Use", { name: iconFileName(icon.name) })}
              >
                <img
                  class="asset-card__img"
                  src={iconGalleryUrl(gallery, icon.name, session.user?.id ?? "")}
                  alt=""
                  loading="lazy"
                />
                <span class="asset-card__name">{iconFileName(icon.name)}</span>
              </button>
              {#if canDeleteIcons}
                <button
                  class="icon-cell__delete"
                  type="button"
                  onclick={() => void handleDeleteIcon(icon.name)}
                  aria-label={t("FUSION.IconPicker.Delete", { name: iconFileName(icon.name) })}
                  title={t("FUSION.IconPicker.DeleteTitle")}
                >&#x2715;</button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {:else if assetStore.loading}
      <div class="picker__empty">Loading assets…</div>

    {:else if assetStore.fetchError}
      <div class="picker__empty picker__empty--error" role="alert">
        {assetStore.fetchError}
        <button
          class="btn btn--ghost btn--sm"
          onclick={() => void assetStore.loadAssets(token)}
          type="button"
        >Retry</button>
      </div>

    {:else if assetStore.filtered.length === 0}
      <div class="picker__empty">
        {assetStore.assets.length === 0
          ? "No assets uploaded yet. Drop a file above to get started."
          : "No assets match your search."}
      </div>

    {:else}
      <ul class="picker__grid" role="list" aria-label="Available assets">
        {#each assetStore.filtered as asset (asset.name)}
          <li>
            <button
              class="asset-card"
              type="button"
              onclick={() => handleSelectAsset(asset.name)}
              title={`${asset.name} (${formatBytes(asset.size)})`}
              aria-label={`Select ${asset.name}`}
            >
              {#if isImageExtension(asset.name)}
                <img
                  class="asset-card__img"
                  src={assetUrl(asset.name, previewToken ?? undefined)}
                  alt={asset.name}
                  loading="lazy"
                />
              {:else}
                <div class="asset-card__icon" aria-hidden="true">
                  {#if asset.mime_type.startsWith("video/")}
                    &#9654;
                  {:else if asset.mime_type.startsWith("audio/")}
                    &#9835;
                  {:else}
                    &#128196;
                  {/if}
                </div>
              {/if}

              <span class="asset-card__name">{asset.name}</span>
              <span class="asset-card__size">{formatBytes(asset.size)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <!-- External URL fallback — never in icon mode: an icon is always a file of the icon area -->
  {#if !iconMode}
  <div class="picker__external">
    <label class="picker__ext-label" for="picker-external-url">
      Or paste an external URL
    </label>
    <div class="picker__ext-row">
      <input
        id="picker-external-url"
        class="field__input picker__ext-input"
        type="url"
        placeholder="https://example.com/image.webp"
        bind:value={externalUrl}
        onkeydown={(e) => { if (e.key === "Enter") handleSelectExternal(); }}
      />
      <button
        class="btn btn--primary btn--sm"
        type="button"
        onclick={handleSelectExternal}
        disabled={!externalUrl.trim()}
      >
        Use URL
      </button>
    </div>
  </div>
  {/if}
</dialog>

<style>
  .picker-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 300;
  }

  .picker-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 301;

    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.7);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    padding: 0;
    width: min(760px, 95vw);
    max-height: 85dvh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .picker-dialog::backdrop {
    background: transparent;
  }

  /* ---- Header ---- */
  .picker__header {
    align-items: center;
    border-bottom: 1px solid var(--fusion-border);
    display: flex;
    gap: 0.5rem;
    justify-content: space-between;
    padding: 0.875rem 1.25rem;
    flex-shrink: 0;
  }

  .picker__title {
    font-size: 0.9375rem;
    font-weight: 600;
    margin: 0;
  }

  .picker__close {
    background: transparent;
    border: none;
    color: var(--fusion-text-muted);
    cursor: pointer;
    font-size: 1rem;
    line-height: 1;
    padding: 0.25rem;
    transition: color var(--fusion-transition);
  }

  .picker__close:hover {
    color: var(--fusion-text);
  }

  /* ---- Search ---- */
  .picker__search-row {
    padding: 0.75rem 1.25rem 0;
    flex-shrink: 0;
  }

  .picker__search {
    width: 100%;
  }

  /* ---- Drop zone ---- */
  .picker__drop-zone {
    align-items: center;
    border: 1.5px dashed var(--fusion-border);
    border-radius: var(--fusion-radius);
    cursor: pointer;
    display: flex;
    flex-direction: row;
    flex-shrink: 0;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: center;
    margin: 0.75rem 1.25rem 0;
    padding: 0.75rem 1rem;
    transition: border-color var(--fusion-transition), background var(--fusion-transition);
  }

  .picker__drop-zone--over {
    background: var(--fusion-accent-dim);
    border-color: var(--fusion-accent);
  }

  .picker__drop-icon {
    color: var(--fusion-text-muted);
    font-size: 1.25rem;
    line-height: 1;
  }

  .picker__drop-text,
  .picker__drop-sep {
    color: var(--fusion-text-muted);
    font-size: 0.8125rem;
  }

  /* Full-width so it wraps onto its own line below the drop row */
  .picker__drop-hint {
    color: var(--fusion-text-subtle);
    flex-basis: 100%;
    font-size: 0.6875rem;
    text-align: center;
  }

  /* ---- Upload progress list ---- */
  .picker__uploads {
    list-style: none;
    margin: 0.5rem 1.25rem 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    flex-shrink: 0;
    max-height: 120px;
    overflow-y: auto;
  }

  .upload-item {
    align-items: center;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    display: flex;
    font-size: 0.75rem;
    gap: 0.5rem;
    padding: 0.3rem 0.6rem;
  }

  .upload-item__name {
    color: var(--fusion-text-muted);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .upload-item__bar-wrap {
    background: var(--fusion-border);
    border-radius: 2px;
    flex-shrink: 0;
    height: 4px;
    overflow: hidden;
    width: 80px;
  }

  .upload-item__bar {
    background: var(--fusion-accent);
    border-radius: 2px;
    height: 100%;
    transition: width 150ms linear;
  }

  .upload-item__pct {
    color: var(--fusion-text-subtle);
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
    min-width: 2.5rem;
    text-align: right;
  }

  .upload-item__ok {
    color: var(--fusion-success);
    flex-shrink: 0;
    font-size: 1rem;
  }

  .upload-item__err {
    color: var(--fusion-danger);
    flex: 1;
    font-size: 0.7rem;
  }

  .upload-item__wait {
    color: var(--fusion-text-subtle);
    flex-shrink: 0;
  }

  .upload-item__dismiss {
    background: transparent;
    border: none;
    color: var(--fusion-text-muted);
    cursor: pointer;
    flex-shrink: 0;
    font-size: 0.75rem;
    padding: 0;
    line-height: 1;
  }

  /* ---- Grid ---- */
  .picker__grid-wrap {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem 1.25rem;
  }

  .picker__empty {
    align-items: center;
    color: var(--fusion-text-muted);
    display: flex;
    flex-direction: column;
    font-size: 0.875rem;
    gap: 0.75rem;
    justify-content: center;
    min-height: 100px;
    text-align: center;
  }

  .picker__empty--error {
    color: var(--fusion-danger);
  }

  .picker__grid {
    display: grid;
    gap: 0.6rem;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    list-style: none;
  }

  /* ---- Asset card ---- */
  .asset-card {
    align-items: center;
    background: var(--fusion-surface-alt);
    border: 1.5px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.4rem;
    text-align: center;
    transition: border-color var(--fusion-transition), box-shadow var(--fusion-transition);
    width: 100%;
  }

  .asset-card:hover,
  .asset-card:focus-visible {
    border-color: var(--fusion-accent);
    box-shadow: 0 0 0 2px var(--fusion-accent-dim);
    outline: none;
  }

  .asset-card__img {
    border-radius: var(--fusion-radius-sm);
    display: block;
    height: 80px;
    object-fit: contain;
    width: 100%;
    background: var(--fusion-bg);
  }

  .asset-card__icon {
    align-items: center;
    color: var(--fusion-text-muted);
    display: flex;
    font-size: 2rem;
    height: 80px;
    justify-content: center;
    width: 100%;
  }

  .asset-card__name {
    color: var(--fusion-text-muted);
    font-size: 0.6875rem;
    line-height: 1.2;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
  }

  .asset-card__size {
    color: var(--fusion-text-subtle);
    font-size: 0.625rem;
    line-height: 1;
  }

  /* ---- Icon mode (BAR-F3-05) ---- */
  .picker__notice {
    color: var(--fusion-text-subtle);
    font-size: 0.75rem;
    margin: 0.4rem 0 0;
  }

  .icon-cell {
    position: relative;
  }

  .icon-cell__delete {
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    cursor: pointer;
    font-size: 0.7rem;
    line-height: 1;
    padding: 0.2rem 0.3rem;
    position: absolute;
    right: 0.25rem;
    top: 0.25rem;
  }

  .icon-cell__delete:hover,
  .icon-cell__delete:focus-visible {
    border-color: var(--fusion-danger);
    color: var(--fusion-danger);
    outline: none;
  }

  /* ---- External URL ---- */
  .picker__external {
    border-top: 1px solid var(--fusion-border);
    flex-shrink: 0;
    padding: 0.75rem 1.25rem;
  }

  .picker__ext-label {
    color: var(--fusion-text-muted);
    display: block;
    font-size: 0.75rem;
    margin-bottom: 0.4rem;
  }

  .picker__ext-row {
    display: flex;
    gap: 0.5rem;
  }

  .picker__ext-input {
    flex: 1;
  }

  /* ---- Shared field/button styles (inline to avoid deep imports) ---- */
  .field__input {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: 0.875rem;
    padding: 0.45rem 0.6rem;
    transition: border-color var(--fusion-transition);
  }

  .field__input:focus {
    border-color: var(--fusion-accent);
    outline: none;
  }

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
    padding: 0.45rem 1rem;
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
    border-color: var(--fusion-text-muted);
    color: var(--fusion-text);
  }

  .btn--sm {
    font-size: 0.8125rem;
    padding: 0.3rem 0.75rem;
  }

  .btn--icon {
    padding: 0.25rem 0.4rem;
  }
</style>
