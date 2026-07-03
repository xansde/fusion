<script lang="ts">
  /**
   * Compositor.svelte — Compositor de Magias window (Etmos).
   *
   * Thin Svelte 5 wrapper over CompositorVM — mirrors CharacterSheet.svelte's
   * "component only renders, VM holds all logic" split. Opens as a dedicated
   * window (windowManager.open, singletonKey `compositor:<actorId>` —
   * OradorSheetVM.compositorSingletonKey) reusing Window.svelte/WindowHost.svelte,
   * NOT a bespoke window shell (design doc §3.1).
   *
   * Guided flow (design doc §3.2, REQ-ETM-027):
   *   (a) Função (1) -> (b) Objeto(s) (>=1) -> (c) Características (0+, ordered)
   *   -> (d) Complementos (Criadores need a target; Modificadores are toggles)
   *   -> (e) Intenção (free text) -> (f) live preview (FrasePreview.svelte).
   *
   * "Propor ao Narrador" emits `etmos:conjuracao:propor` (M5-C socket op,
   * packages/shared/src/etmos/protocol.ts's EtmosConjuracaoProporPayloadSchema)
   * with { conjuradorActorId, frase }. The server re-validates authoritatively
   * (packages/server/src/etmos/conjuracao-handlers.ts) — this component's
   * validarFrase() feedback NEVER substitutes for that.
   *
   * "Salvar como magia conhecida" / "Lançar magia conhecida" (REQ-ETM-034) are
   * [V2] — the spec explicitly tags them V2, so they render as disabled stubs
   * here rather than blocking the rest of the compositor.
   */

  import { t } from "$lib/i18n/i18n.js";
  import {
    CompositorVM,
    emptySlots,
    PREFIX_OBJETO_SLUG,
    CONNECTOR_SLUG,
  } from "$lib/sheets/etmos/compositorVM.js";
  import type { CompositorSlots, EtmosConjuracaoProporOp } from "$lib/sheets/etmos/compositorVM.js";
  import ParticulaGrid from "./ParticulaGrid.svelte";
  import FrasePreview from "./FrasePreview.svelte";

  interface Props {
    doc: Record<string, unknown>;
    actorId: string;
    ownership: number;
    userId: string;
    isGm: boolean;
    sendOpFn?: (op: EtmosConjuracaoProporOp) => void;
  }

  const { doc, actorId, ownership, isGm, sendOpFn = () => {} }: Props = $props();

  const editable = $derived(isGm || ownership >= 3); // OwnershipLevel.OWNER = 3

  let slots = $state<CompositorSlots>(emptySlots());

  const vm = $derived(new CompositorVM({ doc, actorId, slots }));

  // ---------------------------------------------------------------------------
  // Slot mutation handlers — each replaces `slots` with the VM's returned
  // (immutable) next state, mirroring aplicar()'s "never mutate" convention.
  // ---------------------------------------------------------------------------

  function toggleFuncao(slug: string): void {
    slots = vm.toggleFuncao(slug);
  }

  function toggleObjeto(slug: string): void {
    slots = vm.toggleObjeto(slug);
  }

  function toggleCaracteristica(slug: string): void {
    slots = vm.toggleCaracteristica(slug);
  }

  function moveCaracteristica(from: number, to: number): void {
    slots = vm.moveCaracteristica(from, to);
  }

  function toggleModificador(slug: string): void {
    slots = vm.toggleModificador(slug);
  }

  // --- Criador target selection (design doc R5: UI-guided, dropdown restricted) ---
  let criadorAlvoEmEdicao = $state<string | null>(null);

  function startCriadorSelection(slug: string): void {
    criadorAlvoEmEdicao = slug;
  }

  function applyPrefixAlvo(slug: string, index: number): void {
    slots = vm.applyPrefixCriador(slug, index);
    criadorAlvoEmEdicao = null;
  }

  function applyMutAlvo(objetoSlug: string): void {
    slots = vm.applyMutCriador(objetoSlug);
    criadorAlvoEmEdicao = null;
  }

  function applyConnectorAlvo(a: number, b: number): void {
    slots = vm.applyConnectorCriador(a, b);
    criadorAlvoEmEdicao = null;
  }

  function removeCriador(slug: string): void {
    slots = vm.removeCriador(slug);
    if (criadorAlvoEmEdicao === slug) criadorAlvoEmEdicao = null;
  }

  function onComplementoToggle(slug: string): void {
    const opt = vm.complementoOptions.find((o) => o.slug === slug);
    if (!opt) return;
    if (opt.subtipo === "modificador") {
      toggleModificador(slug);
      return;
    }
    // Criador: if already applied, remove; otherwise start target selection.
    const applied = vm.criadoresAplicados.some((c) => c.slug === slug);
    if (applied) {
      removeCriador(slug);
    } else {
      startCriadorSelection(slug);
    }
  }

  function handleIntencaoInput(e: Event): void {
    const el = e.currentTarget as HTMLTextAreaElement;
    slots = vm.setIntencao(el.value);
  }

  function handleLimpar(): void {
    slots = vm.reset();
    criadorAlvoEmEdicao = null;
  }

  function handlePropor(): void {
    sendOpFn(vm.buildProporOp());
  }
