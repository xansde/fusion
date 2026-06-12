<script lang="ts">
  /**
   * TokenConfigDialog.svelte — modal dialog for configuring token vision and light.
   *
   * Spec: 07-visao-iluminacao-fog.md REQ-VIS-060..062, REQ-VIS-040/041
   *
   * Fields:
   *   Vision section: enabled, range (grid units), angle, visionMode
   *   Light section: enabled, bright (grid units), dim (grid units), color, intensity
   *
   * Sends a doc:update op to update the token's vision/light subdocuments in the scene.
   */

  import type { Socket } from "socket.io-client";
  import type { TokenDocument } from "@fusion/shared";
  import { sendOp } from "../../lib/docs/sendOp.js";
  import { tokenDiffPath } from "@fusion/shared";

  // ---- Props ----

  const {
    sceneId,
    token,
    onClose,
    onSuccess,
    socket,
  }: {
    sceneId: string;
    token: TokenDocument;
    onClose: () => void;
    onSuccess: () => void;
    socket: Socket;
  } = $props();

  // ---- State ----

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
      const rangeVal = visionRange.trim() === "" ? null : Number(visionRange);
      const brightVal = Number(lightBright);
      const dimVal = Number(lightDim);

      await sendOp(socket, {
        type: "doc:update",
        payload: {
          documentType: "Scene",
          updates: [
            {
              _id: sceneId,
              diff: {
                [tokenDiffPath(token._id, "vision" as any)]: {
                  enabled: visionEnabled,
                  range: isNaN(rangeVal as number) ? null : rangeVal,
                  angle: visionAngle,
                  visionMode,
                },
                [tokenDiffPath(token._id, "light" as any)]: {
                  enabled: lightEnabled,
                  bright: isNaN(brightVal) ? 0 : brightVal,
                  dim: isNaN(dimVal) ? 0 : dimVal,
                  color: lightColor,
                  intensity: lightIntensity,
                },
              },
            },
          ],
        },
      });
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
</style>
