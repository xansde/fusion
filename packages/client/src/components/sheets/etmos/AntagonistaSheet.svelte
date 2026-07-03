<script lang="ts">
  /**
   * AntagonistaSheet.svelte — Etmos Antagonista Sheet component.
   *
   * Thin Svelte 5 wrapper over AntagonistaSheetVM, mirroring OradorSheet.svelte /
   * the PF2e CharacterSheet.svelte pattern: all logic lives in the VM.
   *
   * Delta vs. OradorSheet (design doc §4.2):
   *   - Ficha Base selector (simples/intermediaria/avancada) — pre-fills are a
   *     GM authoring convenience from antagonistas.json (M5-B); this sheet only
   *     edits the already-created Actor's fields, it does NOT re-apply presets.
   *   - Atributos may be 0 (no min(1) clamp).
   *   - Ferimentos/Estresse/Complexidade/Movimentação limits are directly
   *     editable (fixed statblock, not derived).
   *   - Aptidões + Ataques free lists; Ataques carry EXACT `ferimentos` damage
   *     (REQ-ETM-050) with an "apply to target" action wired to the combat
   *     tracker's existing target-selection (via `selectedTargetActorId` prop +
   *     `onApplyDamage` callback — no new tracker is invented here, this sheet
   *     only builds the doc:update diff and delegates emission to the caller).
   *   - No Compositor tab — antagonistas don't compose frases in the MVP.
   *
   * REQ-ETM-002, REQ-ETM-049, REQ-ETM-050, REQ-ETM-051 (i18n pt-BR).
   * Spec: 19-sistema-etmos.md. Design doc: docs/design/m5-etmos-compositor.md §4.2.
   */

  import { AntagonistaSheetVM } from "$lib/sheets/etmos/antagonistaSheetVM.js";
  import type { DocUpdatePayload, TrilhaAtributo, FichaBase } from "$lib/sheets/etmos/antagonistaSheetVM.js";
  import { t } from "$lib/i18n/index.js";

  // ---------------------------------------------------------------------------
  // Props
  // ---------------------------------------------------------------------------

  interface Props {
    doc: Record<string, unknown>;
    actorId: string;
    ownership: number;
    userId: string;
    isGm: boolean;
    sendOpFn?: (op: DocUpdatePayload) => void;
    /**
     * Currently targeted actor (for "apply damage" — REQ-ETM-050). Optional:
     * when absent the apply-damage button is disabled with a tooltip. Wiring
     * to the real combat-tracker target selection is the caller's job (this
     * sheet has no knowledge of the scene/combat state).
     */
    selectedTarget?: { actorId: string; ferimentosAtual: number; ferimentosLimite: number } | null;
  }

  let { doc, actorId, ownership, userId, isGm, sendOpFn = () => {}, selectedTarget = null }: Props = $props();

  // ---------------------------------------------------------------------------
  // View-model — recreated whenever doc changes
  // ---------------------------------------------------------------------------

  const vm = $derived(new AntagonistaSheetVM({ doc, actorId, ownership, userId, isGm }));

  // ---------------------------------------------------------------------------
  // Tab state
  // ---------------------------------------------------------------------------

  type AntagonistaTab = "principal" | "aptidoes" | "ataques";
  let activeTab = $state<AntagonistaTab>("principal");

  // ---------------------------------------------------------------------------
  // Autosave state
  // ---------------------------------------------------------------------------

  let saveStatus = $state<"idle" | "saving" | "saved">("idle");
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const DEBOUNCE_MS = 400;

  function scheduleUpdate(op: DocUpdatePayload | null): void {
    if (!op) return;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    saveStatus = "saving";
    debounceTimer = setTimeout(() => {
      sendOpFn(op);
      saveStatus = "saved";
      setTimeout(() => {
        saveStatus = "idle";
      }, 1500);
    }, DEBOUNCE_MS);
  }

  function applyNow(op: DocUpdatePayload | null): void {
    if (!op) return;
    sendOpFn(op);
  }

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleAtributoInput(slug: TrilhaAtributo, e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const value = parseInt(input.value, 10);
    if (!Number.isNaN(value)) scheduleUpdate(vm.setAtributo(slug, value));
  }

  function ferimentosDelta(delta: number): void {
    applyNow(vm.applyFerimentosDelta(delta));
  }

  function estresseDelta(delta: number): void {
    applyNow(vm.applyEstresseDelta(delta));
  }

  function handleFichaBaseChange(e: Event): void {
    const select = e.currentTarget as HTMLSelectElement;
    applyNow(vm.setFichaBase(select.value as FichaBase));
  }

  function applyDamage(ataqueIndex: number): void {
    if (!selectedTarget) return;
    const ataque = vm.ataques[ataqueIndex];
    if (!ataque) return;
    const op = AntagonistaSheetVM.buildApplyDamageToTarget(
      selectedTarget.actorId,
      selectedTarget.ferimentosAtual,
      selectedTarget.ferimentosLimite,
      ataque,
    );
    if (op) sendOpFn(op);
  }
