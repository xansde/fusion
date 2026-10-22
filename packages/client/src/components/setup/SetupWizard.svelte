<script lang="ts">
  /**
   * SetupWizard.svelte — first-run setup wizard (REQ-DST-011..015, 015A).
   *
   * Mounted standalone at /setup by main.ts (see the routing decision there),
   * completely separate from the game session shell (App.svelte /
   * session.svelte.ts) — the wizard talks only to /admin/*, never /api/* or
   * the socket layer, and has no notion of a "world".
   *
   * Steps, in the order mandated by REQ-DST-012:
   *   1. Data directory (default pre-filled, free text input, "portable
   *      folder" shortcut button)
   *   2. Server port (live availability check via /admin/setup/check-port)
   *   3. Admin Key (password + confirmation, hashed server-side as Argon2id)
   *   4. Connectivity (LAN URL(s) + QR code)
   *
   * Re-run behaviour (REQ-DST-014): when setupCompleted is already true on
   * load, the wizard first asks for the CURRENT Admin Key (via /admin/login)
   * before showing the same 4-step form pre-filled with the live config —
   * "Reconfigurar" reuses this exact component, it does not fork into a
   * separate screen.
   */

  import { onMount } from "svelte";
  import FusionMark from "../common/FusionMark.svelte";
  import Icon from "../common/Icon.svelte";
  import { setupApi, SetupApiError, isFullSetupState, type SetupState } from "./setupApi.js";
  import QrCode from "./QrCode.svelte";
  import { t } from "../../lib/i18n/i18n.js";

  type WizardPhase =
    | "loading"
    | "reconfig-auth" // re-run: must present the Admin Key before editing
    | "form"
    | "done"
    | "fatal-error";

  type StepId = "dataDir" | "port" | "adminKey" | "connectivity";
  const STEPS: StepId[] = ["dataDir", "port", "adminKey", "connectivity"];

  // ---- Top-level phase state ----
  let phase = $state<WizardPhase>("loading");
  let fatalMessage = $state("");

  // ---- Loaded server state ----
  let initialState = $state<SetupState | null>(null);

  // ---- Reconfiguration auth (only used when phase === "reconfig-auth") ----
  let reconfigAdminKey = $state("");
  let reconfigError = $state("");
  let reconfigLoading = $state(false);

  // ---- Wizard step state ----
  let stepIndex = $state(0);
  const currentStep = $derived(STEPS[stepIndex] ?? "dataDir");

  let dataDir = $state("");
  let port = $state(33000);
  let adminKey = $state("");
  let adminKeyConfirm = $state("");

  // Port check state
  let portCheckStatus = $state<"idle" | "checking" | "available" | "unavailable">("idle");
  let portSuggestion = $state<number | null>(null);
  let portCheckToken = 0; // guards against out-of-order async responses

  // Apply state
  let applying = $state(false);
  let applyError = $state("");
  let applyResult = $state<{ lanUrls: string[]; restartRequired: boolean } | null>(null);

  // Desktop shortcut (optional button, Windows only — server reports failure
  // gracefully on other platforms)
  let shortcutStatus = $state<"idle" | "creating" | "done" | "error">("idle");
  let shortcutMessage = $state("");

  // ---- Derived validation ----
  const adminKeyValid = $derived(adminKey.length >= 8);
  const adminKeyMatches = $derived(adminKey.length > 0 && adminKey === adminKeyConfirm);

  const canAdvance = $derived.by(() => {
    if (currentStep === "dataDir") return dataDir.trim().length > 0;
    if (currentStep === "port") return portCheckStatus === "available";
    if (currentStep === "adminKey") return adminKeyValid && adminKeyMatches;
    return true;
  });

  // ---------------------------------------------------------------------
  // Load initial state
  // ---------------------------------------------------------------------

  onMount(async () => {
    await loadState();
  });

  async function loadState(): Promise<void> {
    try {
      const state = await setupApi.fetchState();

      if (!isFullSetupState(state)) {
        // Post-setup, no (valid) stored Bearer yet: the server only tells us
        // setupCompleted=true and withholds everything else (REQ-SEC —
        // dataDir/LAN/version must not leak to an unauthenticated caller).
        // Route straight to the reconfig-auth gate; the FULL state is
        // fetched again right after a successful /admin/login below.
        phase = "reconfig-auth";
        return;
      }

      initialState = state;
      dataDir = state.currentDataDir;
      port = state.currentPort;

      if (state.setupCompleted) {
        phase = setupApi.hasStoredToken() ? "form" : "reconfig-auth";
      } else {
        phase = "form";
      }

      if (phase === "form") {
        // Kick off an initial port check so the "current" port shows its
        // real live status rather than a stale "idle" indicator.
        void checkPort(port);
      }
    } catch (err) {
      fatalMessage = err instanceof Error ? err.message : String(err);
      phase = "fatal-error";
    }
  }

  // ---------------------------------------------------------------------
  // Reconfiguration auth
  // ---------------------------------------------------------------------

  async function submitReconfigAuth(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    reconfigError = "";
    reconfigLoading = true;
    try {
      await setupApi.login(reconfigAdminKey);
      // The minimal pre-login state (or none, if this is the very first
      // load post-setup) never carried currentDataDir/currentPort — re-fetch
      // now that a valid Bearer is stored, so the form is pre-filled with
      // real values instead of the field defaults.
      const state = await setupApi.fetchState();
      if (isFullSetupState(state)) {
        initialState = state;
        dataDir = state.currentDataDir;
        port = state.currentPort;
      }
      phase = "form";
      if (initialState) void checkPort(initialState.currentPort);
    } catch (err) {
      reconfigError =
        err instanceof SetupApiError ? err.message : t("FUSION.Setup.Error.ReconfigAuth");
    } finally {
      reconfigLoading = false;
    }
  }

  // ---------------------------------------------------------------------
  // Data directory step
  // ---------------------------------------------------------------------

  function usePortableFolder(): void {
    // REQ-DST-009: the server resolves the real <exeDir>/FusionVTT-Data
    // (portableDataDir in SetupState) — the browser sandbox has no way to
    // know the executable's own directory, so this can only ever fill in
    // whatever absolute path the server already computed and sent down with
    // /admin/setup/state, never guess a relative path client-side.
    if (initialState) dataDir = initialState.portableDataDir;
  }

  function resetToDefault(): void {
    if (initialState) dataDir = initialState.defaultDataDir;
  }

  // ---------------------------------------------------------------------
  // Port step
  // ---------------------------------------------------------------------

  async function checkPort(candidate: number): Promise<void> {
    if (!Number.isInteger(candidate) || candidate < 1024 || candidate > 65535) {
      portCheckStatus = "idle";
      return;
    }
    const token = ++portCheckToken;
    portCheckStatus = "checking";
    try {
      const result = await setupApi.checkPort(candidate);
      if (token !== portCheckToken) return; // a newer check superseded this one
      portCheckStatus = result.available ? "available" : "unavailable";
      portSuggestion = result.suggestion ?? null;
    } catch {
      if (token !== portCheckToken) return;
      portCheckStatus = "idle";
    }
  }

  function handlePortInput(): void {
    void checkPort(port);
  }

  function useSuggestedPort(): void {
    if (portSuggestion !== null) {
      port = portSuggestion;
      void checkPort(port);
    }
  }

  // ---------------------------------------------------------------------
  // Step navigation
  // ---------------------------------------------------------------------

  function nextStep(): void {
    if (!canAdvance) return;
    if (stepIndex < STEPS.length - 1) {
      stepIndex += 1;
    } else {
      void submitApply();
    }
  }

  function prevStep(): void {
    if (stepIndex > 0) stepIndex -= 1;
  }

  // ---------------------------------------------------------------------
  // Apply
  // ---------------------------------------------------------------------

  async function submitApply(): Promise<void> {
    applying = true;
    applyError = "";
    try {
      const result = await setupApi.apply({ dataDir, port, adminKey });
      applyResult = { lanUrls: result.lanUrls, restartRequired: result.restartRequired };
      phase = "done";
    } catch (err) {
      applyError =
        err instanceof SetupApiError ? err.message : t("FUSION.Setup.Error.Generic");
    } finally {
      applying = false;
    }
  }

  // ---------------------------------------------------------------------
  // Desktop shortcut (optional, REQ-DST-016/017)
  // ---------------------------------------------------------------------

  async function createShortcut(): Promise<void> {
    shortcutStatus = "creating";
    try {
      const res = await fetch("/admin/setup/desktop-shortcut", {
        method: "POST",
        headers: sessionStorage.getItem("fusion_admin_token")
          ? { Authorization: `Bearer ${sessionStorage.getItem("fusion_admin_token")}` }
          : {},
      });
      const body = (await res.json()) as { ok: boolean; message: string };
      shortcutStatus = body.ok ? "done" : "error";
      shortcutMessage = body.message;
    } catch (err) {
      shortcutStatus = "error";
      shortcutMessage = err instanceof Error ? err.message : String(err);
    }
  }

  const primaryLanUrl = $derived(applyResult?.lanUrls[0] ?? "");
