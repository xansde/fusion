<script lang="ts">
  /**
   * App.svelte — root shell component (Svelte 5 runes).
   *
   * M0-A: placeholder UI that proves the shared→client boundary works by
   * importing PROTOCOL_VERSION from @fusion/shared.
   *
   * M0-C will replace this with the real auth/join flow.
   * REQ-ARQ-003: no imports from @fusion/server.
   * REQ-ARQ-015: protocol mismatch screen is wired up here (placeholder).
   */

  import { PROTOCOL_VERSION } from "@fusion/shared";

  const ENGINE_VERSION = "0.1.0";

  // Svelte 5 runes — reactive state
  let screen = $state<"splash" | "join">("splash");

  function goToJoin(): void {
    screen = "join";
  }

  function goToSplash(): void {
    screen = "splash";
  }
</script>

<div class="fusion-shell">
  {#if screen === "splash"}
    <!-- ------------------------------------------------------------------ -->
    <!-- Splash / landing screen                                              -->
    <!-- ------------------------------------------------------------------ -->
    <div class="splash">
      <div class="splash__logo" aria-hidden="true">⚡</div>
      <h1 class="splash__title">Fusion</h1>
      <p class="splash__subtitle">Virtual Tabletop</p>
      <p class="splash__version">
        {ENGINE_VERSION} &middot; protocol&nbsp;{PROTOCOL_VERSION}
      </p>

      <div class="splash__actions">
        <button class="btn btn--primary" onclick={goToJoin}>
          Join a World
        </button>
      </div>

      <p class="splash__note">
        Full authentication and world management arrive in M0-C.
      </p>
    </div>

  {:else if screen === "join"}
    <!-- ------------------------------------------------------------------ -->
    <!-- Join / login placeholder (static — no auth logic yet, M0-C)        -->
    <!-- ------------------------------------------------------------------ -->
    <div class="join-panel">
      <header class="join-panel__header">
        <button class="btn btn--ghost btn--sm" onclick={goToSplash}>
          &larr; Back
        </button>
        <h2>Join World</h2>
      </header>

      <div class="join-panel__body">
        <div class="field">
          <label for="server-url" class="field__label">Server URL</label>
          <input
            id="server-url"
            class="field__input"
            type="url"
            placeholder="http://localhost:33000"
            autocomplete="off"
            spellcheck={false}
          />
        </div>

        <div class="field">
          <label for="username" class="field__label">Username</label>
          <input
            id="username"
            class="field__input"
            type="text"
            placeholder="Your name"
            autocomplete="username"
          />
        </div>

        <div class="field">
          <label for="password" class="field__label">Password</label>
          <input
            id="password"
            class="field__input"
            type="password"
            placeholder="Leave blank if none"
            autocomplete="current-password"
          />
        </div>

        <button class="btn btn--primary btn--wide" disabled>
          Connect (M0-C)
        </button>

        <p class="join-panel__hint">
          WebSocket auth and world selection will be implemented in milestone M0-C.
        </p>
      </div>
    </div>
  {/if}
</div>

<style>
  /* Shell fills the viewport */
  .fusion-shell {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--fusion-bg);
  }

  /* ---- Splash ---- */
  .splash {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    text-align: center;
    padding: 2rem;
    max-width: 420px;
    width: 100%;
  }

  .splash__logo {
    font-size: 3rem;
    line-height: 1;
    margin-bottom: 0.25rem;
  }

  .splash__title {
    font-size: 2.5rem;
    font-weight: 700;
    letter-spacing: -0.02em;
    color: var(--fusion-text);
  }

  .splash__subtitle {
    font-size: 1rem;
    color: var(--fusion-text-muted);
    margin-top: -0.25rem;
  }

  .splash__version {
    font-family: var(--fusion-font-mono);
    font-size: 0.75rem;
    color: var(--fusion-text-subtle);
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    padding: 0.2rem 0.6rem;
    margin-top: 0.25rem;
  }

  .splash__actions {
    margin-top: 1.5rem;
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
    justify-content: center;
  }

  .splash__note {
    margin-top: 1rem;
    font-size: 0.75rem;
    color: var(--fusion-text-subtle);
  }

  /* ---- Join panel ---- */
  .join-panel {
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    padding: 2rem;
    max-width: 420px;
    width: 100%;
  }

  .join-panel__header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .join-panel__header h2 {
    font-size: 1.25rem;
  }

  .join-panel__body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .join-panel__hint {
    font-size: 0.75rem;
    color: var(--fusion-text-subtle);
    text-align: center;
    margin-top: 0.25rem;
  }

  /* ---- Form fields ---- */
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .field__label {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--fusion-text-muted);
  }

  .field__input {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: 0.875rem;
    padding: 0.5rem 0.75rem;
    outline: none;
    transition: border-color var(--fusion-transition);
    width: 100%;
  }

  .field__input:focus {
    border-color: var(--fusion-accent);
    box-shadow: 0 0 0 3px var(--fusion-accent-dim);
  }

  .field__input::placeholder {
    color: var(--fusion-text-subtle);
  }

  /* ---- Buttons ---- */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: 0.875rem;
    font-weight: 500;
    padding: 0.5rem 1.25rem;
    transition:
      background-color var(--fusion-transition),
      border-color var(--fusion-transition),
      opacity var(--fusion-transition);
    white-space: nowrap;
  }

  .btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .btn--primary {
    background-color: var(--fusion-accent);
    color: #fff;
  }

  .btn--primary:hover:not(:disabled) {
    background-color: var(--fusion-accent-hover);
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

  .btn--wide {
    width: 100%;
  }
</style>
