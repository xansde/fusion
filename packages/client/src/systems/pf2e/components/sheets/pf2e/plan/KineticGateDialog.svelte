<script lang="ts">
  /**
   * KineticGateDialog.svelte — the Kineticist "Kinetic Gate" picker (r18-N2c).
   *
   * A level-1 kineticist chooses a Kinetic Gate: a SINGLE gate (one element) or
   * a DUAL gate (two elements). Each chosen element then picks its blast damage
   * type from that element's valid options (air → electricity|slashing, metal →
   * piercing|slashing, …). The result is 1 or 2 `{element, damageType}` picks.
   *
   * Unlike CompendiumPickerDialog this is a pure client-side selection over the
   * fixed element list (KINETIC_ELEMENTS) — the vendor pack carries no per-
   * element documents, only the single "Kinetic Gate" classFeature. This dialog
   * resolves that one classFeature doc itself (class-features-core index →
   * getDocument) so the caller only receives the finished `{doc, picks}` and
   * hands them to `chooseKineticGate`, which stamps `system.kineticGates`.
   *
   * The element list + damage-type options MIRROR planVM's
   * KINETIC_ELEMENT_DAMAGE_TYPES (which itself mirrors the derivation's
   * ELEMENT_BLAST_TABLE) so an invalid combination can never be recorded.
   */

  import {
    KINETIC_ELEMENTS,
    KINETIC_ELEMENT_DAMAGE_TYPES,
    type KineticElement,
    type KineticGateMode,
    type KineticGatePick,
  } from "../../../../lib/sheets/pf2e/planVM.js";
  import { t } from "$lib/i18n/i18n.js";
  import { session, getSocket } from "$lib/session.svelte.js";
  import {
    listPacks,
    searchPack,
    getDocument,
    requireConnectedSocket,
  } from "$lib/compendium/compendiumApi.js";

  interface Props {
    title: string;
    onClose: () => void;
    /** Resolved Kinetic Gate classFeature doc + the player's element/damage picks. */
    onConfirm: (featureDoc: Record<string, unknown>, picks: KineticGatePick[]) => void;
  }

  let { title, onClose, onConfirm }: Props = $props();

  let mode = $state<KineticGateMode>("dual-gate");
  // The chosen element per gate index (0 = first, 1 = second when dual).
  let elementOne = $state<KineticElement | null>(null);
  let elementTwo = $state<KineticElement | null>(null);
  // Chosen damage type per gate index.
  let damageOne = $state<string | null>(null);
  let damageTwo = $state<string | null>(null);

  let resolving = $state(false);
  let resolveError = $state<string | null>(null);

  const isDual = $derived(mode === "dual-gate");

  /** Elements offered for gate 2: cannot repeat gate 1's element. */
  const secondElementOptions = $derived(
    KINETIC_ELEMENTS.filter((e) => e !== elementOne),
  );

  function elementLabel(element: KineticElement): string {
    return t(`FUSION.Sheet.Plan.KineticGate.Element.${element}`);
  }

  function damageLabel(dt: string): string {
    return t(`FUSION.Damage.${dt}`);
  }

  function pickMode(next: KineticGateMode): void {
    mode = next;
    if (next === "single-gate") {
      elementTwo = null;
      damageTwo = null;
    }
  }

  function pickElement(index: 0 | 1, element: KineticElement): void {
    const options = KINETIC_ELEMENT_DAMAGE_TYPES[element];
    if (index === 0) {
      elementOne = element;
      damageOne = options[0] ?? null;
      // Clear a now-illegal duplicate on gate 2.
      if (elementTwo === element) {
        elementTwo = null;
        damageTwo = null;
      }
    } else {
      elementTwo = element;
      damageTwo = options[0] ?? null;
    }
  }

  function pickDamage(index: 0 | 1, dt: string): void {
    if (index === 0) damageOne = dt;
    else damageTwo = dt;
  }

  const canConfirm = $derived(
    elementOne !== null &&
      damageOne !== null &&
      (!isDual || (elementTwo !== null && damageTwo !== null)) &&
      !resolving,
  );

  /**
   * Resolve the single "Kinetic Gate" classFeature doc from class-features-core
   * (index → getDocument), then hand it plus the picks to the caller.
   */
  async function confirm(): Promise<void> {
    if (!canConfirm || elementOne === null || damageOne === null) return;
    resolving = true;
    resolveError = null;
    try {
      const sock = requireConnectedSocket(getSocket());
      const systemId = session.worldInfo?.systemId ?? "pf2e";
      const { packs } = await listPacks(sock, { systemId, documentType: "Item" });
      const pack = packs.find((p) => p.id.endsWith(`.class-features-core`));
      if (!pack) {
        resolveError = t("FUSION.Sheet.Plan.KineticGate.NotFound");
        resolving = false;
        return;
      }
      const { entries } = await searchPack(sock, { packId: pack.id });
      const entry = entries.find(
        (e) => typeof e.name === "string" && e.name.toLowerCase() === "kinetic gate",
      );
      if (!entry) {
        resolveError = t("FUSION.Sheet.Plan.KineticGate.NotFound");
        resolving = false;
        return;
      }
      const { document } = await getDocument(sock, entry.uuid);

      const picks: KineticGatePick[] = [{ element: elementOne, damageType: damageOne }];
      if (isDual && elementTwo !== null && damageTwo !== null) {
        picks.push({ element: elementTwo, damageType: damageTwo });
      }
      onConfirm(document, picks);
      onClose();
    } catch {
      resolveError = t("FUSION.Sheet.Plan.KineticGate.LoadError");
      resolving = false;
    }
  }
