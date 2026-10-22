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
  import FusionMark from "./common/FusionMark.svelte";
  import Icon from "./common/Icon.svelte";
  import { sessionActions } from "../lib/session.svelte.js";

  let copiedStep: 1 | 2 | null = $state(null);
  let checking = $state(false);

  const CREATE_CMD = "fusion world create <slug> --system pf2e|sf2e|pf2e-sf2e";
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
      <FusionMark size={40} />
      <div class="mgmt-card__titles">
        <h1 class="mgmt-card__title">{t("FUSION.Management.Title")}</h1>
        <p class="mgmt-card__subtitle">{t("FUSION.Management.Subtitle")}</p>
      </div>
    </header>

    <section class="mgmt-steps" aria-labelledby="mgmt-steps-title">
      <h2 id="mgmt-steps-title" class="mgmt-steps__title">{t("FUSION.Management.StepsTitle")}</h2>

      <ol class="mgmt-steps__list">
        {#each [{ step: 1 as const, label: t("FUSION.Management.Step1Label"), cmd: CREATE_CMD }, { step: 2 as const, label: t("FUSION.Management.Step2Label"), cmd: SERVE_CMD }] as item (item.step)}
          <li class="mgmt-step">
            <p class="mgmt-step__label">{item.label}</p>
            <div class="mgmt-cmd">
              <code class="mgmt-cmd__text">{item.cmd}</code>
              <button type="button" class="btn btn--secondary" onclick={() => copy(item.cmd, item.step)}>
                <Icon name={copiedStep === item.step ? "check" : "copy"} size={18} />
                <span aria-live="polite"
                  >{copiedStep === item.step
                    ? t("FUSION.Management.Copied")
                    : t("FUSION.Management.CopyCommand")}</span
                >
              </button>
            </div>
          </li>
        {/each}
      </ol>
    </section>

    <footer class="mgmt-card__footer">
      <button type="button" class="btn btn--primary btn--wide" onclick={retry} disabled={checking}>
        <Icon name="refresh-cw" size={18} />
        {t("FUSION.Management.RetryButton")}
      </button>
      <a class="mgmt-card__link" href="/setup">
        <Icon name="settings" size={18} />
        {t("FUSION.Management.SetupLink")}
      </a>
    </footer>
  </div>
</div>

<style>
  .mgmt-shell {
    /* html/body never scroll (the table fills the viewport), so the screen scrolls
       itself; the card centres with margin: auto, which never clips its top. */
    background-color: var(--fusion-bg);
    color: var(--fusion-text);
    display: flex;
    height: 100%;
    overflow-y: auto;
    padding: var(--fusion-space-4);
  }

  .mgmt-card {
    margin: auto;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    padding: var(--fusion-space-8) var(--fusion-space-6);
    width: 100%;
    max-width: 560px;
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-6);
  }

  .mgmt-card__header {
    display: flex;
    align-items: center;
    gap: var(--fusion-space-4);
    color: var(--fusion-accent);
  }

  .mgmt-card__title {
    font-size: var(--fusion-text-xl);
    font-weight: var(--fusion-weight-bold);
    color: var(--fusion-text);
    line-height: var(--fusion-leading-tight);
  }

  .mgmt-card__subtitle {
    font-size: var(--fusion-text-sm);
    color: var(--fusion-text-muted);
    margin-top: var(--fusion-space-1);
  }

  .mgmt-steps {
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-3);
  }

  .mgmt-steps__title {
    font-size: var(--fusion-text-lg);
    font-weight: var(--fusion-weight-bold);
    color: var(--fusion-text);
  }

  .mgmt-steps__list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-5);
  }

  .mgmt-step {
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-2);
  }

  .mgmt-step__label {
    font-size: var(--fusion-text-base);
    color: var(--fusion-text);
  }

  /* The command wraps instead of hiding behind a scrollbar (390px phones). */
  .mgmt-cmd {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--fusion-space-2) var(--fusion-space-3);
    background: var(--fusion-input-bg);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    padding: var(--fusion-space-2) var(--fusion-space-2) var(--fusion-space-2) var(--fusion-space-3);
  }

  .mgmt-cmd__text {
    flex: 1 1 16rem;
    min-width: 0;
    font-family: var(--fusion-font-mono);
    font-size: var(--fusion-text-sm);
    color: var(--fusion-text);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }

  .mgmt-card__footer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--fusion-space-2);
  }

  .btn {
    align-items: center;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius);
    cursor: pointer;
    display: inline-flex;
    font-size: var(--fusion-text-base);
    font-weight: var(--fusion-weight-medium);
    gap: var(--fusion-space-2);
    justify-content: center;
    min-height: var(--fusion-target);
    padding: var(--fusion-space-2) var(--fusion-space-4);
    transition: background-color var(--fusion-transition);
    white-space: nowrap;
  }

  .btn--primary {
    background-color: var(--fusion-accent);
    color: var(--fusion-on-accent);
    font-weight: var(--fusion-weight-bold);
    min-height: 44px;
  }

  .btn--primary:hover:not(:disabled) {
    background-color: var(--fusion-accent-hover);
  }

  .btn--secondary {
    background: var(--fusion-surface-alt);
    border-color: var(--fusion-border-strong);
    color: var(--fusion-text);
  }

  .btn--secondary:hover {
    border-color: var(--fusion-accent);
  }

  .btn:disabled {
    background-color: var(--fusion-surface-alt);
    border-color: var(--fusion-border);
    color: var(--fusion-text-muted);
    cursor: progress;
  }

  .btn--wide {
    width: 100%;
  }

  .mgmt-card__link {
    display: inline-flex;
    align-items: center;
    gap: var(--fusion-space-2);
    min-height: var(--fusion-target);
    padding: 0 var(--fusion-space-2);
    color: var(--fusion-accent);
    font-size: var(--fusion-text-base);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  @media (max-width: 480px) {
    .mgmt-shell {
      padding: var(--fusion-space-3);
    }

    .mgmt-card {
      padding: var(--fusion-space-6) var(--fusion-space-4);
    }
  }
</style>
