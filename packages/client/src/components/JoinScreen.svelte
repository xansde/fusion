<script lang="ts">
  /**
   * JoinScreen.svelte — world join / login UI.
   *
   * REQ-USR-017: shows active users list from GET /api/world.
   * REQ-USR-018: shows password field only if the selected user has one.
   * REQ-SEC-014: access token is NEVER stored in localStorage.
   * REQ-USR-023: shows lockout state + retry countdown.
   * REQ-NET-014: surface PROTOCOL_MISMATCH with a reload prompt.
   *
   * ui-login-admin (22/10/2026): the language of docs/design/ui — each user is a
   * 56px row with an initials avatar on their colour ring, the selection is a
   * thicker accent border plus a check (never colour alone), the disabled button
   * keeps AA text, and the protocol/system id moved to the title's tooltip.
   */

  import { session, sessionActions } from "../lib/session.svelte.js";
  import FusionMark from "./common/FusionMark.svelte";
  import Icon from "./common/Icon.svelte";
  import { PROTOCOL_VERSION } from "@fusion/shared";
  import { t } from "../lib/i18n/i18n.js";
  import { portraitInitials } from "../lib/common/portrait.js";

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

  // Technical detail (protocol, system id) is not reading material for the
  // table: it lives in the title's tooltip for whoever needs to debug.
  const techDetail = $derived(
    [`protocolo ${String(PROTOCOL_VERSION)}`, session.worldInfo?.systemId]
      .filter((part): part is string => typeof part === "string" && part !== "")
      .join(" · "),
  );

  // NOTE: role is intentionally NOT displayed in the join list.
  // The public endpoint (REQ-USR-037) does not expose role; showing it would
  // require either leaking it from the server or using a misleading hard-coded
  // value (the previous code always rendered "Player" regardless of actual role).
</script>

