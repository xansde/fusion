<script lang="ts">
  /**
   * ModsSection.svelte — "Mods" (spec 37 §5.7, G106).
   *
   * REQ-CFG-060: the section exists in the GAMEMASTER's index since the MVP even
   * though **no mod can exist yet** (REQ-CFG-064 — this spec never defines what a
   * mod is, only its address on the screen, DEC-CFG-01). REQ-CFG-081's empty state
   * for this section is fixed prose: "nenhum mod instalado neste mundo" — there is
   * no list to render, no registry to query, no socket to open, because REQ-ESC-012
   * keeps dynamic plugin loading out of the MVP (REQ-CFG-063). The install control
   * is shown, always disabled, with a legible reason instead of just vanishing —
   * an empty address costs one section; a MISSING address costs a layout
   * renegotiation the day the first mod actually arrives.
   *
   * REQ-CFG-061 ("não aparece para o jogador, nem em leitura"): this component is
   * reached exactly the way every other privileged section is — through
   * `SettingsTab`'s index, itself cut by `visibleSettingsSections(isGm)`
   * (DEC-CFG-05). There is nothing here to leak on top of that: no fetch, no
   * socket read, no server round-trip at all — the entire section is static
   * markup, so a non-privileged seat that never sees the index entry has no way
   * to observe this content, in reading or otherwise (REQ-CFG-070 covers the
   * write side, which this section does not have).
   *
   * REQ-CFG-062/063 are [V2] — listing installed mods and toggling them per world
   * waits for the Mods API spec; nothing here anticipates that shape.
   */

  import { t } from "../../lib/i18n/i18n.js";
</script>

<div class="mods-section">
  <p class="mods-section__empty">{t("FUSION.Settings.Mods.Empty")}</p>
  <button
    type="button"
    class="mods-section__install"
    disabled
    title={t("FUSION.Settings.Mods.InstallDisabledReason")}
  >
    {t("FUSION.Settings.Mods.InstallLabel")}
  </button>
  <p class="mods-section__reason">{t("FUSION.Settings.Mods.InstallDisabledReason")}</p>
</div>

<style>
  .mods-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1.5rem 1rem;
    text-align: center;
  }

  .mods-section__empty {
    color: var(--fusion-text-subtle);
    font-size: 0.8125rem;
    margin: 0;
  }

  .mods-section__install {
    align-self: center;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    cursor: not-allowed;
    font: inherit;
    padding: 0.4rem 0.9rem;
  }

  .mods-section__reason {
    color: var(--fusion-text-subtle);
    font-size: 0.75rem;
    margin: 0;
  }
</style>