</script>

<div class="compositor" role="document" aria-label={t("ETMOS.Compositor.Titulo")}>
  <!-- Passo (a) Função -->
  <section class="compositor__step">
    <h3 class="compositor__step-title">{t("ETMOS.Compositor.Passo.Funcao")}</h3>
    <ParticulaGrid
      options={vm.funcaoOptions}
      categoria="funcao"
      emptyLabelKey="ETMOS.Compositor.Funcao.Empty"
      onToggle={toggleFuncao}
    />
  </section>

  <!-- Passo (b) Objeto(s) -->
  <section class="compositor__step">
    <h3 class="compositor__step-title">{t("ETMOS.Compositor.Passo.Objeto")}</h3>
    <ParticulaGrid
      options={vm.objetoOptions}
      categoria="objeto"
      emptyLabelKey="ETMOS.Compositor.Objeto.Empty"
      onToggle={toggleObjeto}
    />
  </section>

  <!-- Passo (c) Características (ordenável) -->
  <section class="compositor__step">
    <h3 class="compositor__step-title">{t("ETMOS.Compositor.Passo.Caracteristicas")}</h3>
    <ParticulaGrid
      options={vm.caracteristicaOptions}
      categoria="caracteristica"
      emptyLabelKey="ETMOS.Compositor.Caracteristica.Empty"
      onToggle={toggleCaracteristica}
    />
    {#if slots.caracteristicaSlugs.length > 1}
      <ol class="compositor__order-list" aria-label="Ordem das Características na frase">
        {#each slots.caracteristicaSlugs as slug, i (slug + String(i))}
          <li class="compositor__order-item">
            <span class="compositor__order-word">{slug}</span>
            <button
              type="button"
              class="compositor__order-btn"
              onclick={() => moveCaracteristica(i, i - 1)}
              disabled={i === 0}
              aria-label={t("ETMOS.Compositor.Ordenar.Subir")}
            >↑</button>
            <button
              type="button"
              class="compositor__order-btn"
              onclick={() => moveCaracteristica(i, i + 1)}
              disabled={i === slots.caracteristicaSlugs.length - 1}
              aria-label={t("ETMOS.Compositor.Ordenar.Descer")}
            >↓</button>
          </li>
        {/each}
      </ol>
    {/if}
  </section>

  <!-- Passo (d) Complementos -->
  <section class="compositor__step">
    <h3 class="compositor__step-title">{t("ETMOS.Compositor.Passo.Complementos")}</h3>
    <div class="particula-grid particula-grid--complemento" role="list">
      {#if vm.complementoOptions.length === 0}
        <p class="compositor__empty">{t("ETMOS.Compositor.Complemento.Empty")}</p>
      {:else}
        {#each vm.complementoOptions as opt (opt.slug)}
          <button
            type="button"
            class="particula-cell particula-cell--complemento"
            class:particula-cell--selected={opt.selected}
            class:particula-cell--disabled={!opt.disponivel}
            disabled={!opt.disponivel}
            onclick={() => onComplementoToggle(opt.slug)}
            role="listitem"
            aria-pressed={opt.selected}
            title={opt.disponivel ? opt.significado : t("ETMOS.Compositor.Complemento.NivelInsuficiente", { n: opt.nivelGrimorio })}
          >
            <span class="particula-cell__word">{opt.palavra}</span>
            {#if !opt.disponivel}
              <span class="particula-cell__meaning">{t("ETMOS.Compositor.Complemento.NivelInsuficiente", { n: opt.nivelGrimorio })}</span>
            {/if}
          </button>
        {/each}
      {/if}
    </div>

    <!-- Target selector for the Criador currently being configured (R5) -->
    {#if criadorAlvoEmEdicao !== null}
      <div class="compositor__alvo-panel" role="group" aria-label={t("ETMOS.Compositor.Complemento.SelecionarAlvo")}>
        <span class="compositor__alvo-title">{t("ETMOS.Compositor.Complemento.SelecionarAlvo")}: {criadorAlvoEmEdicao}</span>
        {#if criadorAlvoEmEdicao === PREFIX_OBJETO_SLUG}
          <div class="compositor__alvo-options">
            {#each vm.objetoOptionsForMut as opt (opt.slug)}
              <button type="button" class="compositor__alvo-btn" onclick={() => applyMutAlvo(opt.slug)}>
                {opt.palavra}
              </button>
            {/each}
          </div>
        {:else if criadorAlvoEmEdicao === CONNECTOR_SLUG}
          <div class="compositor__alvo-options">
            {#each vm.connectorAlvoOptions() as pair (pair.a + "-" + pair.b)}
              <button type="button" class="compositor__alvo-btn" onclick={() => applyConnectorAlvo(pair.a, pair.b)}>
                {pair.label}
              </button>
            {/each}
          </div>
        {:else}
          <div class="compositor__alvo-options">
            {#each vm.prefixAlvoOptions() as opt (opt.index)}
              <button type="button" class="compositor__alvo-btn" onclick={() => applyPrefixAlvo(criadorAlvoEmEdicao!, opt.index)}>
                {opt.label}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </section>

  <!-- Passo (e) Intenção -->
  <section class="compositor__step">
    <h3 class="compositor__step-title">{t("ETMOS.Compositor.Passo.Intencao")}</h3>
    <textarea
      class="compositor__intencao"
      rows="2"
      value={slots.intencao}
      oninput={handleIntencaoInput}
      placeholder={t("ETMOS.Compositor.Intencao.Placeholder")}
      aria-label={t("ETMOS.Compositor.Passo.Intencao")}
    ></textarea>
    {#if !vm.intencaoValida}
      <p class="compositor__hint">{t("ETMOS.Compositor.Intencao.Obrigatoria")}</p>
    {/if}
  </section>

  <!-- Passo (f) Preview ao vivo -->
  <section class="compositor__step">
    <FrasePreview {vm} />
  </section>

  <!-- Ações -->
  <div class="compositor__actions">
    <button type="button" class="compositor__btn compositor__btn--ghost" onclick={handleLimpar}>
      {t("ETMOS.Compositor.Acoes.Limpar")}
    </button>
    <button
      type="button"
      class="compositor__btn compositor__btn--secondary"
      disabled
      title={t("ETMOS.Compositor.Acoes.EmBreve")}
    >
      {t("ETMOS.Compositor.Acoes.Salvar")}
    </button>
    <button
      type="button"
      class="compositor__btn compositor__btn--primary"
      disabled={!editable || !vm.podePropor}
      onclick={handlePropor}
    >
      {t("ETMOS.Compositor.Acoes.Propor")}
    </button>
  </div>
</div>

<style>
  .compositor {
    display: flex;
    flex-direction: column;
    gap: 14px;
    height: 100%;
    overflow-y: auto;
    padding: 12px;
    background: var(--fusion-surface);
    color: var(--fusion-text);
    font-size: 13px;
    container-type: inline-size;
  }

  .compositor__step-title {
    margin: 0 0 6px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fusion-text-muted);
  }

  .compositor__empty {
    color: var(--fusion-text-muted);
    font-size: 12px;
  }

  /* Shared cell styling (mirrors ParticulaGrid.svelte — duplicated locally for
     the Complementos grid, which needs extra target-selection affordances). */
  .particula-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
    gap: 6px;
  }

  .particula-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 8px 6px;
    border-radius: var(--fusion-radius-sm);
    border: 1px solid var(--fusion-border);
    background: var(--fusion-surface);
    cursor: pointer;
  }

  .particula-cell--complemento .particula-cell__word { color: #cc88ff; }
  .particula-cell--selected { background: var(--fusion-accent-dim); border-color: var(--fusion-accent); }
  .particula-cell--disabled { opacity: 0.35; cursor: not-allowed; }

  .particula-cell__word {
    font-weight: 700;
    font-size: 13px;
    font-family: var(--fusion-font-mono);
  }

  .particula-cell__meaning {
    font-size: 9px;
    color: var(--fusion-text-muted);
    text-align: center;
  }

  .compositor__order-list {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .compositor__order-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }

  .compositor__order-word {
    flex: 1;
    font-family: var(--fusion-font-mono);
  }

  .compositor__order-btn {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    cursor: pointer;
    width: 22px;
    height: 22px;
  }

  .compositor__order-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .compositor__alvo-panel {
    margin-top: 8px;
    padding: 8px;
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface-alt);
    border: 1px dashed var(--fusion-accent-dim);
  }

  .compositor__alvo-title {
    display: block;
    font-size: 11px;
    color: var(--fusion-text-muted);
    margin-bottom: 6px;
  }

  .compositor__alvo-options {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .compositor__alvo-btn {
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    cursor: pointer;
    padding: 4px 8px;
    font-size: 12px;
  }

  .compositor__alvo-btn:hover {
    border-color: var(--fusion-accent);
  }

  .compositor__intencao {
    width: 100%;
    resize: vertical;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    font-size: 13px;
    padding: 6px 8px;
  }

  .compositor__hint {
    margin: 4px 0 0;
    font-size: 11px;
    color: var(--fusion-warning);
  }

  .compositor__actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-top: 8px;
    border-top: 1px solid var(--fusion-border);
  }

  .compositor__btn {
    border-radius: var(--fusion-radius-sm);
    border: 1px solid transparent;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .compositor__btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .compositor__btn--ghost {
    background: transparent;
    border-color: var(--fusion-border);
    color: var(--fusion-text-muted);
  }

  .compositor__btn--secondary {
    background: var(--fusion-surface-alt);
    border-color: var(--fusion-border);
    color: var(--fusion-text-muted);
  }

  .compositor__btn--primary {
    background: var(--fusion-accent);
    color: #fff;
  }

  .compositor__btn--primary:not(:disabled):hover {
    background: var(--fusion-accent-hover);
  }

  @container (max-width: 420px) {
    .particula-grid {
      grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
    }
  }
</style>