</script>

<div class="kg-backdrop" role="presentation" onclick={onClose} onkeydown={(e) => { if (e.key === "Escape") onClose(); }}>
  <div
    class="kg-modal"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label={title}
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => { if (e.key === "Escape") onClose(); }}
  >
    <div class="kg-modal__header">
      <h2 class="kg-modal__title">{title}</h2>
      <button type="button" class="kg-modal__close" onclick={onClose} aria-label={t("FUSION.Dialog.Close")}>&times;</button>
    </div>

    <div class="kg-modal__body">
      <!-- Gate mode: single vs dual -->
      <div class="kg-section">
        <p class="kg-section__label">{t("FUSION.Sheet.Plan.KineticGate.ModeLabel")}</p>
        <div class="kg-mode">
          <button
            type="button"
            class="kg-mode__btn"
            class:kg-mode__btn--active={mode === "single-gate"}
            onclick={() => pickMode("single-gate")}
          >
            {t("FUSION.Sheet.Plan.KineticGate.SingleGate")}
          </button>
          <button
            type="button"
            class="kg-mode__btn"
            class:kg-mode__btn--active={mode === "dual-gate"}
            onclick={() => pickMode("dual-gate")}
          >
            {t("FUSION.Sheet.Plan.KineticGate.DualGate")}
          </button>
        </div>
      </div>

      <!-- Gate 1 element -->
      <div class="kg-section">
        <p class="kg-section__label">
          {isDual ? t("FUSION.Sheet.Plan.KineticGate.FirstElement") : t("FUSION.Sheet.Plan.KineticGate.Element")}
        </p>
        <div class="kg-grid">
          {#each KINETIC_ELEMENTS as element (element)}
            <button
              type="button"
              class="kg-tile"
              class:kg-tile--selected={elementOne === element}
              onclick={() => pickElement(0, element)}
            >
              {elementLabel(element)}
            </button>
          {/each}
        </div>
        {#if elementOne}
          <div class="kg-damage">
            <span class="kg-damage__label">{t("FUSION.Sheet.Plan.KineticGate.DamageType")}</span>
            {#each KINETIC_ELEMENT_DAMAGE_TYPES[elementOne] as dt (dt)}
              <button
                type="button"
                class="kg-chip"
                class:kg-chip--selected={damageOne === dt}
                onclick={() => pickDamage(0, dt)}
              >
                {damageLabel(dt)}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Gate 2 element (dual only) -->
      {#if isDual}
        <div class="kg-section">
          <p class="kg-section__label">{t("FUSION.Sheet.Plan.KineticGate.SecondElement")}</p>
          <div class="kg-grid">
            {#each secondElementOptions as element (element)}
              <button
                type="button"
                class="kg-tile"
                class:kg-tile--selected={elementTwo === element}
                onclick={() => pickElement(1, element)}
              >
                {elementLabel(element)}
              </button>
            {/each}
          </div>
          {#if elementTwo}
            <div class="kg-damage">
              <span class="kg-damage__label">{t("FUSION.Sheet.Plan.KineticGate.DamageType")}</span>
              {#each KINETIC_ELEMENT_DAMAGE_TYPES[elementTwo] as dt (dt)}
                <button
                  type="button"
                  class="kg-chip"
                  class:kg-chip--selected={damageTwo === dt}
                  onclick={() => pickDamage(1, dt)}
                >
                  {damageLabel(dt)}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      {#if resolveError}
        <p class="kg-error" role="alert">{resolveError}</p>
      {/if}
    </div>

    <div class="kg-modal__footer">
      <button type="button" class="kg-btn kg-btn--secondary" onclick={onClose}>{t("FUSION.Dialog.Cancel")}</button>
      <button type="button" class="kg-btn kg-btn--primary" disabled={!canConfirm} onclick={() => void confirm()}>
        {resolving ? t("FUSION.Sheet.Plan.KineticGate.Resolving") : t("FUSION.Sheet.Plan.AbilityBoosts.Done")}
      </button>
    </div>
  </div>
</div>

<style>
  .kg-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    z-index: 100;
  }

  .kg-modal {
    width: 460px;
    max-width: 100%;
    max-height: 80vh;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    box-shadow: var(--fusion-shadow-modal);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .kg-modal__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--fusion-border);
  }

  .kg-modal__title {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    color: var(--fusion-text);
  }

  .kg-modal__close {
    width: 24px;
    height: 24px;
    border-radius: var(--fusion-radius-sm);
    border: 1px solid var(--fusion-border);
    background: transparent;
    color: var(--fusion-text-muted);
    cursor: pointer;
    font-size: 13px;
    font-family: var(--fusion-font);
  }

  .kg-modal__close:hover {
    border-color: var(--fusion-danger);
    color: var(--fusion-danger);
  }

  .kg-modal__body {
    padding: 14px 18px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
  }

  .kg-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .kg-section__label {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--fusion-text-muted);
    margin: 0;
  }

  .kg-mode {
    display: flex;
    gap: 8px;
  }

  .kg-mode__btn {
    flex: 1;
    padding: 8px 10px;
    border-radius: var(--fusion-radius-sm);
    border: 1px solid var(--fusion-border);
    background: var(--fusion-surface-alt, transparent);
    color: var(--fusion-text);
    cursor: pointer;
    font-size: 13px;
    font-family: var(--fusion-font);
  }

  .kg-mode__btn--active {
    border-color: var(--fusion-accent);
    background: var(--fusion-accent-soft, var(--fusion-surface));
    color: var(--fusion-accent);
    font-weight: 600;
  }

  .kg-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .kg-tile {
    padding: 10px 8px;
    border-radius: var(--fusion-radius-sm);
    border: 1px solid var(--fusion-border);
    background: transparent;
    color: var(--fusion-text);
    cursor: pointer;
    font-size: 13px;
    font-family: var(--fusion-font);
    text-align: center;
  }

  .kg-tile:hover {
    border-color: var(--fusion-accent);
  }

  .kg-tile--selected {
    border-color: var(--fusion-accent);
    background: var(--fusion-accent-soft, var(--fusion-surface));
    color: var(--fusion-accent);
    font-weight: 600;
  }

  .kg-damage {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding-top: 4px;
  }

  .kg-damage__label {
    font-size: 11px;
    color: var(--fusion-text-muted);
    margin-right: 4px;
  }

  .kg-chip {
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--fusion-border);
    background: transparent;
    color: var(--fusion-text);
    cursor: pointer;
    font-size: 12px;
    font-family: var(--fusion-font);
  }

  .kg-chip--selected {
    border-color: var(--fusion-accent);
    background: var(--fusion-accent-soft, var(--fusion-surface));
    color: var(--fusion-accent);
    font-weight: 600;
  }

  .kg-error {
    font-size: 12px;
    color: var(--fusion-danger);
    margin: 0;
  }

  .kg-modal__footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--fusion-border);
  }

  .kg-btn {
    padding: 7px 16px;
    border-radius: var(--fusion-radius-sm);
    border: 1px solid var(--fusion-border);
    cursor: pointer;
    font-size: 13px;
    font-family: var(--fusion-font);
  }

  .kg-btn--secondary {
    background: transparent;
    color: var(--fusion-text-muted);
  }

  .kg-btn--primary {
    background: var(--fusion-accent);
    border-color: var(--fusion-accent);
    color: var(--fusion-on-accent, #fff);
    font-weight: 600;
  }

  .kg-btn--primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