</script>

<div class="setup-shell">
  <div class="setup-card">
    <header class="setup-card__header">
      <FusionMark size={40} />
      <div>
        <h1 class="setup-card__title">{t("FUSION.Setup.Title")}</h1>
        {#if initialState}
          <p class="setup-card__meta">{t("FUSION.Setup.Version", { version: initialState.serverVersion })}</p>
        {/if}
      </div>
    </header>

    {#if phase === "loading"}
      <p class="setup-status" role="status">{t("FUSION.Setup.Loading")}</p>
    {:else if phase === "fatal-error"}
      <div class="alert alert--danger" role="alert">
        <Icon name="triangle-alert" size={20} />
        <p>{fatalMessage}</p>
      </div>
    {:else if phase === "reconfig-auth"}
      <form class="setup-form" onsubmit={submitReconfigAuth}>
        <p class="setup-step__hint">{t("FUSION.Setup.Reconfig.Intro")}</p>
        {#if reconfigError}
          <div class="alert alert--danger" role="alert">
            <Icon name="triangle-alert" size={20} />
            <p>{reconfigError}</p>
          </div>
        {/if}
        <label class="field">
          <span class="field__label">{t("FUSION.Setup.Reconfig.AdminKey")}</span>
          <input type="password" bind:value={reconfigAdminKey} autocomplete="current-password" />
        </label>
        <div class="setup-nav setup-nav--end">
          <button type="submit" class="btn btn--primary" disabled={reconfigLoading}>
            {reconfigLoading ? t("FUSION.Setup.Reconfig.Verifying") : t("FUSION.Setup.Reconfig.Continue")}
            <Icon name="arrow-right" size={18} />
          </button>
        </div>
      </form>
    {:else if phase === "form"}
      <!-- Where am I: words first ("Passo 2 de 4"), the bar only repeats it. -->
      <div class="setup-progress">
        <p class="setup-progress__text">
          {t("FUSION.Setup.Progress", { step: stepIndex + 1, total: STEPS.length })}
        </p>
        <div class="setup-progress__bar" aria-hidden="true">
          {#each STEPS as step, i (step)}
            <span class="setup-progress__seg" class:setup-progress__seg--on={i <= stepIndex}></span>
          {/each}
        </div>
      </div>

      {#if applyError}
        <div class="alert alert--danger" role="alert">
          <Icon name="triangle-alert" size={20} />
          <p>{applyError}</p>
        </div>
      {/if}

      {#if currentStep === "dataDir"}
        <section class="setup-step">
          <h2 class="setup-step__title">{t("FUSION.Setup.Step.DataDir.Title")}</h2>
          <p class="setup-step__hint">{t("FUSION.Setup.Step.DataDir.Hint")}</p>
          <label class="field">
            <span class="field__label">{t("FUSION.Setup.Step.DataDir.Path")}</span>
            <input type="text" bind:value={dataDir} spellcheck="false" />
          </label>
          <div class="setup-step__actions-inline">
            <button type="button" class="btn btn--secondary" onclick={resetToDefault}>
              {t("FUSION.Setup.Step.DataDir.UseDefault")}
            </button>
            <button type="button" class="btn btn--secondary" onclick={usePortableFolder}>
              {t("FUSION.Setup.Step.DataDir.UsePortable")}
            </button>
          </div>
        </section>
      {:else if currentStep === "port"}
        <section class="setup-step">
          <h2 class="setup-step__title">{t("FUSION.Setup.Step.Port.Title")}</h2>
          <p class="setup-step__hint">{t("FUSION.Setup.Step.Port.Hint")}</p>
          <label class="field field--narrow">
            <span class="field__label">{t("FUSION.Setup.Step.Port.Label")}</span>
            <input
              type="number"
              inputmode="numeric"
              min="1024"
              max="65535"
              bind:value={port}
              oninput={handlePortInput}
            />
          </label>
          <div aria-live="polite">
            {#if portCheckStatus === "checking"}
              <p class="setup-step__status">{t("FUSION.Setup.Step.Port.Checking")}</p>
            {:else if portCheckStatus === "available"}
              <p class="setup-step__status setup-step__status--ok">
                <Icon name="check" size={18} />
                {t("FUSION.Setup.Step.Port.Available", { port })}
              </p>
            {:else if portCheckStatus === "unavailable"}
              <p class="setup-step__status setup-step__status--error">
                <Icon name="triangle-alert" size={18} />
                {t("FUSION.Setup.Step.Port.Unavailable", { port })}
              </p>
              {#if portSuggestion !== null}
                <button type="button" class="btn btn--secondary" onclick={useSuggestedPort}>
                  {t("FUSION.Setup.Step.Port.UseSuggestion", { port: portSuggestion })}
                </button>
              {/if}
            {/if}
          </div>
        </section>
      {:else if currentStep === "adminKey"}
        <section class="setup-step">
          <h2 class="setup-step__title">{t("FUSION.Setup.Step.AdminKey.Title")}</h2>
          <p class="setup-step__hint">{t("FUSION.Setup.Step.AdminKey.Hint")}</p>
          <label class="field">
            <span class="field__label">{t("FUSION.Setup.Step.AdminKey.Label")}</span>
            <input type="password" bind:value={adminKey} autocomplete="new-password" />
          </label>
          <label class="field">
            <span class="field__label">{t("FUSION.Setup.Step.AdminKey.Confirm")}</span>
            <input type="password" bind:value={adminKeyConfirm} autocomplete="new-password" />
          </label>
          <div aria-live="polite">
            {#if adminKey.length > 0 && !adminKeyValid}
              <p class="setup-step__status setup-step__status--error">
                <Icon name="triangle-alert" size={18} />
                {t("FUSION.Setup.Step.AdminKey.TooShort")}
              </p>
            {:else if adminKeyConfirm.length > 0 && !adminKeyMatches}
              <p class="setup-step__status setup-step__status--error">
                <Icon name="triangle-alert" size={18} />
                {t("FUSION.Setup.Step.AdminKey.Mismatch")}
              </p>
            {/if}
          </div>
        </section>
      {:else if currentStep === "connectivity"}
        <section class="setup-step">
          <h2 class="setup-step__title">{t("FUSION.Setup.Step.Connectivity.Title")}</h2>
          <p class="setup-step__hint">{t("FUSION.Setup.Step.Connectivity.Hint")}</p>
          <dl class="setup-summary">
            <div>
              <dt>{t("FUSION.Setup.Step.Connectivity.DataDir")}</dt>
              <dd class="setup-summary__path">{dataDir}</dd>
            </div>
            <div>
              <dt>{t("FUSION.Setup.Step.Connectivity.Port")}</dt>
              <dd>{port}</dd>
            </div>
          </dl>
          {#if initialState && initialState.lanUrls.length > 0}
            <div class="setup-lan">
              {#each initialState.lanUrls as url (url)}
                <div class="setup-lan__entry">
                  <QrCode value={url} size={140} label={t("FUSION.Setup.QrLabel", { url })} />
                  <code>{url}</code>
                </div>
              {/each}
            </div>
          {:else}
            <p class="setup-step__hint">{t("FUSION.Setup.Step.Connectivity.NoLan")}</p>
          {/if}
        </section>
      {/if}

      <div class="setup-nav">
        <button type="button" class="btn btn--secondary" onclick={prevStep} disabled={stepIndex === 0 || applying}>
          <Icon name="arrow-left" size={18} />
          {t("FUSION.Setup.Nav.Back")}
        </button>
        <button type="button" class="btn btn--primary" onclick={nextStep} disabled={!canAdvance || applying}>
          {#if applying}
            {t("FUSION.Setup.Nav.Applying")}
          {:else if stepIndex === STEPS.length - 1}
            {t("FUSION.Setup.Nav.Finish")}
            <Icon name="check" size={18} />
          {:else}
            {t("FUSION.Setup.Nav.Next")}
            <Icon name="arrow-right" size={18} />
          {/if}
        </button>
      </div>
    {:else if phase === "done"}
      <div class="setup-done">
        <div class="alert alert--success" role="status">
          <Icon name="check" size={20} />
          <p>{t("FUSION.Setup.Done.Complete")}</p>
        </div>

        {#if applyResult?.restartRequired}
          <div class="alert alert--warning" role="alert">
            <Icon name="triangle-alert" size={20} />
            <p>{t("FUSION.Setup.Done.RestartRequired")}</p>
          </div>
        {/if}

        <h2 class="setup-step__title">{t("FUSION.Setup.Done.InvitePlayers")}</h2>
        {#if primaryLanUrl}
          <div class="setup-lan">
            <div class="setup-lan__entry">
              <QrCode value={primaryLanUrl} size={180} label={t("FUSION.Setup.QrLabel", { url: primaryLanUrl })} />
              <code>{primaryLanUrl}</code>
            </div>
          </div>
        {/if}

        <div class="setup-step__actions-inline">
          <button type="button" class="btn btn--secondary" onclick={createShortcut} disabled={shortcutStatus === "creating"}>
            {shortcutStatus === "creating" ? t("FUSION.Setup.Done.CreatingShortcut") : t("FUSION.Setup.Done.CreateShortcut")}
          </button>
          <a class="btn btn--primary" href="/">
            {t("FUSION.Setup.Done.GoToFusion")}
            <Icon name="arrow-right" size={18} />
          </a>
        </div>
        <div aria-live="polite">
          {#if shortcutStatus === "done"}
            <p class="setup-step__status setup-step__status--ok">{shortcutMessage}</p>
          {:else if shortcutStatus === "error"}
            <p class="setup-step__status setup-step__status--error">{shortcutMessage}</p>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .setup-shell {
    /* html/body never scroll (the table fills the viewport), so the screen scrolls
       itself; the card centres with margin: auto, which never clips its top. */
    background-color: var(--fusion-bg);
    color: var(--fusion-text);
    display: flex;
    height: 100%;
    overflow-y: auto;
    padding: var(--fusion-space-8) var(--fusion-space-4);
  }

  .setup-card {
    margin: auto;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-5);
    max-width: 520px;
    padding: var(--fusion-space-8) var(--fusion-space-6);
    width: 100%;
  }

  .setup-card__header {
    align-items: center;
    color: var(--fusion-accent);
    display: flex;
    gap: var(--fusion-space-4);
  }

  .setup-card__title {
    color: var(--fusion-text);
    font-size: var(--fusion-text-xl);
    font-weight: var(--fusion-weight-bold);
    line-height: var(--fusion-leading-tight);
  }

  .setup-card__meta {
    color: var(--fusion-text-subtle);
    font-size: var(--fusion-text-xs);
    margin-top: var(--fusion-space-1);
  }

  .setup-status {
    color: var(--fusion-text-muted);
  }

  .setup-form,
  .setup-step,
  .setup-done {
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-3);
  }

  .setup-progress {
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-2);
  }

  .setup-progress__text {
    color: var(--fusion-text-muted);
    font-size: var(--fusion-text-sm);
  }

  .setup-progress__bar {
    display: grid;
    gap: var(--fusion-space-1);
    grid-auto-flow: column;
  }

  .setup-progress__seg {
    background: var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    height: 4px;
  }

  .setup-progress__seg--on {
    background: var(--fusion-accent);
  }

  .setup-step__title {
    font-size: var(--fusion-text-lg);
    font-weight: var(--fusion-weight-bold);
  }

  .setup-step__hint {
    color: var(--fusion-text-muted);
    font-size: var(--fusion-text-base);
    max-width: var(--fusion-measure);
  }

  .setup-step__actions-inline {
    display: flex;
    flex-wrap: wrap;
    gap: var(--fusion-space-2);
  }

  .setup-step__status {
    align-items: center;
    display: flex;
    font-size: var(--fusion-text-sm);
    gap: var(--fusion-space-2);
    margin-bottom: var(--fusion-space-2);
  }

  .setup-step__status--ok {
    color: var(--fusion-success);
  }

  .setup-step__status--error {
    color: var(--fusion-danger);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-1);
  }

  .field--narrow {
    max-width: 12rem;
  }

  .field__label {
    color: var(--fusion-text);
    font-size: var(--fusion-text-sm);
    font-weight: var(--fusion-weight-medium);
  }

  .field input {
    background: var(--fusion-input-bg);
    border: 1px solid var(--fusion-border-strong);
    border-radius: var(--fusion-radius);
    color: var(--fusion-text);
    font-size: var(--fusion-text-base);
    min-height: var(--fusion-target);
    min-width: 0;
    padding: var(--fusion-space-2) var(--fusion-space-3);
  }

  .field input:focus {
    border-color: var(--fusion-accent);
  }

  .setup-summary {
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-2);
  }

  .setup-summary dt {
    color: var(--fusion-text-muted);
    font-size: var(--fusion-text-sm);
  }

  .setup-summary__path {
    font-family: var(--fusion-font-mono);
    font-size: var(--fusion-text-sm);
    overflow-wrap: anywhere;
  }

  .setup-lan {
    display: flex;
    flex-wrap: wrap;
    gap: var(--fusion-space-5);
    justify-content: center;
  }

  .setup-lan__entry {
    align-items: center;
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-2);
  }

  .setup-lan__entry code {
    color: var(--fusion-text);
    font-family: var(--fusion-font-mono);
    font-size: var(--fusion-text-sm);
    overflow-wrap: anywhere;
  }

  .setup-nav {
    display: flex;
    gap: var(--fusion-space-2);
    justify-content: space-between;
    margin-top: var(--fusion-space-2);
  }

  .setup-nav--end {
    justify-content: flex-end;
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
    text-decoration: none;
    transition: background-color var(--fusion-transition);
  }

  .btn--primary {
    background: var(--fusion-accent);
    color: var(--fusion-on-accent);
    font-weight: var(--fusion-weight-bold);
  }

  .btn--primary:not(:disabled):hover {
    background: var(--fusion-accent-hover);
  }

  .btn--secondary {
    background: var(--fusion-surface-alt);
    border-color: var(--fusion-border-strong);
    color: var(--fusion-text);
  }

  .btn--secondary:not(:disabled):hover {
    border-color: var(--fusion-accent);
  }

  /* Disabled keeps AA text: "not yet", not a faded accent. */
  .btn:disabled {
    background: var(--fusion-surface-alt);
    border-color: var(--fusion-border);
    color: var(--fusion-text-subtle);
    cursor: not-allowed;
  }

  .alert {
    align-items: flex-start;
    border: 1px solid currentColor;
    border-radius: var(--fusion-radius);
    display: flex;
    font-size: var(--fusion-text-sm);
    gap: var(--fusion-space-2);
    padding: var(--fusion-space-3);
  }

  .alert p {
    color: var(--fusion-text);
  }

  .alert--danger {
    background: var(--fusion-danger-dim);
    color: var(--fusion-danger);
  }

  .alert--warning {
    background: var(--fusion-warning-dim);
    color: var(--fusion-warning);
  }

  .alert--success {
    background: var(--fusion-success-dim);
    color: var(--fusion-success);
  }

  @media (max-width: 480px) {
    .setup-shell {
      padding: var(--fusion-space-3);
    }

    .setup-card {
      padding: var(--fusion-space-6) var(--fusion-space-4);
    }
  }
</style>
