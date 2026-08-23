<script lang="ts">
  /**
   * ManagementScreen.svelte — shown when the server is running but no world
   * is open yet (management mode: double-clicked exe / `fusion serve` with
   * no --world, post-setup).
   *
   * Distinguishes this state from "server unreachable": before this screen
   * existed, GET /api/world returning 404 (the route only exists once a
   * world is open — see boot.ts's conditional authContext registration)
   * was indistinguishable from the fetch itself failing, so the join screen
   * showed a raw "Cannot reach the server. Is it running?" error even
   * though the server was very much up (manual validation round 2 finding).
   * See session.svelte.ts's `sessionActions.load()` for the detection logic.
   *
   * REQ-DST-011 (implicit): /setup is always reachable for reconfiguration.
   */

  import { t } from "../lib/i18n/i18n.js";
  import { sessionActions } from "../lib/session.svelte.js";

  let copiedStep: 1 | 2 | null = $state(null);
  let checking = $state(false);

  const CREATE_CMD = "fusion world create <slug> --system pf2e|sf2e";
  const SERVE_CMD = "fusion serve --world <slug>";

  async function copy(cmd: string, step: 1 | 2): Promise<void> {
    try {
      await navigator.clipboard.writeText(cmd);
      copiedStep = step;
      setTimeout(() => {
        if (copiedStep === step) copiedStep = null;
      }, 1500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context) — silently ignore,
      // the command is still visible and selectable as plain text.
    }
  }

  async function retry(): Promise<void> {
    checking = true;
    try {
      await sessionActions.load();
    } finally {
      checking = false;
    }
  }
</script>

<div class="mgmt-shell">
  <div class="mgmt-card">
    <header class="mgmt-card__header">
      <div class="mgmt-card__logo" aria-hidden="true">&#9889;</div>
      <div class="mgmt-card__titles">
        <h1 class="mgmt-card__title">{t("FUSION.Management.Title")}</h1>
        <p class="mgmt-card__subtitle">{t("FUSION.Management.Subtitle")}</p>
      </div>
    </header>

    <section class="mgmt-steps">
      <h2 class="mgmt-steps__title">{t("FUSION.Management.StepsTitle")}</h2>

      <div class="mgmt-step">
        <p class="mgmt-step__label">{t("FUSION.Management.Step1Label")}</p>
        <div class="mgmt-cmd">
          <code class="mgmt-cmd__text">{CREATE_CMD}</code>
          <button
            type="button"
            class="btn btn--secondary mgmt-cmd__copy"
            onclick={() => copy(CREATE_CMD, 1)}
          >
            {copiedStep === 1 ? t("FUSION.Management.Copied") : t("FUSION.Management.CopyCommand")}
          </button>
        </div>
      </div>

      <div class="mgmt-step">
        <p class="mgmt-step__label">{t("FUSION.Management.Step2Label")}</p>
        <div class="mgmt-cmd">
          <code class="mgmt-cmd__text">{SERVE_CMD}</code>
          <button
            type="button"
            class="btn btn--secondary mgmt-cmd__copy"
            onclick={() => copy(SERVE_CMD, 2)}
          >
            {copiedStep === 2 ? t("FUSION.Management.Copied") : t("FUSION.Management.CopyCommand")}
          </button>
        </div>
      </div>
    </section>

    <footer class="mgmt-card__footer">
      <button type="button" class="btn btn--primary btn--wide" onclick={retry} disabled={checking}>
        {t("FUSION.Management.RetryButton")}
      </button>
      <a class="link-btn" href="/setup">{t("FUSION.Management.SetupLink")}</a>
    </footer>
  </div>
</div>

<style>
  .mgmt-shell {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--fusion-bg);
    padding: 1rem;
  }

  .mgmt-card {
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    padding: 2rem;
    width: 100%;
    max-width: 520px;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  /* Header */
  .mgmt-card__header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .mgmt-card__logo {
    font-size: 2rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .mgmt-card__title {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--fusion-text);
    line-height: 1.3;
  }

  .mgmt-card__subtitle {
    font-size: 0.8125rem;
    color: var(--fusion-text-subtle);
    line-height: 1.4;
    margin-top: 0.2rem;
  }

  /* Steps */
  .mgmt-steps {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .mgmt-steps__title {
    font-size: 0.8125rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--fusion-text-subtle);
  }

  .mgmt-step {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .mgmt-step__label {
    font-size: 0.875rem;
    color: var(--fusion-text);
  }

  .mgmt-cmd {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    padding: 0.5rem 0.75rem;
  }

  .mgmt-cmd__text {
    flex: 1;
    font-family: var(--fusion-font-mono);
    font-size: 0.8125rem;
    color: var(--fusion-text);
    overflow-x: auto;
    white-space: nowrap;
  }

  .mgmt-cmd__copy {
    flex-shrink: 0;
    padding: 0.3rem 0.7rem;
    font-size: 0.75rem;
  }

  /* Footer */
  .mgmt-card__footer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }

  /* Buttons — same pattern as JoinScreen.svelte / SetupWizard.svelte */
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
    padding: 0.55rem 1.25rem;
    transition: background-color var(--fusion-transition), opacity var(--fusion-transition);
    white-space: nowrap;
  }

  .btn:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .btn--primary {
    background-color: var(--fusion-accent);
    color: #fff;
  }

  .btn--primary:hover:not(:disabled) {
    background-color: var(--fusion-accent-hover);
  }

  .btn--secondary {
    background: var(--fusion-surface-alt);
    border-color: var(--fusion-border);
    color: var(--fusion-text);
  }

  .btn--wide {
    width: 100%;
  }

  .link-btn {
    background: none;
    border: none;
    color: var(--fusion-accent);
    cursor: pointer;
    font-size: 0.8125rem;
    padding: 0;
    text-decoration: underline;
  }
</style>
