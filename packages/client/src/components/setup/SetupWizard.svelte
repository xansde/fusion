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
      <div class="setup-card__logo" aria-hidden="true">&#9889;</div>
      <div>
        <h1>{t("FUSION.Setup.Title")}</h1>
        {#if initialState}
          <p class="setup-card__meta">{t("FUSION.Setup.Version", { version: initialState.serverVersion })}</p>
        {/if}
      </div>
    </header>

    {#if phase === "loading"}
      <p class="setup-status" role="status">{t("FUSION.Setup.Loading")}</p>
    {:else if phase === "fatal-error"}
      <div class="alert alert--danger" role="alert">{fatalMessage}</div>
    {:else if phase === "reconfig-auth"}
      <form class="setup-form" onsubmit={submitReconfigAuth}>
        <p>{t("FUSION.Setup.Reconfig.Intro")}</p>
        {#if reconfigError}
          <div class="alert alert--danger" role="alert">{reconfigError}</div>
        {/if}
        <label class="field">
          <span>{t("FUSION.Setup.Reconfig.AdminKey")}</span>
          <input type="password" bind:value={reconfigAdminKey} autocomplete="current-password" />
        </label>
        <button type="submit" class="btn btn--primary" disabled={reconfigLoading}>
          {reconfigLoading ? t("FUSION.Setup.Reconfig.Verifying") : t("FUSION.Setup.Reconfig.Continue")}
        </button>
      </form>
    {:else if phase === "form"}
      <div class="setup-steps" role="tablist" aria-label="Setup steps">
        {#each STEPS as step, i (step)}
          <div class="setup-steps__dot" class:setup-steps__dot--active={i === stepIndex} class:setup-steps__dot--done={i < stepIndex}></div>
        {/each}
      </div>

      {#if applyError}
        <div class="alert alert--danger" role="alert">{applyError}</div>
      {/if}

      {#if currentStep === "dataDir"}
        <section class="setup-step">
          <h2>{t("FUSION.Setup.Step.DataDir.Title")}</h2>
          <p class="setup-step__hint">{t("FUSION.Setup.Step.DataDir.Hint")}</p>
          <label class="field">
            <span>{t("FUSION.Setup.Step.DataDir.Path")}</span>
            <input type="text" bind:value={dataDir} />
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
          <h2>{t("FUSION.Setup.Step.Port.Title")}</h2>
          <p class="setup-step__hint">{t("FUSION.Setup.Step.Port.Hint")}</p>
          <label class="field">
            <span>{t("FUSION.Setup.Step.Port.Label")}</span>
            <input
              type="number"
              min="1024"
              max="65535"
              bind:value={port}
              oninput={handlePortInput}
            />
          </label>
          {#if portCheckStatus === "checking"}
            <p class="setup-step__status">{t("FUSION.Setup.Step.Port.Checking")}</p>
          {:else if portCheckStatus === "available"}
            <p class="setup-step__status setup-step__status--ok">{t("FUSION.Setup.Step.Port.Available", { port })}</p>
          {:else if portCheckStatus === "unavailable"}
            <p class="setup-step__status setup-step__status--error">
              {t("FUSION.Setup.Step.Port.Unavailable", { port })}
              {#if portSuggestion !== null}
                <button type="button" class="link-btn" onclick={useSuggestedPort}>
                  {t("FUSION.Setup.Step.Port.UseSuggestion", { port: portSuggestion })}
                </button>
              {/if}
            </p>
          {/if}
        </section>
      {:else if currentStep === "adminKey"}
        <section class="setup-step">
          <h2>{t("FUSION.Setup.Step.AdminKey.Title")}</h2>
          <p class="setup-step__hint">
            {t("FUSION.Setup.Step.AdminKey.Hint")}
          </p>
          <label class="field">
            <span>{t("FUSION.Setup.Step.AdminKey.Label")}</span>
            <input type="password" bind:value={adminKey} autocomplete="new-password" />
          </label>
          <label class="field">
            <span>{t("FUSION.Setup.Step.AdminKey.Confirm")}</span>
            <input type="password" bind:value={adminKeyConfirm} autocomplete="new-password" />
          </label>
          {#if adminKey.length > 0 && !adminKeyValid}
            <p class="setup-step__status setup-step__status--error">
              {t("FUSION.Setup.Step.AdminKey.TooShort")}
            </p>
          {:else if adminKeyConfirm.length > 0 && !adminKeyMatches}
            <p class="setup-step__status setup-step__status--error">{t("FUSION.Setup.Step.AdminKey.Mismatch")}</p>
          {/if}
        </section>
      {:else if currentStep === "connectivity"}
        <section class="setup-step">
          <h2>{t("FUSION.Setup.Step.Connectivity.Title")}</h2>
          <p class="setup-step__hint">{t("FUSION.Setup.Step.Connectivity.Hint")}</p>
          <ul class="setup-summary">
            <li><strong>{t("FUSION.Setup.Step.Connectivity.DataDir")}:</strong> {dataDir}</li>
            <li><strong>{t("FUSION.Setup.Step.Connectivity.Port")}:</strong> {port}</li>
          </ul>
          {#if initialState && initialState.lanUrls.length > 0}
            <div class="setup-lan">
              {#each initialState.lanUrls as url (url)}
                <div class="setup-lan__entry">
                  <QrCode value={url} size={140} />
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
          {t("FUSION.Setup.Nav.Back")}
        </button>
        <button type="button" class="btn btn--primary" onclick={nextStep} disabled={!canAdvance || applying}>
          {#if applying}
            {t("FUSION.Setup.Nav.Applying")}
          {:else if stepIndex === STEPS.length - 1}
            {t("FUSION.Setup.Nav.Finish")}
          {:else}
            {t("FUSION.Setup.Nav.Next")}
          {/if}
        </button>
      </div>
    {:else if phase === "done"}
      <div class="setup-done">
        <div class="alert alert--success" role="status">{t("FUSION.Setup.Done.Complete")}</div>

        {#if applyResult?.restartRequired}
          <div class="alert alert--warning" role="alert">
            {t("FUSION.Setup.Done.RestartRequired")}
          </div>
        {/if}

        <h2>{t("FUSION.Setup.Done.InvitePlayers")}</h2>
        {#if primaryLanUrl}
          <div class="setup-lan">
            <div class="setup-lan__entry">
              <QrCode value={primaryLanUrl} size={180} />
              <code>{primaryLanUrl}</code>
            </div>
          </div>
        {/if}

        <div class="setup-step__actions-inline">
          <button type="button" class="btn btn--secondary" onclick={createShortcut} disabled={shortcutStatus === "creating"}>
            {shortcutStatus === "creating" ? t("FUSION.Setup.Done.CreatingShortcut") : t("FUSION.Setup.Done.CreateShortcut")}
          </button>
          <a class="btn btn--primary" href="/">{t("FUSION.Setup.Done.GoToFusion")}</a>
        </div>
        {#if shortcutStatus === "done"}
          <p class="setup-step__status setup-step__status--ok">{shortcutMessage}</p>
        {:else if shortcutStatus === "error"}
          <p class="setup-step__status setup-step__status--error">{shortcutMessage}</p>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .setup-shell {
    align-items: center;
    background: var(--fusion-bg);
    color: var(--fusion-text);
    display: flex;
    font-family: var(--fusion-font);
    justify-content: center;
    min-height: 100vh;
    padding: 2rem 1rem;
  }

  .setup-card {
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    max-width: 480px;
    padding: 2rem;
    width: 100%;
  }

  .setup-card__header {
    align-items: center;
    display: flex;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .setup-card__logo {
    font-size: 1.75rem;
  }

  .setup-card__header h1 {
    font-size: 1.15rem;
    font-weight: 600;
  }

  .setup-card__meta {
    color: var(--fusion-text-subtle);
    font-size: 0.75rem;
  }

  .setup-status {
    color: var(--fusion-text-muted);
  }

  .setup-steps {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    margin-bottom: 1.5rem;
  }

  .setup-steps__dot {
    background: var(--fusion-border);
    border-radius: 50%;
    height: 8px;
    width: 8px;
  }

  .setup-steps__dot--active {
    background: var(--fusion-accent);
  }

  .setup-steps__dot--done {
    background: var(--fusion-accent-dim);
  }

  .setup-step h2 {
    font-size: 1rem;
    margin-bottom: 0.25rem;
  }

  .setup-step__hint {
    color: var(--fusion-text-muted);
    font-size: 0.8125rem;
    margin-bottom: 1rem;
  }

  .setup-step__actions-inline {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.5rem;
  }

  .setup-step__status {
    font-size: 0.8125rem;
    margin-top: 0.5rem;
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
    gap: 0.25rem;
    margin-bottom: 0.75rem;
  }

  .field span {
    color: var(--fusion-text-muted);
    font-size: 0.75rem;
  }

  .field input {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-family: inherit;
    padding: 0.5rem 0.625rem;
  }

  .setup-summary {
    font-size: 0.8125rem;
    list-style: none;
    margin-bottom: 1rem;
  }

  .setup-summary li {
    padding: 0.25rem 0;
  }

  .setup-lan {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .setup-lan__entry {
    align-items: center;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .setup-lan__entry code {
    color: var(--fusion-text-muted);
    font-family: var(--fusion-font-mono);
    font-size: 0.8125rem;
  }

  .setup-nav {
    display: flex;
    gap: 0.5rem;
    justify-content: space-between;
    margin-top: 1.5rem;
  }

  .setup-done {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .btn {
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    font-family: inherit;
    font-size: 0.8125rem;
    padding: 0.5rem 1rem;
    text-decoration: none;
    transition: background var(--fusion-transition);
  }

  .btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .btn--primary {
    background: var(--fusion-accent);
    color: #fff;
  }

  .btn--primary:not(:disabled):hover {
    background: var(--fusion-accent-hover);
  }

  .btn--secondary {
    background: var(--fusion-surface-alt);
    border-color: var(--fusion-border);
    color: var(--fusion-text);
  }

  .link-btn {
    background: none;
    border: none;
    color: var(--fusion-accent);
    cursor: pointer;
    font-size: inherit;
    padding: 0;
    text-decoration: underline;
  }

  .alert {
    border-radius: var(--fusion-radius-sm);
    font-size: 0.8125rem;
    margin-bottom: 1rem;
    padding: 0.625rem 0.75rem;
  }

  .alert--danger {
    background: rgba(255, 92, 92, 0.12);
    color: var(--fusion-danger);
  }

  .alert--warning {
    background: rgba(255, 200, 87, 0.12);
    color: var(--fusion-warning);
  }

  .alert--success {
    background: rgba(61, 220, 132, 0.12);
    color: var(--fusion-success);
  }
</style>
