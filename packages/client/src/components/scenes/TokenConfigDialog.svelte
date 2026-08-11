<script lang="ts">
  /**
   * TokenConfigDialog.svelte — modal dialog for configuring token vision and light.
   *
   * Spec: 07-visao-iluminacao-fog.md REQ-VIS-060..062, REQ-VIS-040/041
   *       06-canvas-e-renderizacao.md REQ-CNV-089/090, DEC-CNV-15 (resource bars)
   *
   * Fields:
   *   Vision section: enabled, range (grid units), angle, visionMode
   *   Light section: enabled, bright (grid units), dim (grid units), color, intensity
   *   Bars section: bar1/bar2 attribute paths, displayBars level
   *   Sheet section: actorLink (REQ-DOC-031/032/033) + a way into the sheet
   *
   * The link control is the ONLY place a GM can say "this skeleton keeps its
   * own hit points". Without it the whole unlinked-token model — schema,
   * server router, redaction — is unreachable from the table, and the server
   * default (REQ-DOC-061) is the only opinion anyone ever gets to have.
   *
   * Saving goes through `tokenController.updateToken`, i.e. the EMBEDDED
   * `doc:update` form the server actually accepts. The earlier shape — a Scene
   * `doc:update` carrying `tokens.<id>.<field>` dot-paths — was rejected with
   * `VALIDATION_FAILED: tokens: Expected array, received object`, so this
   * dialog's Save button never persisted anything at all.
   * This dialog is the ONLY way to point a bar at an attribute or to change who
   * sees it — an indicator with no way to configure it is not shipped.
   */

  import type { Socket } from "socket.io-client";
  import type { TokenDocument, TokenDisplayMode } from "@fusion/shared";
  import { updateToken } from "../../lib/scenes/tokenController.js";
  import { tokenActorLink } from "../../lib/scenes/tokenActor.js";
  import { buildTokenConfigPatch } from "../../lib/scenes/tokenConfigForm.js";
  import {
    TOKEN_DISPLAY_MODES,
    tokenDisplayBars,
  } from "../../lib/canvas/tokens/token-bars.js";
  import { barAttributeOptions } from "../../lib/scenes/barAttributeOptions.js";
  import { t } from "../../lib/i18n/i18n.js";
  import FilePicker from "../assets/FilePicker.svelte";
  import ActorPortrait from "../common/ActorPortrait.svelte";
  import { fusionApi } from "../../lib/api.js";

  // ---- Props ----

  const {
    sceneId,
    token,
    onClose,
    onSuccess,
    socket,
    onOpenSheet,
    actorSystem,
  }: {
    sceneId: string;
    token: TokenDocument;
    onClose: () => void;
    onSuccess: () => void;
    socket: Socket;
    /**
     * Open this token's sheet. Supplied by TableScreen, which owns the session,
     * the mirror and the window manager; leaving it unset simply hides the
     * button (a dialog that cannot open a sheet is still a usable dialog).
     */
    onOpenSheet?: (token: TokenDocument) => void;
    /**
     * The EFFECTIVE actor's `system` blob (base + delta, REQ-CNV-091), used
     * only to discover which resources the bar dropdowns can offer. Absent —
     * no actor, no binding — the dropdowns still work: "no bar" plus whatever
     * the token already had saved.
     */
    actorSystem?: unknown;
  } = $props();

  // ---- State ----

  // Appearance (name + texture). Persisted through the same submit as
  // vision/light — no separate save action.
  let tokenName = $state<string>(token.name);
  let tokenTexture = $state<string | null>(token.texture);
  let showFilePicker = $state(false);

  // Vision
  let visionEnabled = $state<boolean>(
    (token as any).vision?.enabled ?? false,
  );
  let visionRange = $state<string>(
    String((token as any).vision?.range ?? ""),
  );
  let visionAngle = $state<number>(
    (token as any).vision?.angle ?? 360,
  );
  let visionMode = $state<"basic" | "darkvision">(
    (token as any).vision?.visionMode ?? "basic",
  );

  // Light
  let lightEnabled = $state<boolean>(
    (token as any).light?.enabled ?? false,
  );
  let lightBright = $state<string>(
    String((token as any).light?.bright ?? "0"),
  );
  let lightDim = $state<string>(
    String((token as any).light?.dim ?? "0"),
  );
  let lightColor = $state<string>(
    (token as any).light?.color ?? "#ffcc88",
  );
  let lightIntensity = $state<number>(
    (token as any).light?.intensity ?? 1,
  );

  // Resource bars (REQ-CNV-089 / REQ-CNV-090). The attribute is a dotted path
  // over the actor's `system`, but the GM picks it from resources DISCOVERED
  // on the effective actor, under legible names — never types the path.
  let bar1Attribute = $state<string>(token.bar1?.attribute ?? "");
  let bar2Attribute = $state<string>(token.bar2?.attribute ?? "");
  let displayBars = $state<TokenDisplayMode>(tokenDisplayBars(token));
  const bar1Options = $derived(barAttributeOptions(actorSystem, bar1Attribute, t));
  const bar2Options = $derived(barAttributeOptions(actorSystem, bar2Attribute, t));

  // Actor link (REQ-DOC-031). Read defensively for the same reason
  // `tokenDisplayBars` is: tokens persisted before this field existed carry
  // neither key at runtime, and absent means LINKED — the value that leaves
  // them behaving exactly as they always did.
  let actorLink = $state<boolean>(tokenActorLink(token));

  let submitting = $state(false);
  let serverError = $state<string | null>(null);

  // ---- Handlers ----

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") onClose();
  }

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    submitting = true;
    serverError = null;

    try {
      // The patch is built in `tokenConfigForm.ts`, not here: this component
      // cannot be mounted in a test (no jsdom), and "does Save carry this
      // field" is exactly the question that went unanswered while the whole
      // dialog was persisting nothing at all.
      await updateToken(
        socket,
        sceneId,
        token._id,
        buildTokenConfigPatch({
          name: tokenName,
          texture: tokenTexture,
          actorLink,
          visionEnabled,
          visionRange,
          visionAngle,
          visionMode,
          lightEnabled,
          lightBright,
          lightDim,
          lightColor,
          lightIntensity,
          bar1Attribute,
          bar2Attribute,
          displayBars,
        }),
      );
      onSuccess();
    } catch (err) {
      serverError = err instanceof Error ? err.message : "An error occurred.";
    } finally {
      submitting = false;
    }
  }