</script>

<!-- ======================================================================
  Antagonista Sheet
====================================================================== -->
<div class="etmos-sheet etmos-antagonista-sheet" role="document" aria-label="Ficha de Antagonista: {vm.name}">
  <!-- ---- Header ---- -->
  <header class="sheet-header">
    {#if vm.img}
      <img class="sheet-portrait" src={vm.img} alt="Retrato de {vm.name}" width="48" height="48" />
    {/if}
    <div class="sheet-header__info">
      <h2 class="sheet-header__name">{vm.name}</h2>
      <div class="sheet-header__subtitle">{t(`ETMOS.Antagonista.FichaBase.${vm.fichaBase}`)}</div>
    </div>
    {#if saveStatus === "saving"}
      <span class="sheet-save-status sheet-save-status--saving" aria-live="polite">salvando…</span>
    {:else if saveStatus === "saved"}
      <span class="sheet-save-status sheet-save-status--saved" aria-live="polite">salvo</span>
    {/if}
  </header>

  <!-- ---- Trackers row ---- -->
  <div class="tracker-row">
    <div class="tracker-block" aria-label="Ferimentos: {vm.ferimentos.atual}/{vm.ferimentos.limite}">
      <span class="tracker-block__label">{t("ETMOS.Orador.Trackers.Ferimentos")}</span>
      <div class="tracker-block__controls">
        <button disabled={!vm.editable} onclick={() => ferimentosDelta(-1)} aria-label="Reduzir Ferimentos">−</button>
        <span class="tracker-block__value">{vm.ferimentos.atual} / {vm.ferimentos.limite}</span>
        <button disabled={!vm.editable} onclick={() => ferimentosDelta(1)} aria-label="Aumentar Ferimentos">+</button>
      </div>
    </div>

    <div class="tracker-block" aria-label="Estresse: {vm.estresse.atual}/{vm.estresse.limite}">
      <span class="tracker-block__label">{t("ETMOS.Orador.Trackers.Estresse")}</span>
      <div class="tracker-block__controls">
        <button disabled={!vm.editable} onclick={() => estresseDelta(-1)} aria-label="Reduzir Estresse">−</button>
        <span class="tracker-block__value">{vm.estresse.atual} / {vm.estresse.limite}</span>
        <button disabled={!vm.editable} onclick={() => estresseDelta(1)} aria-label="Aumentar Estresse">+</button>
      </div>
    </div>

    <div class="tracker-block tracker-block--readonly">
      <span class="tracker-block__label">{t("ETMOS.Antagonista.Labels.Movimentacao")}</span>
      <input
        class="tracker-block__input"
        type="number"
        min="0"
        value={vm.movimentacao}
        disabled={!vm.editable}
        oninput={(e) => scheduleUpdate(vm.setMovimentacao(parseFloat((e.currentTarget as HTMLInputElement).value) || 0))}
      />
    </div>
  </div>

  <!-- ---- Tab bar ---- -->
  <div class="tab-bar" role="tablist" aria-label="Seções da ficha do Antagonista">
    {#each (["principal", "aptidoes", "ataques"] as const) as tab}
      <button
        class="tab-btn"
        class:tab-btn--active={activeTab === tab}
        role="tab"
        aria-selected={activeTab === tab}
        aria-controls="tab-panel-{tab}"
        id="tab-{tab}"
        onclick={() => {
          activeTab = tab;
        }}
      >
        {t(`ETMOS.Antagonista.Tabs.${tab.charAt(0).toUpperCase()}${tab.slice(1)}`)}
      </button>
    {/each}
  </div>

  {#if activeTab === "principal"}
    <section id="tab-panel-principal" role="tabpanel" aria-labelledby="tab-principal" class="tab-panel">
      <div class="field-grid">
        <label class="field">
          <span class="field__label">{t("ETMOS.Antagonista.Labels.FichaBase")}</span>
          <select value={vm.fichaBase} disabled={!vm.editable} onchange={handleFichaBaseChange}>
            <option value="simples">{t("ETMOS.Antagonista.FichaBase.simples")}</option>
            <option value="intermediaria">{t("ETMOS.Antagonista.FichaBase.intermediaria")}</option>
            <option value="avancada">{t("ETMOS.Antagonista.FichaBase.avancada")}</option>
          </select>
        </label>

        <label class="field">
          <span class="field__label">{t("ETMOS.Antagonista.Labels.LimiteFerimentos")}</span>
          <input
            type="number"
            min="0"
            value={vm.ferimentos.limite}
            disabled={!vm.editable}
            oninput={(e) => scheduleUpdate(vm.setFerimentosLimite(parseInt((e.currentTarget as HTMLInputElement).value, 10) || 0))}
          />
        </label>

        <label class="field">
          <span class="field__label">{t("ETMOS.Antagonista.Labels.LimiteEstresse")}</span>
          <input
            type="number"
            min="0"
            value={vm.estresse.limite}
            disabled={!vm.editable}
            oninput={(e) => scheduleUpdate(vm.setEstresseLimite(parseInt((e.currentTarget as HTMLInputElement).value, 10) || 0))}
          />
        </label>

        <label class="field">
          <span class="field__label">{t("ETMOS.Antagonista.Labels.ComplexidadeMaxima")}</span>
          <select
            value={vm.complexidadeMaxima}
            disabled={!vm.editable}
            onchange={(e) => applyNow(vm.setComplexidadeMaxima((e.currentTarget as HTMLSelectElement).value))}
          >
            <option value="trivial">{t("ETMOS.Complexidade.trivial")}</option>
            <option value="regular">{t("ETMOS.Complexidade.regular")}</option>
            <option value="dificil">{t("ETMOS.Complexidade.dificil")}</option>
            <option value="complexa">{t("ETMOS.Complexidade.complexa")}</option>
            <option value="milagre">{t("ETMOS.Complexidade.milagre")}</option>
          </select>
        </label>

        <label class="field field--checkbox">
          <input
            type="checkbox"
            checked={vm.comunicacao}
            disabled={!vm.editable}
            onchange={(e) => applyNow(vm.setComunicacao((e.currentTarget as HTMLInputElement).checked))}
          />
          <span>{t("ETMOS.Antagonista.Labels.Comunicacao")}</span>
        </label>
      </div>

      <h3 class="section-header">Atributos</h3>
      <div class="atributo-row">
        {#each (["corpo", "alma", "mente"] as const) as slug}
          <label class="field">
            <span class="field__label">{t(`ETMOS.Orador.Atributos.${slug}`)}</span>
            <input
              type="number"
              min="0"
              max="6"
              value={vm.atributos[slug]}
              disabled={!vm.editable}
              oninput={(e) => handleAtributoInput(slug, e)}
            />
          </label>
        {/each}
      </div>
    </section>
  {:else if activeTab === "aptidoes"}
    <section id="tab-panel-aptidoes" role="tabpanel" aria-labelledby="tab-aptidoes" class="tab-panel">
      {#if vm.editable}
        <button class="btn-secondary" onclick={() => applyNow(vm.addAptidao())}>
          {t("ETMOS.Antagonista.Aptidoes.Add")}
        </button>
      {/if}

      {#if vm.aptidoes.length === 0}
        <p class="empty-state">{t("ETMOS.Antagonista.Aptidoes.Empty")}</p>
      {:else}
        <ul class="entry-list" aria-label={t("ETMOS.Antagonista.Tabs.Aptidoes")}>
          {#each vm.aptidoes as aptidao (aptidao.index)}
            <li class="entry-row">
              <input
                class="entry-row__name"
                type="text"
                placeholder={t("ETMOS.Antagonista.Aptidoes.Nome")}
                value={aptidao.nome}
                disabled={!vm.editable}
                oninput={(e) => scheduleUpdate(vm.updateAptidao(aptidao.index, "nome", (e.currentTarget as HTMLInputElement).value))}
              />
              <textarea
                class="entry-row__desc"
                placeholder={t("ETMOS.Antagonista.Aptidoes.Descricao")}
                disabled={!vm.editable}
                value={aptidao.descricao}
                oninput={(e) => scheduleUpdate(vm.updateAptidao(aptidao.index, "descricao", (e.currentTarget as HTMLTextAreaElement).value))}
              ></textarea>
              {#if vm.editable}
                <button class="btn-remove" onclick={() => applyNow(vm.removeAptidao(aptidao.index))} aria-label={t("ETMOS.Antagonista.Aptidoes.Remover")}>
                  ✕
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {:else if activeTab === "ataques"}
    <section id="tab-panel-ataques" role="tabpanel" aria-labelledby="tab-ataques" class="tab-panel">
      {#if vm.editable}
        <button class="btn-secondary" onclick={() => applyNow(vm.addAtaque())}>
          {t("ETMOS.Antagonista.Ataques.Add")}
        </button>
      {/if}

      {#if vm.ataques.length === 0}
        <p class="empty-state">{t("ETMOS.Antagonista.Ataques.Empty")}</p>
      {:else}
        <ul class="entry-list" aria-label={t("ETMOS.Antagonista.Tabs.Ataques")}>
          {#each vm.ataques as ataque (ataque.index)}
            <li class="entry-row entry-row--ataque">
              <input
                class="entry-row__name"
                type="text"
                placeholder={t("ETMOS.Antagonista.Ataques.Nome")}
                value={ataque.nome}
                disabled={!vm.editable}
                oninput={(e) => scheduleUpdate(vm.updateAtaque(ataque.index, "nome", (e.currentTarget as HTMLInputElement).value))}
              />
              <div class="entry-row__meta">
                <label class="field">
                  <span class="field__label">{t("ETMOS.Antagonista.Ataques.Ferimentos")}</span>
                  <input
                    type="number"
                    min="0"
                    value={ataque.ferimentos ?? ""}
                    disabled={!vm.editable}
                    oninput={(e) => {
                      const raw = (e.currentTarget as HTMLInputElement).value;
                      scheduleUpdate(vm.updateAtaque(ataque.index, "ferimentos", raw === "" ? null : parseInt(raw, 10)));
                    }}
                  />
                </label>
                <label class="field">
                  <span class="field__label">{t("ETMOS.Antagonista.Ataques.Defesa")}</span>
                  <select
                    value={ataque.defesa ?? ""}
                    disabled={!vm.editable}
                    onchange={(e) => applyNow(vm.updateAtaque(ataque.index, "defesa", (e.currentTarget as HTMLSelectElement).value || null))}
                  >
                    <option value="">{t("ETMOS.Antagonista.Defesa.nenhuma")}</option>
                    <option value="completa">{t("ETMOS.Antagonista.Defesa.completa")}</option>
                    <option value="parcial">{t("ETMOS.Antagonista.Defesa.parcial")}</option>
                    <option value="ineficaz">{t("ETMOS.Antagonista.Defesa.ineficaz")}</option>
                    <option value="contestada">{t("ETMOS.Antagonista.Defesa.contestada")}</option>
                  </select>
                </label>
                <label class="field">
                  <span class="field__label">{t("ETMOS.Antagonista.Ataques.Alcance")}</span>
                  <input
                    type="text"
                    value={ataque.alcance}
                    disabled={!vm.editable}
                    oninput={(e) => scheduleUpdate(vm.updateAtaque(ataque.index, "alcance", (e.currentTarget as HTMLInputElement).value))}
                  />
                </label>
              </div>
              <textarea
                class="entry-row__desc"
                placeholder={t("ETMOS.Antagonista.Ataques.Descricao")}
                disabled={!vm.editable}
                value={ataque.descricao}
                oninput={(e) => scheduleUpdate(vm.updateAtaque(ataque.index, "descricao", (e.currentTarget as HTMLTextAreaElement).value))}
              ></textarea>
              <div class="entry-row__actions">
                <button
                  class="btn-apply-damage"
                  disabled={!selectedTarget || ataque.ferimentos === null}
                  title={selectedTarget ? t("ETMOS.Antagonista.Ataques.AplicarDano") : t("ETMOS.Antagonista.Ataques.SemAlvo")}
                  onclick={() => applyDamage(ataque.index)}
                >
                  🎯 {t("ETMOS.Antagonista.Ataques.AplicarDano")}
                </button>
                {#if vm.editable}
                  <button class="btn-remove" onclick={() => applyNow(vm.removeAtaque(ataque.index))} aria-label={t("ETMOS.Antagonista.Ataques.Remover")}>
                    ✕
                  </button>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>

<style>
  .etmos-antagonista-sheet {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--fusion-color-surface, #1a1a2e);
    color: var(--fusion-color-text-primary, #e0e0ff);
    font-size: 13px;
  }

  .sheet-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: var(--fusion-color-surface-raised, #16213e);
    border-bottom: 1px solid var(--fusion-color-border, #3a3a5c);
    flex-shrink: 0;
  }

  .sheet-portrait {
    width: 40px;
    height: 40px;
    object-fit: cover;
    border-radius: var(--fusion-radius-sm, 4px);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
  }

  .sheet-header__info {
    flex: 1;
  }

  .sheet-header__name {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
  }

  .sheet-header__subtitle {
    font-size: 11px;
    color: var(--fusion-color-text-muted, #9999cc);
  }

  .sheet-save-status {
    font-size: 10px;
  }
  .sheet-save-status--saving {
    color: var(--fusion-color-warning, #ffcc00);
  }
  .sheet-save-status--saved {
    color: var(--fusion-color-success, #44cc88);
  }

  .tracker-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--fusion-color-border, #3a3a5c);
    flex-shrink: 0;
  }

  .tracker-block {
    flex: 1;
    min-width: 100px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
    border-radius: var(--fusion-radius-sm, 4px);
    background: var(--fusion-color-surface-raised, #16213e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
  }

  .tracker-block__label {
    font-size: 10px;
    text-transform: uppercase;
    color: var(--fusion-color-text-muted, #9999cc);
  }

  .tracker-block__controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .tracker-block__controls button {
    width: 22px;
    height: 22px;
    border-radius: var(--fusion-radius-sm, 4px);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    background: var(--fusion-color-surface, #1a1a2e);
    color: var(--fusion-color-text-primary, #e0e0ff);
    cursor: pointer;
  }

  .tracker-block__value {
    font-size: 14px;
    font-weight: 700;
    min-width: 44px;
    text-align: center;
  }

  .tracker-block__input {
    width: 56px;
    text-align: center;
    background: var(--fusion-color-surface, #1a1a2e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-color-text-primary, #e0e0ff);
    padding: 2px 4px;
  }

  .btn-secondary {
    font-size: 11px;
    padding: 5px 10px;
    border-radius: var(--fusion-radius-sm, 4px);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    background: transparent;
    color: var(--fusion-color-text-primary, #e0e0ff);
    cursor: pointer;
    margin-bottom: 10px;
  }

  .tab-bar {
    display: flex;
    border-bottom: 2px solid var(--fusion-color-border, #3a3a5c);
    flex-shrink: 0;
    background: var(--fusion-color-surface-raised, #16213e);
    overflow-x: auto;
  }

  .tab-btn {
    padding: 7px 14px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    color: var(--fusion-color-text-muted, #9999cc);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
  }

  .tab-btn--active {
    color: var(--fusion-color-text-primary, #e0e0ff);
    border-bottom-color: var(--fusion-color-accent, #5b8dee);
  }

  .tab-panel {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }

  .section-header {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--fusion-color-text-muted, #9999cc);
    margin: 12px 0 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--fusion-color-border, #3a3a5c);
  }

  .field-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }

  .atributo-row {
    display: flex;
    gap: 10px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .field--checkbox {
    flex-direction: row;
    align-items: center;
    gap: 6px;
  }

  .field__label {
    font-size: 10px;
    text-transform: uppercase;
    color: var(--fusion-color-text-muted, #9999cc);
  }

  .field input,
  .field select,
  .field textarea {
    background: var(--fusion-color-surface-raised, #16213e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-color-text-primary, #e0e0ff);
    padding: 4px 6px;
    font-size: 12px;
  }

  .entry-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .entry-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    background: var(--fusion-color-surface-raised, #16213e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
    position: relative;
  }

  .entry-row__name {
    font-weight: 600;
    background: transparent;
    border: none;
    border-bottom: 1px solid var(--fusion-color-border, #3a3a5c);
    color: var(--fusion-color-text-primary, #e0e0ff);
    padding: 2px 0;
    font-size: 13px;
  }

  .entry-row__desc {
    background: var(--fusion-color-surface, #1a1a2e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-color-text-primary, #e0e0ff);
    padding: 4px 6px;
    font-size: 12px;
    min-height: 40px;
    resize: vertical;
    font-family: inherit;
  }

  .entry-row__meta {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .entry-row__meta .field input,
  .entry-row__meta .field select {
    width: 90px;
  }

  .entry-row__actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-remove {
    align-self: flex-end;
    background: transparent;
    border: none;
    color: var(--fusion-color-text-muted, #9999cc);
    cursor: pointer;
    font-size: 11px;
  }

  .btn-remove:hover {
    color: #ff6666;
  }

  .btn-apply-damage {
    font-size: 11px;
    padding: 4px 8px;
    border-radius: var(--fusion-radius-sm, 4px);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    background: var(--fusion-color-surface, #1a1a2e);
    color: var(--fusion-color-text-primary, #e0e0ff);
    cursor: pointer;
  }

  .btn-apply-damage:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .empty-state {
    color: var(--fusion-color-text-muted, #9999cc);
    font-size: 12px;
    text-align: center;
    padding: 24px 0;
  }

  @container (max-width: 400px) {
    .field-grid {
      grid-template-columns: 1fr;
    }
    .tracker-row {
      flex-direction: column;
    }
  }
</style>
