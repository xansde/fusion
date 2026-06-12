<script lang="ts">
  /**
   * JoinScreen.svelte — world join / login UI.
   *
   * REQ-USR-017: shows active users list from GET /api/world.
   * REQ-USR-018: shows password field only if the selected user has one.
   * REQ-SEC-014: access token is NEVER stored in localStorage.
   * REQ-USR-023: shows lockout state + retry countdown.
   * REQ-NET-014: surface PROTOCOL_MISMATCH with a reload prompt.
   */

  import { session, sessionActions } from "../lib/session.svelte.js";
  import { PROTOCOL_VERSION } from "@fusion/shared";

  // ---- Local state ----
  let selectedUserId = $state<string | null>(null);
  let password = $state("");
  let loading = $state(false);

  // ---- Derived ----
  const users = $derived(session.worldInfo?.users ?? []);
  const selectedUser = $derived(users.find((u) => u.id === selectedUserId) ?? null);
  const needsPassword = $derived(selectedUser?.hasPassword ?? false);

  const canSubmit = $derived(
    selectedUserId !== null &&
      !loading &&
      !session.lockedOut &&
      (!needsPassword || password.length > 0),
  );

  // ---- Handlers ----
  function selectUser(id: string): void {
    selectedUserId = id;
    password = "";
    session.error = null;
  }

  async function handleSubmit(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (!canSubmit || !selectedUserId) return;

    loading = true;
    try {
      await sessionActions.login(selectedUserId, needsPassword ? password : undefined);
    } finally {
      loading = false;
    }
  }

  // Protocol mismatch means the server rejected the WS handshake
  const protocolMismatch = $derived(session.connection === "protocol_mismatch");

  // NOTE: role is intentionally NOT displayed in the join list.
  // The public endpoint (REQ-USR-037) does not expose role; showing it would
  // require either leaking it from the server or using a misleading hard-coded
  // value (the previous code always rendered "Player" regardless of actual role).
</script>

