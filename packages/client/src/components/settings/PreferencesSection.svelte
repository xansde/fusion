<script lang="ts">
  /**
   * PreferencesSection.svelte — "Minhas preferências" (spec 37 §5.3, G101).
   *
   * The one section every seat sees, privileged or not (REQ-CFG-005): the three audio
   * channels (REQ-CFG-020, REQ-AUD-015), the client's notification toggles
   * (REQ-CFG-021), and — since TK080 (spec 41-token.md REQ-TOK-074, DEC-TOK-11) — the
   * two token display toggles (names, bars). Deliberately no `socket` prop and no import
   * of `sendOp`/`socket.io` — everything here reads and writes `lib/settings/clientPrefs.ts`,
   * which never leaves the device (REQ-CFG-022, REQ-CFG-072, RNF-CFG-01). The ONE exception
   * is the own-password form (REQ-CFG-090, REQ-USR-040..042): a separate component that talks
   * plain HTTP to `POST /api/users/me/password` — authentication is not a device preference.
   * Deliberately no locale control (REQ-CFG-023). The theme (dark / light / system) IS here since
   * the 22/10/2026 amendment (DEC-CFG-11, provisional): it is a per-browser choice written by
   * `lib/ui/theme.ts` — not per world, not per seat, never on the server.
   *
   * The token-display toggle ALSO writes through `tokenDisplayPrefsStore.svelte.ts` (not
   * just `clientPrefs.ts` directly) so the already-rendered canvas updates immediately —
   * see that module's docstring. REQ-TOK-075/076: this can only ever hide a name/bar the
   * server already emitted, never reveal one it did not — the store is read-only from the
   * canvas's side.
   */

  import { t } from "../../lib/i18n/i18n.js";
  import {
    loadClientPreferences,
    setNotificationPreference,
    setVolumeChannel,
    type NotificationPreferences,
    type TokenDisplayPreferences,
    type VolumeChannel,
  } from "../../lib/settings/clientPrefs.js";
  import { setTokenDisplayPref } from "../../lib/canvas/tokens/tokenDisplayPrefsStore.svelte.js";
  import AvatarOverlayControles from "../avatar/AvatarOverlayControles.svelte";
  import OwnPasswordForm from "./OwnPasswordForm.svelte";
  import { applyTheme, readThemePreference, type ThemePreference } from "../../lib/ui/theme.js";

  interface Props {
    worldId: string;
    userId: string;
  }

  const { worldId, userId }: Props = $props();

  const VOLUME_CHANNELS: readonly VolumeChannel[] = ["music", "environment", "interface"];

  const VOLUME_LABEL_KEYS: Record<VolumeChannel, string> = {
    music: "FUSION.Settings.Preferences.Volume.Music",
    environment: "FUSION.Settings.Preferences.Volume.Environment",
    interface: "FUSION.Settings.Preferences.Volume.Interface",
  };

  // Loaded once per mount — the drawer mounts a fresh panel on every open (REQ-GAV-017),
  // so there is nothing to keep reactive to a worldId/userId change here.
  // svelte-ignore state_referenced_locally
  let prefs = $state(loadClientPreferences(worldId, userId));

  const THEME_OPTIONS: readonly { value: ThemePreference; labelKey: string }[] = [
    { value: "dark", labelKey: "FUSION.Settings.Preferences.Theme.Dark" },
    { value: "light", labelKey: "FUSION.Settings.Preferences.Theme.Light" },
    { value: "system", labelKey: "FUSION.Settings.Preferences.Theme.System" },
  ];

  function deviceStorage(): Storage | null {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  }

  let theme = $state<ThemePreference>(readThemePreference(deviceStorage()));

  function handleThemeChange(value: ThemePreference): void {
    theme = value;
    applyTheme(value);
  }

  function percentOf(channel: VolumeChannel): number {
    return Math.round(prefs.volume[channel] * 100);
  }

  function handleVolumeInput(channel: VolumeChannel, raw: string): void {
    const percent = Number(raw);
    prefs = setVolumeChannel(worldId, userId, channel, percent / 100);
  }

  function handleNotificationToggle(key: keyof NotificationPreferences, checked: boolean): void {
    prefs = setNotificationPreference(worldId, userId, key, checked);
  }

  function handleTokenDisplayToggle(key: keyof TokenDisplayPreferences, checked: boolean): void {
    prefs = setTokenDisplayPref(worldId, userId, key, checked);
  }
</script>