</script>

<!-- Backdrop -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="dialog-backdrop"
  role="presentation"
  onclick={onClose}
  onkeydown={handleKeydown}
></div>

<!-- Dialog -->
<dialog
  class="config-dialog"
  open
  aria-label="Token config"
  onkeydown={handleKeydown}
>
  <header class="dialog__header">
    <h2 class="dialog__title">Token Config — {token.name}</h2>
    <button class="dialog__close" onclick={onClose} aria-label="Close">&#x2715;</button>
  </header>

  <form class="dialog__body" onsubmit={handleSubmit} novalidate>

    <!-- ====== Appearance Section ====== -->
    <fieldset class="section">
      <legend class="section__title">{t("FUSION.Token.Config.Appearance")}</legend>

      <div class="field">
        <label class="field__label" for="tok-name">{t("FUSION.Token.Config.Name")}</label>
        <input
          id="tok-name"
          class="field__input"
          type="text"
          bind:value={tokenName}
          disabled={submitting}
        />
      </div>

      <div class="appearance-row">
        <ActorPortrait
          img={tokenTexture}
          name={tokenName}
          size={56}
          label={t("FUSION.Token.Config.PreviewAlt", { name: tokenName })}
        />
        <div class="appearance-actions">
          <button
            type="button"
            class="btn btn--ghost btn--sm"
            onclick={() => { showFilePicker = true; }}
            disabled={submitting}
          >
            {t("FUSION.Token.Config.ChangeImage")}
          </button>
          {#if tokenTexture}
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              onclick={() => { tokenTexture = null; }}
              disabled={submitting}
            >
              {t("FUSION.Token.Config.RemoveImage")}
            </button>
          {/if}
        </div>
      </div>
    </fieldset>

    <!-- ====== Actor link (REQ-DOC-031/032/033) ====== -->
    <fieldset class="section">
      <legend class="section__title">{t("FUSION.Token.Config.ActorLink")}</legend>

      {#if token.actorId}
        <label class="checkbox-row">
          <input
            type="radio"
            name="tok-actor-link"
            value={true}
            bind:group={actorLink}
            disabled={submitting}
          />
          <span>{t("FUSION.Token.Config.ActorLink.linked")}</span>
        </label>

        <label class="checkbox-row">
          <input
            type="radio"
            name="tok-actor-link"
            value={false}
            bind:group={actorLink}
            disabled={submitting}
          />
          <span>{t("FUSION.Token.Config.ActorLink.unlinked")}</span>
        </label>

        <p class="field__hint">{t("FUSION.Token.Config.ActorLink.hint")}</p>

        {#if onOpenSheet}
          <div class="appearance-actions">
            <button
              type="button"
              class="btn btn--ghost btn--sm"
              onclick={() => onOpenSheet?.(token)}
              disabled={submitting}
            >
              {t("FUSION.Token.Config.OpenSheet")}
            </button>
          </div>
        {/if}
      {:else}
        <p class="field__hint">{t("FUSION.Token.Config.ActorLink.noActor")}</p>
      {/if}
    </fieldset>

    <!-- ====== Resource Bars Section (REQ-CNV-089 / REQ-CNV-090) ====== -->
    <fieldset class="section">
      <legend class="section__title">{t("FUSION.Token.Config.Bars")}</legend>

      <div class="field-row">
        <div class="field">
          <label class="field__label" for="tok-bar1">{t("FUSION.Token.Config.Bar1Attribute")}</label>
          <select id="tok-bar1" class="field__select" bind:value={bar1Attribute} disabled={submitting}>
            {#each bar1Options as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="tok-bar2">{t("FUSION.Token.Config.Bar2Attribute")}</label>
          <select id="tok-bar2" class="field__select" bind:value={bar2Attribute} disabled={submitting}>
            {#each bar2Options as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>
      </div>

      <p class="field__hint">{t("FUSION.Token.Config.BarAttributeHint")}</p>

      <div class="field">
        <label class="field__label" for="tok-display-bars">
          {t("FUSION.Token.Config.DisplayBars")}
        </label>
        <select
          id="tok-display-bars"
          class="field__select"
          bind:value={displayBars}
          disabled={submitting}
        >
          {#each TOKEN_DISPLAY_MODES as mode (mode)}
            <option value={mode}>{t(`FUSION.Token.Config.DisplayBars.${mode}`)}</option>
          {/each}
        </select>
      </div>
    </fieldset>

    <!-- ====== Vision Section ====== -->
    <fieldset class="section">
      <legend class="section__title">Vision</legend>

      <label class="checkbox-row">
        <input type="checkbox" bind:checked={visionEnabled} disabled={submitting} />
        <span>Token has vision</span>
      </label>

      {#if visionEnabled}
        <div class="field-row">
          <div class="field">
            <label class="field__label" for="tok-v-range">
              Range (grid units, blank = unlimited)
            </label>
            <input
              id="tok-v-range"
              class="field__input"
              type="number"
              min="0"
              step="0.5"
              bind:value={visionRange}
              placeholder="∞"
              disabled={submitting}
            />
          </div>
          <div class="field">
            <label class="field__label" for="tok-v-angle">Angle (°)</label>
            <input
              id="tok-v-angle"
              class="field__input"
              type="number"
              min="5"
              max="360"
              step="5"
              bind:value={visionAngle}
              disabled={submitting}
            />
          </div>
        </div>

        <div class="field">
          <label class="field__label" for="tok-v-mode">Vision mode</label>
          <select id="tok-v-mode" class="field__select" bind:value={visionMode} disabled={submitting}>
            <option value="basic">Basic (requires light)</option>
            <option value="darkvision">Darkvision (sees in dark)</option>
          </select>
        </div>
      {/if}
    </fieldset>

    <!-- ====== Light Section ====== -->
    <fieldset class="section">
      <legend class="section__title">Emitted Light</legend>

      <label class="checkbox-row">
        <input type="checkbox" bind:checked={lightEnabled} disabled={submitting} />
        <span>Token emits light</span>
      </label>

      {#if lightEnabled}
        <div class="field-row">
          <div class="field">
            <label class="field__label" for="tok-l-bright">Bright radius (grid units)</label>
            <input
              id="tok-l-bright"
              class="field__input"
              type="number"
              min="0"
              step="0.5"
              bind:value={lightBright}
              disabled={submitting}
            />
          </div>
          <div class="field">
            <label class="field__label" for="tok-l-dim">Dim radius (grid units)</label>
            <input
              id="tok-l-dim"
              class="field__input"
              type="number"
              min="0"
              step="0.5"
              bind:value={lightDim}
              disabled={submitting}
            />
          </div>
        </div>

        <div class="field-row">
          <div class="field">
            <label class="field__label" for="tok-l-color">Color</label>
            <input
              id="tok-l-color"
              class="field__input field__input--color"
              type="color"
              bind:value={lightColor}
              disabled={submitting}
            />
          </div>
          <div class="field">
            <label class="field__label" for="tok-l-intensity">
              Intensity ({(lightIntensity * 100).toFixed(0)}%)
            </label>
            <input
              id="tok-l-intensity"
              class="field__input"
              type="range"
              min="0"
              max="1"
              step="0.05"
              bind:value={lightIntensity}
              disabled={submitting}
            />
          </div>
        </div>
      {/if}
    </fieldset>

    {#if serverError}
      <div class="server-error" role="alert">{serverError}</div>
    {/if}

    <footer class="dialog__footer">
      <button type="button" class="btn btn--ghost" onclick={onClose} disabled={submitting}>
        Cancel
      </button>
      <button type="submit" class="btn btn--primary" disabled={submitting}>
        {submitting ? "Saving…" : "Save"}
      </button>
    </footer>
  </form>
</dialog>

{#if showFilePicker}
  <FilePicker
    token={fusionApi.getToken() ?? ""}
    onSelect={(path) => { tokenTexture = path; showFilePicker = false; }}
    onClose={() => { showFilePicker = false; }}
  />
{/if}

<style>
  .dialog-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 200;
  }

  .config-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 201;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    padding: 0;
    width: min(520px, 94vw);
    max-height: 90dvh;
    overflow-y: auto;
  }

  .config-dialog::backdrop {
    background: transparent;
  }

  .dialog__header {
    align-items: center;
    border-bottom: 1px solid var(--fusion-border);
    display: flex;
    gap: 0.5rem;
    justify-content: space-between;
    padding: 1rem 1.25rem;
  }

  .dialog__title {
    font-size: 1rem;
    font-weight: 600;
    margin: 0;
  }

  .dialog__close {
    background: transparent;
    border: none;
    color: var(--fusion-text-muted);
    cursor: pointer;
    font-size: 1.1rem;
    padding: 0.25rem;
    line-height: 1;
  }

  .dialog__body {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    padding: 1.25rem;
  }

  .section {
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin: 0;
    padding: 0.875rem 1rem;
  }

  .section__title {
    color: var(--fusion-text-muted);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .checkbox-row {
    align-items: center;
    cursor: pointer;
    display: flex;
    gap: 0.5rem;
    font-size: 0.875rem;
  }

  .field-row {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: 1fr 1fr;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .field__label {
    color: var(--fusion-text-muted);
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .field__hint {
    color: var(--fusion-text-muted);
    font-size: 0.75rem;
    margin: -0.35rem 0 0;
  }

  .field__input {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: 0.875rem;
    padding: 0.45rem 0.6rem;
    width: 100%;
  }

  .field__input:focus {
    border-color: var(--fusion-accent);
    outline: none;
  }

  .field__input--color {
    height: 2.25rem;
    padding: 0.2rem 0.3rem;
    cursor: pointer;
  }

  .field__select {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: 0.875rem;
    padding: 0.45rem 0.6rem;
    width: 100%;
  }

  .server-error {
    background: rgba(255, 92, 92, 0.12);
    border: 1px solid var(--fusion-danger);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-danger);
    font-size: 0.8125rem;
    padding: 0.6rem 0.75rem;
  }

  .dialog__footer {
    border-top: 1px solid var(--fusion-border);
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    padding: 1rem 1.25rem;
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

  .btn--ghost {
    background: transparent;
    border-color: var(--fusion-border);
    color: var(--fusion-text-muted);
  }

  .btn--sm {
    font-size: 0.8125rem;
    padding: 0.3rem 0.75rem;
  }

  .appearance-row {
    align-items: center;
    display: flex;
    gap: 0.75rem;
  }

  .appearance-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
</style>
