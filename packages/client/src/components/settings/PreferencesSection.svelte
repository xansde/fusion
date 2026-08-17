<script lang="ts">
  /**
   * PreferencesSection.svelte — "Minhas preferências" (spec 37 §5.3, G101).
   *
   * The one section every seat sees, privileged or not (REQ-CFG-005): the three audio
   * channels (REQ-CFG-020, REQ-AUD-015) and the client's notification toggles
   * (REQ-CFG-021). Deliberately no `socket` prop and no import of `sendOp`/`socket.io` —
   * everything here reads and writes `lib/settings/clientPrefs.ts`, which never leaves
   * the device (REQ-CFG-022, REQ-CFG-072, RNF-CFG-01). Deliberately no locale or theme
   * control either (REQ-CFG-023) — those are portable, server-side preferences owned by
   * a different section entirely.
   */

  import { t } from "../../lib/i18n/i18n.js";
  import {
    loadClientPreferences,
    setNotificationPreference,
    setVolumeChannel,
    type NotificationPreferences,
    type VolumeChannel,
  } from "../../lib/settings/clientPrefs.js";

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
</script>

<div class="preferences-section">
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
</div>

<style>
  .preferences-section {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 0.5rem 0.75rem;
  }

  .section {
    border: none;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin: 0;
    padding: 0;
  }

  .section__title {
    color: var(--fusion-text-muted);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    padding: 0;
    text-transform: uppercase;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .field__label {
    color: var(--fusion-text);
    font-size: 0.8125rem;
  }

  .field__input[type="range"] {
    cursor: pointer;
    padding: 0.25rem 0;
    width: 100%;
  }

  .checkbox-row {
    align-items: center;
    color: var(--fusion-text);
    cursor: pointer;
    display: flex;
    font-size: 0.8125rem;
    gap: 0.5rem;
  }
</style>