<div class="join-shell">
  <div class="join-card">
    <header class="join-card__header">
      <FusionMark size={40} />
      <div class="join-card__titles">
        <h1 class="join-card__world-name" title={techDetail}>
          {session.worldInfo?.title ?? "Fusion"}
        </h1>
        <p class="join-card__lead">{t("FUSION.Join.Lead")}</p>
      </div>
    </header>

    {#if protocolMismatch}
      <div class="alert alert--warning" role="alert">
        <Icon name="triangle-alert" size={20} />
        <p>
          <strong>{t("FUSION.Join.VersionMismatch")}</strong>
          {t("FUSION.Join.VersionMismatchDetail")}
          <button class="alert__link" onclick={() => window.location.reload()}
            >{t("FUSION.Join.ReloadPage")}</button
          >
          {t("FUSION.Join.VersionMismatchEnd")}
        </p>
      </div>
    {/if}

    {#if session.error && !protocolMismatch}
      <div class="alert alert--danger" role="alert">
        <Icon name="triangle-alert" size={20} />
        <p>{session.error}</p>
      </div>
    {/if}

    <form class="join-form" onsubmit={handleSubmit}>
      <fieldset class="join-form__fieldset" disabled={loading}>
        <legend class="join-form__legend">{t("FUSION.Join.ChooseCharacter")}</legend>

        {#if users.length === 0}
          <p class="join-form__empty">{t("FUSION.Join.NoUsers")}</p>
        {:else}
          <ul class="user-list" role="listbox" aria-label={t("FUSION.Join.ChooseCharacter")}>
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
                  <!-- Initials on the user's colour ring: the colour the table knows them by
                       (cursor, chat dot). Role is not a public field (REQ-USR-037). -->
                  <span class="user-item__avatar" style:border-color={user.color} aria-hidden="true"
                    >{portraitInitials(user.name)}</span
                  >
                  <span class="user-item__text">
                    <span class="user-item__name">{user.name}</span>
                    {#if user.hasPassword}
                      <span class="user-item__note">
                        <Icon name="lock" size={16} />
                        {t("FUSION.Join.NeedsPassword")}
                      </span>
                    {/if}
                  </span>
                  {#if isSelected}
                    <span class="user-item__check"><Icon name="check" size={22} /></span>
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
              {t("FUSION.Join.PasswordFor")} <strong>{selectedUser?.name}</strong>
            </label>
            <input
              id="join-password"
              class="join-form__input"
              type="password"
              autocomplete="current-password"
              placeholder={t("FUSION.Join.PasswordPlaceholder")}
              bind:value={password}
            />
          </div>
        {/if}
      </fieldset>

      <button class="btn btn--primary btn--wide" type="submit" disabled={!canSubmit}>
        {#if loading}
          {t("FUSION.Join.Connecting")}
        {:else if session.lockedOut}
          {t("FUSION.Join.LockedOut", { secs: session.retryAfterSecs })}
        {:else}
          {t("FUSION.Join.JoinWorld")}
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
    /* html/body never scroll (the table fills the viewport), so the screen scrolls
       itself; the card centres with margin: auto, which never clips its top. */
    background-color: var(--fusion-bg);
    color: var(--fusion-text);
    display: flex;
    height: 100%;
    overflow-y: auto;
    padding: var(--fusion-space-4);
  }

  .join-card {
    margin: auto;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    padding: var(--fusion-space-8) var(--fusion-space-6);
    width: 100%;
    max-width: 460px;
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-6);
  }

  .join-card__header {
    display: flex;
    align-items: center;
    gap: var(--fusion-space-4);
    color: var(--fusion-accent);
  }

  .join-card__world-name {
    font-size: var(--fusion-text-xl);
    font-weight: var(--fusion-weight-bold);
    color: var(--fusion-text);
    line-height: var(--fusion-leading-tight);
  }

  .join-card__lead {
    font-size: var(--fusion-text-sm);
    color: var(--fusion-text-muted);
    margin-top: var(--fusion-space-1);
  }

  .alert {
    display: flex;
    align-items: flex-start;
    gap: var(--fusion-space-2);
    border: 1px solid currentColor;
    border-radius: var(--fusion-radius);
    font-size: var(--fusion-text-sm);
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

  .alert__link {
    background: none;
    border: none;
    color: var(--fusion-accent);
    cursor: pointer;
    font: inherit;
    font-weight: var(--fusion-weight-bold);
    padding: 0;
    text-decoration: underline;
  }

  .join-form {
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-5);
  }

  .join-form__fieldset {
    border: none;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-3);
  }

  .join-form__legend {
    font-size: var(--fusion-text-base);
    font-weight: var(--fusion-weight-medium);
    color: var(--fusion-text);
    margin-bottom: var(--fusion-space-3);
    float: left;
    width: 100%;
  }

  .join-form__empty {
    font-size: var(--fusion-text-base);
    color: var(--fusion-text-muted);
    padding: var(--fusion-space-4) 0;
  }

  .user-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-2);
  }

  .user-item {
    align-items: center;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    color: var(--fusion-text);
    cursor: pointer;
    display: flex;
    font-size: var(--fusion-text-base);
    gap: var(--fusion-space-3);
    min-height: 56px;
    padding: var(--fusion-space-2) var(--fusion-space-3);
    text-align: left;
    transition:
      border-color var(--fusion-transition),
      background-color var(--fusion-transition);
    width: 100%;
  }

  .user-item:hover {
    border-color: var(--fusion-border-strong);
  }

  /* Selected: thicker accent border + wash + a check — never colour alone. */
  .user-item--selected,
  .user-item--selected:hover {
    border: 2px solid var(--fusion-accent);
    background-color: var(--fusion-accent-dim);
    padding: calc(var(--fusion-space-2) - 1px) calc(var(--fusion-space-3) - 1px);
  }

  .user-item__avatar {
    display: inline-grid;
    place-items: center;
    flex: none;
    width: 40px;
    height: 40px;
    border: 3px solid;
    border-radius: 50%;
    background: var(--fusion-bg);
    color: var(--fusion-text);
    font-size: var(--fusion-text-sm);
    font-weight: var(--fusion-weight-bold);
  }

  .user-item__text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .user-item__name {
    font-weight: var(--fusion-weight-bold);
    overflow-wrap: anywhere;
  }

  .user-item__note {
    display: inline-flex;
    align-items: center;
    gap: var(--fusion-space-1);
    color: var(--fusion-text-muted);
    font-size: var(--fusion-text-sm);
  }

  .user-item__check {
    display: inline-flex;
    flex: none;
    color: var(--fusion-accent);
  }

  .join-form__field {
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-2);
  }

  .join-form__label {
    color: var(--fusion-text);
    font-size: var(--fusion-text-sm);
  }

  .join-form__input {
    background: var(--fusion-input-bg);
    border: 1px solid var(--fusion-border-strong);
    border-radius: var(--fusion-radius);
    color: var(--fusion-text);
    font-size: var(--fusion-text-base);
    min-height: var(--fusion-target);
    padding: var(--fusion-space-2) var(--fusion-space-3);
    transition: border-color var(--fusion-transition);
    width: 100%;
  }

  .join-form__input:focus {
    border-color: var(--fusion-accent);
  }

  .btn {
    align-items: center;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius);
    cursor: pointer;
    display: inline-flex;
    font-size: var(--fusion-text-base);
    font-weight: var(--fusion-weight-bold);
    justify-content: center;
    min-height: 44px;
    padding: var(--fusion-space-2) var(--fusion-space-5);
    transition: background-color var(--fusion-transition);
  }

  .btn--primary {
    background-color: var(--fusion-accent);
    color: var(--fusion-on-accent);
  }

  .btn--primary:hover:not(:disabled) {
    background-color: var(--fusion-accent-hover);
  }

  /* Disabled reads as "not yet", with AA text — not a faded accent. */
  .btn:disabled {
    background-color: var(--fusion-surface-alt);
    border-color: var(--fusion-border);
    color: var(--fusion-text-muted);
    cursor: not-allowed;
  }

  .btn--wide {
    width: 100%;
  }

  @media (max-width: 480px) {
    .join-shell {
      padding: var(--fusion-space-3);
    }

    .join-card {
      padding: var(--fusion-space-6) var(--fusion-space-4);
    }
  }
</style>