<div class="join-shell">
  <div class="join-card">
    <!-- Header -->
    <header class="join-card__header">
      <div class="join-card__logo" aria-hidden="true">&#9889;</div>
      <div class="join-card__titles">
        <h1 class="join-card__world-name">
          {session.worldInfo?.title ?? "Fusion VTT"}
        </h1>
        <p class="join-card__meta">
          protocol&nbsp;{PROTOCOL_VERSION}
          {#if session.worldInfo?.systemId}
            &middot; {session.worldInfo.systemId}
          {/if}
        </p>
      </div>
    </header>

    <!-- Protocol mismatch banner -->
    {#if protocolMismatch}
      <div class="alert alert--warning" role="alert">
        <strong>Version mismatch.</strong>
        The server runs an incompatible protocol version. Please
        <button
          class="alert__link"
          onclick={() => window.location.reload()}
        >reload the page</button>
        to get the latest client.
      </div>
    {/if}

    <!-- Error banner -->
    {#if session.error && !protocolMismatch}
      <div class="alert alert--danger" role="alert">
        {session.error}
      </div>
    {/if}

    <!-- User picker -->
    <form class="join-form" onsubmit={handleSubmit}>
      <fieldset class="join-form__fieldset" disabled={loading}>
        <legend class="join-form__legend">Choose your character</legend>

        {#if users.length === 0}
          <p class="join-form__empty">No users found. Is the server running?</p>
        {:else}
          <ul class="user-list" role="listbox" aria-label="Select your user">
            {#each users as user (user.id)}
              {@const isSelected = selectedUserId === user.id}
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  class="user-item"
                  class:user-item--selected={isSelected}
                  onclick={() => selectUser(user.id)}
                >
                  <!-- Color swatch -->
                  <span
                    class="user-item__swatch"
                    style="background-color: {user.color}"
                    aria-hidden="true"
                  ></span>
                  <!-- Name only — role is not a public field (REQ-USR-037) -->
                  <span class="user-item__name">{user.name}</span>
                  <!-- Lock icon when password required -->
                  {#if user.hasPassword}
                    <span class="user-item__lock" aria-label="Password required">&#128274;</span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        <!-- Password field — only when selected user requires it -->
        {#if needsPassword && selectedUserId !== null}
          <div class="join-form__field" transition:slide={{ duration: 150 }}>
            <label class="join-form__label" for="join-password">
              Password for <strong>{selectedUser?.name}</strong>
            </label>
            <input
              id="join-password"
              class="join-form__input"
              type="password"
              autocomplete="current-password"
              placeholder="Enter password"
              bind:value={password}
            />
          </div>
        {/if}
      </fieldset>

      <button
        class="btn btn--primary btn--wide"
        type="submit"
        disabled={!canSubmit}
      >
        {#if loading}
          Connecting…
        {:else if session.lockedOut}
          Locked out — wait {session.retryAfterSecs}s
        {:else}
          Join World
        {/if}
      </button>
    </form>
  </div>
</div>

<script module lang="ts">
  // Svelte 5: transition import must be in <script module> when used in template
  import { slide } from "svelte/transition";
</script>

<style>
  .join-shell {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background-color: var(--fusion-bg);
    padding: 1rem;
  }

  .join-card {
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    padding: 2rem;
    width: 100%;
    max-width: 440px;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  /* Header */
  .join-card__header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .join-card__logo {
    font-size: 2rem;
    line-height: 1;
    flex-shrink: 0;
  }

  .join-card__world-name {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--fusion-text);
    line-height: 1.2;
  }

  .join-card__meta {
    font-size: 0.75rem;
    color: var(--fusion-text-subtle);
    font-family: var(--fusion-font-mono);
  }

  /* Alert banners */
  .alert {
    border-radius: var(--fusion-radius-sm);
    font-size: 0.8125rem;
    padding: 0.6rem 0.875rem;
    line-height: 1.4;
  }

  .alert--danger {
    background: rgba(255, 92, 92, 0.12);
    border: 1px solid rgba(255, 92, 92, 0.35);
    color: var(--fusion-danger);
  }

  .alert--warning {
    background: rgba(255, 200, 87, 0.12);
    border: 1px solid rgba(255, 200, 87, 0.35);
    color: var(--fusion-warning);
  }

  .alert__link {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    font-weight: 600;
    padding: 0;
    text-decoration: underline;
  }

  /* Form */
  .join-form__fieldset {
    border: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .join-form__legend {
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--fusion-text-muted);
    margin-bottom: 0.5rem;
    float: left;
    width: 100%;
  }

  .join-form__empty {
    font-size: 0.875rem;
    color: var(--fusion-text-subtle);
    text-align: center;
    padding: 1rem;
  }

  /* User list */
  .user-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .user-item {
    align-items: center;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    cursor: pointer;
    display: flex;
    font-family: var(--fusion-font);
    font-size: 0.875rem;
    gap: 0.6rem;
    padding: 0.55rem 0.75rem;
    text-align: left;
    transition: border-color var(--fusion-transition), background-color var(--fusion-transition);
    width: 100%;
  }

  .user-item:hover {
    border-color: var(--fusion-accent);
    background-color: var(--fusion-accent-dim);
  }

  .user-item--selected {
    border-color: var(--fusion-accent);
    background-color: var(--fusion-accent-dim);
  }

  .user-item__swatch {
    border-radius: 50%;
    display: block;
    flex-shrink: 0;
    height: 12px;
    width: 12px;
  }

  .user-item__name {
    flex: 1;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .user-item__lock {
    flex-shrink: 0;
    font-size: 0.75rem;
  }

  /* Password field */
  .join-form__field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .join-form__label {
    color: var(--fusion-text-muted);
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .join-form__input {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: 0.875rem;
    outline: none;
    padding: 0.5rem 0.75rem;
    transition: border-color var(--fusion-transition);
    width: 100%;
  }

  .join-form__input:focus {
    border-color: var(--fusion-accent);
    box-shadow: 0 0 0 3px var(--fusion-accent-dim);
  }

  /* Submit button */
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
    opacity: 0.45;
  }

  .btn--primary {
    background-color: var(--fusion-accent);
    color: #fff;
  }

  .btn--primary:hover:not(:disabled) {
    background-color: var(--fusion-accent-hover);
  }

  .btn--wide {
    width: 100%;
  }
</style>
