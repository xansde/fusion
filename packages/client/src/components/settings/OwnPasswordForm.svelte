<script lang="ts">
  /**
   * OwnPasswordForm.svelte — "Trocar a minha senha" (spec 37 REQ-CFG-090, spec 05 REQ-USR-040..042).
   *
   * Open to every seat, GM or player. The one thing in "Minhas preferências" that reaches the server
   * (the explicit exception of REQ-CFG-022): authentication state is not a device preference. It talks to
   * `POST /api/users/me/password` through `usersApi.changeOwnPassword` — plain HTTP with the bearer token,
   * never the socket. Success keeps THIS session signed in and signs the user's other devices out
   * (REQ-USR-042); the form says so, and clears the three fields so a password never sits in the DOM.
   */

  import { t } from "../../lib/i18n/i18n.js";
  import { fusionApi } from "../../lib/api.js";
  import { changeOwnPassword } from "../../lib/settings/usersApi.js";
  import {
    ownPasswordFailureKey,
    validateOwnPasswordForm,
  } from "../../lib/settings/ownPasswordForm.js";

  let current = $state("");
  let next = $state("");
  let confirm = $state("");
  let busy = $state(false);
  let errorKey = $state<string | null>(null);
  let saved = $state(false);

  async function handleSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    saved = false;

    const invalid = validateOwnPasswordForm({ current, next, confirm });
    if (invalid !== null) {
      errorKey = invalid;
      return;
    }

    busy = true;
    errorKey = null;
    try {
      await changeOwnPassword((await fusionApi.getFreshToken()) ?? "", {
        ...(current.length > 0 ? { currentPassword: current } : {}),
        newPassword: next,
      });
      current = "";
      next = "";
      confirm = "";
      saved = true;
    } catch (err) {
      errorKey = ownPasswordFailureKey(err);
    } finally {
      busy = false;
    }
  }
</script>

<form class="own-password" onsubmit={handleSubmit}>
  <p class="own-password__hint">{t("FUSION.Settings.Preferences.Password.Hint")}</p>

  <label class="own-password__field">
    <span>{t("FUSION.Settings.Preferences.Password.Current")}</span>
    <input type="password" autocomplete="current-password" bind:value={current} />
    <small>{t("FUSION.Settings.Preferences.Password.CurrentHint")}</small>
  </label>

  <label class="own-password__field">
    <span>{t("FUSION.Settings.Preferences.Password.New")}</span>
    <input type="password" autocomplete="new-password" bind:value={next} />
  </label>

  <label class="own-password__field">
    <span>{t("FUSION.Settings.Preferences.Password.Confirm")}</span>
    <input type="password" autocomplete="new-password" bind:value={confirm} />
  </label>

  {#if errorKey !== null}
    <p class="own-password__message own-password__message--error" role="alert">{t(errorKey)}</p>
  {:else if saved}
    <p class="own-password__message" role="status">
      {t("FUSION.Settings.Preferences.Password.Saved")}
    </p>
  {/if}

  <button type="submit" disabled={busy}>
    {t("FUSION.Settings.Preferences.Password.Submit")}
  </button>
</form>

<style>
  .own-password {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .own-password__hint {
    color: var(--fusion-text-muted);
    font-size: var(--fusion-text-sm);
    margin: 0;
  }

  .own-password__field {
    color: var(--fusion-text);
    display: flex;
    flex-direction: column;
    font-size: var(--fusion-text-base);
    gap: 0.25rem;
  }

  .own-password__field input {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font: inherit;
    padding: 0.3rem 0.4rem;
    min-height: var(--fusion-target);
  }

  .own-password__field small {
    color: var(--fusion-text-muted);
    font-size: var(--fusion-text-sm);
  }

  .own-password__message {
    font-size: var(--fusion-text-base);
    margin: 0;
  }

  .own-password__message--error {
    color: var(--fusion-danger);
  }

  button {
    align-self: flex-start;
    background: var(--fusion-accent);
    border: none;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-on-accent);
    cursor: pointer;
    font: inherit;
    padding: 0.35rem 0.6rem;
    min-height: var(--fusion-target);
  }

  button:hover:not(:disabled) {
    background: var(--fusion-accent-hover);
  }

  button:disabled {
    cursor: default;
    opacity: 0.6;
  }
</style>