<div class="preferences-section">
  <!-- DEC-CFG-11 (emenda provisória de REQ-CFG-023): tema por navegador. -->
  <fieldset class="section">
    <legend class="section__title">{t("FUSION.Settings.Preferences.ThemeTitle")}</legend>
    <div class="theme-options">
      {#each THEME_OPTIONS as option (option.value)}
        <label class="choice-row">
          <input
            type="radio"
            name="preferences-theme"
            value={option.value}
            checked={theme === option.value}
            onchange={() => {
              handleThemeChange(option.value);
            }}
          />
          <span>{t(option.labelKey)}</span>
        </label>
      {/each}
    </div>
    <p class="section__hint">{t("FUSION.Settings.Preferences.ThemeHint")}</p>
  </fieldset>

  <fieldset class="section">
    <legend class="section__title">{t("FUSION.Settings.Preferences.VolumeTitle")}</legend>

    {#each VOLUME_CHANNELS as channel (channel)}
      <div class="field">
        <label class="field__label" for={`preferences-volume-${channel}`}>
          {t(VOLUME_LABEL_KEYS[channel], { percent: percentOf(channel) })}
        </label>
        <input
          id={`preferences-volume-${channel}`}
          class="field__input"
          type="range"
          min="0"
          max="100"
          step="1"
          value={percentOf(channel)}
          oninput={(event) => {
            handleVolumeInput(channel, (event.currentTarget as HTMLInputElement).value);
          }}
        />
      </div>
    {/each}
  </fieldset>

  <fieldset class="section">
    <legend class="section__title">{t("FUSION.Settings.Preferences.NotificationsTitle")}</legend>

    <label class="checkbox-row">
      <input
        type="checkbox"
        checked={prefs.notifications.chatSound}
        onchange={(event) => {
          handleNotificationToggle("chatSound", (event.currentTarget as HTMLInputElement).checked);
        }}
      />
      <span>{t("FUSION.Settings.Preferences.Notifications.ChatSound")}</span>
    </label>

    <label class="checkbox-row">
      <input
        type="checkbox"
        checked={prefs.notifications.turnAlert}
        onchange={(event) => {
          handleNotificationToggle("turnAlert", (event.currentTarget as HTMLInputElement).checked);
        }}
      />
      <span>{t("FUSION.Settings.Preferences.Notifications.TurnAlert")}</span>
    </label>
  </fieldset>

  <fieldset class="section">
    <legend class="section__title">{t("FUSION.Settings.Preferences.TokenDisplayTitle")}</legend>

    <label class="checkbox-row">
      <input
        type="checkbox"
        checked={prefs.tokenDisplay.showNames}
        onchange={(event) => {
          handleTokenDisplayToggle("showNames", (event.currentTarget as HTMLInputElement).checked);
        }}
      />
      <span>{t("FUSION.Settings.Preferences.TokenDisplay.ShowNames")}</span>
    </label>

    <label class="checkbox-row">
      <input
        type="checkbox"
        checked={prefs.tokenDisplay.showBars}
        onchange={(event) => {
          handleTokenDisplayToggle("showBars", (event.currentTarget as HTMLInputElement).checked);
        }}
      />
      <span>{t("FUSION.Settings.Preferences.TokenDisplay.ShowBars")}</span>
    </label>
  </fieldset>

  <!-- The avatar overlay (spec 35): where a viewer who hid it brings it back. -->
  <fieldset class="section">
    <legend class="section__title">{t("FUSION.Avatar.Overlay.Title")}</legend>
    <AvatarOverlayControles />
  </fieldset>

  <!-- REQ-CFG-090: any seat changes its own password (the only item here that reaches the server). -->
  <fieldset class="section">
    <legend class="section__title">{t("FUSION.Settings.Preferences.Password.Title")}</legend>
    <OwnPasswordForm />
  </fieldset>
</div>

<style>
  .preferences-section {
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-6);
    padding: var(--fusion-space-3) var(--fusion-space-4);
  }

  .section {
    border: none;
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-2);
    margin: 0;
    padding: 0;
  }

  .section__title {
    color: var(--fusion-text);
    font-size: var(--fusion-text-md);
    font-weight: var(--fusion-weight-bold);
    padding: 0;
    margin-bottom: var(--fusion-space-1);
  }

  .section__hint {
    color: var(--fusion-text-muted);
    font-size: var(--fusion-text-sm);
    margin: 0;
  }

  .theme-options {
    display: flex;
    flex-direction: column;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-1);
  }

  .field__label {
    color: var(--fusion-text);
    font-size: var(--fusion-text-base);
  }

  .field__input[type="range"] {
    accent-color: var(--fusion-accent);
    cursor: pointer;
    min-height: var(--fusion-target);
    width: 100%;
  }

  .checkbox-row,
  .choice-row {
    align-items: center;
    color: var(--fusion-text);
    cursor: pointer;
    display: flex;
    font-size: var(--fusion-text-base);
    gap: var(--fusion-space-3);
    min-height: var(--fusion-target);
  }

  .checkbox-row input,
  .choice-row input {
    accent-color: var(--fusion-accent);
    flex: none;
    height: 18px;
    margin: 0;
    width: 18px;
  }
</style>
