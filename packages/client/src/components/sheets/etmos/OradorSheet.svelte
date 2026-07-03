<script lang="ts">
  /**
   * OradorSheet.svelte — Etmos Orador Sheet component.
   *
   * Thin Svelte 5 wrapper over OradorSheetVM, mirroring the PF2e
   * CharacterSheet.svelte pattern (packages/client/src/components/sheets/pf2e/CharacterSheet.svelte):
   * all logic lives in oradorSheetVM.ts, this file only renders + handles events.
   *
   * Opens via windowManager.open() with singletonKey = "sheet:Actor:<actorId>"
   * (wired by the caller — see registerEtmosSheets.ts, mirroring registerPf2eSheets.ts).
   * Autosave: field changes debounce -> doc:update via sendOpFn.
   *
   * "Conjurar" button (Grimório tab) does NOT import the Compositor directly —
   * the Compositor window (Compositor.svelte + compositorVM.ts) is a separate
   * deliverable (M5-D / D2, design doc §3.1/§3.5). This component takes an
   * `onConjurar` callback prop so D2 can wire the actual
   * `windowManager.open({ singletonKey: "compositor:<actorId>" })` call without
   * D1 needing that file to exist yet. Default is a no-op with a console.warn,
   * matching the injected-dependency pattern already used for `sendOpFn`.
   *
   * Props:
   *   doc        — reactive actor document from DocumentMirror
   *   actorId    — actor._id
   *   ownership  — OwnershipLevel for the current user
   *   userId     — current user's id
   *   isGm       — true if current user is GM
   *   sendOpFn   — callback to emit ops via socket (injected for testability)
   *   onConjurar — callback invoked when "Conjurar" is clicked (opens the Compositor — D2)
   *
   * REQ-ETM-006..014, REQ-ETM-042/043, REQ-ETM-051 (i18n pt-BR).
   * Spec: 19-sistema-etmos.md. Design doc: docs/design/m5-etmos-compositor.md §4.1/§4.3.
   */

  import { OradorSheetVM } from "$lib/sheets/etmos/oradorSheetVM.js";
  import type {
    DocUpdatePayload,
    TrilhaAtributo,
    EtmosProgressaoConfirmarOp,
  } from "$lib/sheets/etmos/oradorSheetVM.js";
  import { buildContestadoOp } from "$lib/sheets/etmos/contestadoVM.js";
  import type { ContestadoAtributo, EtmosTesteContestadoOp } from "$lib/sheets/etmos/contestadoVM.js";
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
    sendOpFn?: (op: DocUpdatePayload | EtmosTesteContestadoOp | EtmosProgressaoConfirmarOp) => void;
    onConjurar?: (actorId: string) => void;
  }

  let {
    doc,
    actorId,
    ownership,
    userId,
    isGm,
    sendOpFn = () => {},
    onConjurar = (id: string) => {
      // eslint-disable-next-line no-console
      console.warn(`[OradorSheet] onConjurar not wired — cannot open Compositor for actor ${id}`);
    },
  }: Props = $props();

  // ---------------------------------------------------------------------------
  // View-model — recreated whenever doc changes
  // ---------------------------------------------------------------------------

  const vm = $derived(new OradorSheetVM({ doc, actorId, ownership, userId, isGm }));

  // ---------------------------------------------------------------------------
  // Tab state
  // ---------------------------------------------------------------------------

  type OradorTab = "principal" | "grimorio" | "marcos" | "conceito";
  let activeTab = $state<OradorTab>("principal");

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

  function clickAtributoPip(slug: TrilhaAtributo, index: number): void {
    // Click pip N (0-based) -> set value to N+1; clicking the currently-filled top pip clears one.
    const current = vm.atributo(slug).value;
    const clicked = index + 1;
    const next = current === clicked ? clicked - 1 : clicked;
    applyNow(vm.setAtributo(slug, Math.max(1, next)));
  }

  function ferimentosDelta(delta: number): void {
    applyNow(vm.applyFerimentosDelta(delta));
  }

  function estresseDelta(delta: number): void {
    applyNow(vm.applyEstresseDelta(delta));
  }

  function dadosEmpenhoDelta(delta: number): void {
    applyNow(vm.applyDadosEmpenhoDelta(delta));
  }

  function novoDia(): void {
    applyNow(vm.resetDadosEmpenho());
  }

  function toggleTotem(): void {
    applyNow(vm.setTemTotem(!vm.temTotem));
  }

  function handleRankTotemInput(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    const value = parseInt(input.value, 10);
    if (!Number.isNaN(value)) applyNow(vm.setRankTotem(value));
  }

  function handleConceitoInput(field: "basico" | "aparencia" | "pontos_importancia" | "futuro", e: Event): void {
    const input = e.currentTarget as HTMLTextAreaElement;
    scheduleUpdate(vm.fieldUpdate(`system.conceito.${field}`, input.value));
  }

  function clickMarcoPip(categoria: "fisicos" | "mentais" | "emocionais", index: number): void {
    const current = vm.marcos[categoria].value;
    const clicked = index + 1;
    const next = current === clicked ? clicked - 1 : clicked;
    applyNow(vm.setMarcoValue(categoria, Math.max(0, next)));
  }

  function conjurar(): void {
    onConjurar(actorId);
  }

  // ---------------------------------------------------------------------------
  // Teste Contestado — REQ-ETM-021, CA-6 (minimal UI surface, M5-E).
  // Fires ONE etmos:teste:contestado op; the server rolls BOTH sides via
  // RollService and resolves the winner via resolverContestado. This sheet
  // never decides a winner or rolls dice itself.
  // ---------------------------------------------------------------------------

  let contestadoAtributo = $state<ContestadoAtributo>("corpo");
  let contestadoOponenteBonus = $state(0);
  let contestadoDescricao = $state("");

  function dispararContestado(): void {
    const op = buildContestadoOp({
      meuActorId: actorId,
      meuAtributo: contestadoAtributo,
      oponenteActorId: null,
      oponenteBonus: contestadoOponenteBonus,
      descricao: contestadoDescricao,
    });
    sendOpFn(op);
  }

  // ---------------------------------------------------------------------------
  // Marcos de Crescimento / Tabela E — REQ-ETM-035..039, CA-11.
  //
  // Per Tabela E (systems/etmos/src/compositor/progressao.ts), "Físico" and
  // "Emocional" ALWAYS grant Grimório/Habilidade Items (never an Atributo
  // point) at every transição — only "Mental" is ever an Atributo pick. The
  // server derives + enforces this same mapping from opcoesProgressao()
  // (progressao-handler.ts's anti-forge check, M5-E audit FIX 1); this form
  // mirrors it by always rendering the Item-id field(s) for Físico/Emocional
  // and the Atributo select for Mental — no runtime branching needed. A full
  // compendium/Partícula picker UI is a documented V2 gancho below; for now
  // the player/GM types the already-known Item id(s) (some Tabela E rows
  // grant 2-3 Items at once, e.g. nivel 1->2's "+1 Objeto e +1
  // Característica" — the input accepts a comma-separated list, up to the
  // zod schema's max of 10 ids).
  // ---------------------------------------------------------------------------

  let progressaoFisicaItemIdsRaw = $state("");
  let progressaoMentalAtributo = $state<TrilhaAtributo>("corpo");
  let progressaoEmocionalItemIdsRaw = $state("");

  function parseItemIds(raw: string): string[] {
    return raw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
  }

  const progressaoFisicaItemIds = $derived(parseItemIds(progressaoFisicaItemIdsRaw));
  const progressaoEmocionalItemIds = $derived(parseItemIds(progressaoEmocionalItemIdsRaw));

  /** Confirmar is only enabled once BOTH Item-id fields resolve to at least one id — an empty itemIds: [] is rejected by the server's zod schema with a raw/unfriendly message. */
  const podeConfirmarProgressao = $derived(
    progressaoFisicaItemIds.length > 0 && progressaoEmocionalItemIds.length > 0,
  );

  function confirmarSubidaDeNivel(): void {
    if (!podeConfirmarProgressao) return;
    const op = vm.buildProgressaoConfirmarOp(
      { tipo: "items", itemIds: progressaoFisicaItemIds },
      { tipo: "atributo", atributo: progressaoMentalAtributo },
      { tipo: "items", itemIds: progressaoEmocionalItemIds },
    );
    if (op) sendOpFn(op);
  }
</script>

<!-- ======================================================================
  Orador Sheet
  REQ-UIF-061: container queries for responsive layout within the window.
====================================================================== -->
<div class="etmos-sheet etmos-orador-sheet" role="document" aria-label="Ficha de Orador: {vm.name}">
  <!-- ---- Header ---- -->
  <header class="sheet-header">
    {#if vm.img}
      <img class="sheet-portrait" src={vm.img} alt="Retrato de {vm.name}" width="56" height="56" />
    {/if}

    <div class="sheet-header__info">
      <h2 class="sheet-header__name">{vm.name}</h2>
      <div class="sheet-header__subtitle">
        {vm.especie}
        {#if vm.especie} · {/if}
        {t("ETMOS.Orador.Labels.Nivel")} {vm.nivel} ·
        {t(`ETMOS.Orador.Mundo.${vm.mundoOrigem}`)}
      </div>
    </div>

    {#if saveStatus === "saving"}
      <span class="sheet-save-status sheet-save-status--saving" aria-live="polite">salvando…</span>
    {:else if saveStatus === "saved"}
      <span class="sheet-save-status sheet-save-status--saved" aria-live="polite">salvo</span>
    {/if}
  </header>

  <!-- ---- Atributos row (3 trilhas 1..6) ---- -->
  <div class="atributo-row" role="list" aria-label="Atributos">
    {#each vm.atributos as atributo (atributo.slug)}
      <div class="atributo-block" role="listitem">
        <span class="atributo-block__label">{t(`ETMOS.Orador.Atributos.${atributo.slug}`)}</span>
        <div class="atributo-trilha" role="group" aria-label="{t(`ETMOS.Orador.Atributos.${atributo.slug}`)}: {atributo.value}/{atributo.max}">
          {#each { length: atributo.max } as _, i}
            <button
              class="atributo-pip"
              class:atributo-pip--filled={i < atributo.value}
              disabled={!vm.editable}
              onclick={() => clickAtributoPip(atributo.slug, i)}
              aria-label="Marcar {i + 1}"
            ></button>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <!--
    TODO [V2] REQ-ETM-041 (Descanso Parcial/Completo): plug a "Descansar"
    button here (Ferimentos/Estresse tracker row) that opens a small
    Parcial/Completo picker with the Tratamento Médico (-2 Ferimentos extra)
    and Mundo de Origem (Completo->Parcial, Parcial sem efeito fora do mundo
    de origem) modifiers from packs-src/tabelas.json's
    "tabela_descanso_recuperacao", then applies the resulting deltas via
    vm.applyFerimentosDelta()/vm.applyEstresseDelta() (already the single
    write path for both trackers — no new mutation primitive needed).
  -->
  <!-- ---- Trackers row ---- -->
  <div class="tracker-row">
    <div class="tracker-block" aria-label="{t('ETMOS.Orador.Trackers.Ferimentos')}: {vm.ferimentos.atual}/{vm.ferimentos.limite}">
      <span class="tracker-block__label">{t("ETMOS.Orador.Trackers.Ferimentos")}</span>
      <div class="tracker-block__controls">
        <button disabled={!vm.editable} onclick={() => ferimentosDelta(-1)} aria-label="Reduzir Ferimentos">−</button>
        <span class="tracker-block__value">{vm.ferimentos.atual} / {vm.ferimentos.limite}</span>
        <button disabled={!vm.editable} onclick={() => ferimentosDelta(1)} aria-label="Aumentar Ferimentos">+</button>
      </div>
    </div>

    <div class="tracker-block" aria-label="{t('ETMOS.Orador.Trackers.Estresse')}: {vm.estresse.atual}/{vm.estresse.limite}">
      <span class="tracker-block__label">{t("ETMOS.Orador.Trackers.Estresse")}</span>
      <div class="tracker-block__controls">
        <button disabled={!vm.editable} onclick={() => estresseDelta(-1)} aria-label="Reduzir Estresse">−</button>
        <span class="tracker-block__value">{vm.estresse.atual} / {vm.estresse.limite}</span>
        <button disabled={!vm.editable} onclick={() => estresseDelta(1)} aria-label="Aumentar Estresse">+</button>
      </div>
      <span class="tracker-block__badge tracker-block__badge--{vm.estadoFadiga}">
        {t("ETMOS.Orador.Trackers.EstadoFadiga")}: {t(`ETMOS.Fadiga.${vm.estadoFadiga}`)}
      </span>
    </div>

    <div class="tracker-block" aria-label="{t('ETMOS.Orador.Trackers.DadosEmpenho')}: {vm.dadosEmpenho}">
      <span class="tracker-block__label">{t("ETMOS.Orador.Trackers.DadosEmpenho")}</span>
      <div class="tracker-block__controls">
        <button disabled={!vm.editable} onclick={() => dadosEmpenhoDelta(-1)} aria-label="Reduzir Dados de Empenho">−</button>
        <span class="tracker-block__value">{vm.dadosEmpenho}</span>
        <button disabled={!vm.editable} onclick={() => dadosEmpenhoDelta(1)} aria-label="Aumentar Dados de Empenho">+</button>
      </div>
      {#if vm.editable}
        <button class="btn-secondary" onclick={novoDia}>{t("ETMOS.Orador.Trackers.NovoDia")}</button>
      {/if}
    </div>

    <div class="tracker-block tracker-block--readonly" aria-label="Complexidade Máxima: {vm.complexidadeMaxima}">
      <span class="tracker-block__label">{t("ETMOS.Orador.Trackers.ComplexidadeMaxima")}</span>
      <span class="tracker-block__value tracker-block__value--complexidade tracker-block__value--{vm.complexidadeMaxima}">
        {t(`ETMOS.Complexidade.${vm.complexidadeMaxima}`)}
      </span>
    </div>
  </div>

  <!-- ---- Tab bar ---- -->
  <div class="tab-bar" role="tablist" aria-label="Seções da ficha do Orador">
    {#each (["principal", "grimorio", "marcos", "conceito"] as const) as tab}
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
        {t(`ETMOS.Orador.Tabs.${tab.charAt(0).toUpperCase()}${tab.slice(1)}`)}
      </button>
    {/each}
  </div>

  <!-- ---- Tab panels ---- -->

  {#if activeTab === "principal"}
    <section id="tab-panel-principal" role="tabpanel" aria-labelledby="tab-principal" class="tab-panel">
      <div class="field-grid">
        <label class="field">
          <span class="field__label">{t("ETMOS.Orador.Labels.PlayerName")}</span>
          <input
            type="text"
            value={vm.playerName}
            disabled={!vm.editable}
            oninput={(e) => scheduleUpdate(vm.fieldUpdate("system.player_name", (e.currentTarget as HTMLInputElement).value))}
          />
        </label>
        <label class="field">
          <span class="field__label">{t("ETMOS.Orador.Labels.Especie")}</span>
          <input
            type="text"
            value={vm.especie}
            disabled={!vm.editable}
            oninput={(e) => scheduleUpdate(vm.fieldUpdate("system.especie", (e.currentTarget as HTMLInputElement).value))}
          />
        </label>
        <label class="field">
          <span class="field__label">{t("ETMOS.Orador.Labels.AnoEscolar")}</span>
          <input
            type="text"
            value={vm.anoEscolar}
            disabled={!vm.editable}
            oninput={(e) => scheduleUpdate(vm.fieldUpdate("system.ano_escolar", (e.currentTarget as HTMLInputElement).value))}
          />
        </label>
        <label class="field">
          <span class="field__label">{t("ETMOS.Orador.Labels.Idade")}</span>
          <input
            type="number"
            min="0"
            value={vm.idade}
            disabled={!vm.editable}
            oninput={(e) => scheduleUpdate(vm.fieldUpdate("system.idade", parseInt((e.currentTarget as HTMLInputElement).value, 10) || 0))}
          />
        </label>
        <label class="field">
          <span class="field__label">{t("ETMOS.Orador.Labels.MundoOrigem")}</span>
          <select
            value={vm.mundoOrigem}
            disabled={!vm.editable}
            onchange={(e) => applyNow(vm.fieldUpdate("system.mundo_origem", (e.currentTarget as HTMLSelectElement).value))}
          >
            <option value="mundano">{t("ETMOS.Orador.Mundo.mundano")}</option>
            <option value="fantastico">{t("ETMOS.Orador.Mundo.fantastico")}</option>
          </select>
        </label>
      </div>

      <div class="totem-block">
        <h3 class="section-header">{t("ETMOS.Orador.Totem.Titulo")}</h3>
        <label class="field field--checkbox">
          <input type="checkbox" checked={vm.temTotem} disabled={!vm.editable} onchange={toggleTotem} />
          <span>{t("ETMOS.Orador.Totem.Possui")}</span>
        </label>
        {#if vm.temTotem}
          <label class="field">
            <span class="field__label">{t("ETMOS.Orador.Totem.Rank")}</span>
            <input
              type="number"
              min="0"
              max="5"
              value={vm.rankTotem}
              disabled={!vm.editable}
              oninput={handleRankTotemInput}
            />
          </label>
        {/if}
      </div>

      <!-- Teste Contestado — REQ-ETM-021, CA-6 -->
      <div class="contestado-block">
        <h3 class="section-header">{t("ETMOS.Orador.Contestado.Titulo")}</h3>
        <div class="field-grid">
          <label class="field">
            <span class="field__label">{t("ETMOS.Orador.Contestado.MeuAtributo")}</span>
            <select bind:value={contestadoAtributo} disabled={!vm.editable}>
              <option value="corpo">{t("ETMOS.Orador.Atributos.corpo")}</option>
              <option value="alma">{t("ETMOS.Orador.Atributos.alma")}</option>
              <option value="mente">{t("ETMOS.Orador.Atributos.mente")}</option>
            </select>
          </label>
          <label class="field">
            <span class="field__label">{t("ETMOS.Orador.Contestado.BonusOponente")}</span>
            <input type="number" bind:value={contestadoOponenteBonus} disabled={!vm.editable} />
          </label>
          <label class="field field--full">
            <span class="field__label">{t("ETMOS.Orador.Contestado.Descricao")}</span>
            <input type="text" bind:value={contestadoDescricao} disabled={!vm.editable} />
          </label>
        </div>
        <button
          class="btn-primary btn-contestado"
          disabled={!vm.editable}
          onclick={dispararContestado}
          aria-label={t("ETMOS.Orador.Contestado.Disparar")}
        >
          ⚔️ {t("ETMOS.Orador.Contestado.Disparar")}
        </button>
      </div>
    </section>
  {:else if activeTab === "grimorio"}
    <section id="tab-panel-grimorio" role="tabpanel" aria-labelledby="tab-grimorio" class="tab-panel">
      <!--
        TODO [V2] REQ-ETM-048 ("modo baralho de Grimório"): this list render
        (vm.grimorio, grouped by categoria) is the plug point for an
        alternative card-grid presentation — swap this <ul> for a draggable
        ParticulaGrid.svelte-style layout (see
        components/sheets/etmos/ParticulaGrid.svelte, already used by the
        Compositor) behind a view-mode toggle. vm.grimorio's data shape is
        already suitable for either renderer; no VM change needed to add the
        toggle.
      -->
      <!--
        TODO [V2] REQ-ETM-044/045 (calculadora assistida de Encantamento):
        this Grimório tab is the plug point for a future "Encantar Item"
        affordance — a Grau de Sofisticação (Simples/Sofisticado/Primoroso)
        + PP-accumulation-factors form that produces a PP suggestion and
        tracks progress toward completing an `item_encantado` Item (the
        Narrador always has the final editable say, REQ-ETM-044). Out of
        scope for M5-E — no `item_encantado` UI exists yet anywhere in this
        sheet; this comment is the single plug point for it.
      -->
      <button class="btn-primary btn-conjurar" onclick={conjurar} aria-label={t("ETMOS.Orador.Grimorio.Conjurar")}>
        ✨ {t("ETMOS.Orador.Grimorio.Conjurar")}
      </button>

      {#if !vm.hasParticulas}
        <p class="empty-state">{t("ETMOS.Orador.Grimorio.Empty")}</p>
      {:else}
        {#each (["funcao", "objeto", "caracteristica", "complemento"] as const) as categoria}
          {#if vm.grimorio[categoria].length > 0}
            <h3 class="section-header">{t(`ETMOS.Orador.Grimorio.Categoria.${categoria}`)}</h3>
            <ul class="particula-list" aria-label={t(`ETMOS.Orador.Grimorio.Categoria.${categoria}`)}>
              {#each vm.grimorio[categoria] as particula (particula.itemId)}
                <li class="particula-row particula-row--{categoria}">
                  <span class="particula-row__icon" aria-hidden="true">{particula.palavraEtmos.charAt(0)}</span>
                  <span class="particula-row__palavra">{particula.palavraEtmos}</span>
                  <span class="particula-row__significado">{particula.significado}</span>
                  {#if particula.nivelGrimorio !== null}
                    <span class="particula-row__nivel">{t("ETMOS.Orador.Grimorio.NivelGrimorio", { n: particula.nivelGrimorio })}</span>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        {/each}
      {/if}
    </section>
  {:else if activeTab === "marcos"}
    <section id="tab-panel-marcos" role="tabpanel" aria-labelledby="tab-marcos" class="tab-panel">
      <!--
        REQ-ETM-035..039, CA-11: trilhas clicáveis + subida de nível via
        Tabela E quando as 3 estão completas (vm.podeSubirDeNivel). A
        aplicação do bônus é semiautomática (REQ-ETM-038): Atributo é um
        select direto; Partícula/Habilidade usa um campo de Item id (o
        seletor de compendium completo é um gancho V2 — ver bloco de notas
        abaixo do formulário).
      -->
      {#each (["fisicos", "mentais", "emocionais"] as const) as categoria}
        <div class="marco-row">
          <span class="marco-row__label">{t(`ETMOS.Orador.Marcos.${categoria.charAt(0).toUpperCase()}${categoria.slice(1)}`)}</span>
          <div class="marco-trilha" role="group" aria-label="{categoria}: {vm.marcos[categoria].value}/{vm.marcos[categoria].max}">
            {#each { length: vm.marcos[categoria].max } as _, i}
              <button
                class="marco-pip"
                class:marco-pip--filled={i < vm.marcos[categoria].value}
                disabled={!vm.editable}
                onclick={() => clickMarcoPip(categoria, i)}
                aria-label="Marcar {i + 1}"
              ></button>
            {/each}
          </div>
          {#if vm.marcos[categoria].value >= vm.marcos[categoria].max}
            <span class="marco-row__bonus" aria-label={t("ETMOS.Orador.Marcos.BonusDisponivel")}>
              ✓ {t("ETMOS.Orador.Marcos.BonusDisponivel")}
            </span>
          {/if}
        </div>
      {/each}

      {#if vm.podeSubirDeNivel && vm.opcaoProgressao}
        <div class="progressao-block">
          <h3 class="section-header">{t("ETMOS.Orador.Progressao.Titulo", { n: vm.opcaoProgressao.paraNivel })}</h3>

          <div class="progressao-row">
            <span class="progressao-row__label">{t("ETMOS.Orador.Progressao.Fisica")}</span>
            <span class="progressao-row__opcao">{vm.opcaoProgressao.fisica}</span>
            <input
              type="text"
              placeholder={t("ETMOS.Orador.Progressao.ItemIdPlaceholder")}
              bind:value={progressaoFisicaItemIdsRaw}
              disabled={!vm.editable}
            />
          </div>

          <div class="progressao-row">
            <span class="progressao-row__label">{t("ETMOS.Orador.Progressao.Mental")}</span>
            <span class="progressao-row__opcao">{vm.opcaoProgressao.mental}</span>
            <select bind:value={progressaoMentalAtributo} disabled={!vm.editable}>
              <option value="corpo">{t("ETMOS.Orador.Atributos.corpo")}</option>
              <option value="alma">{t("ETMOS.Orador.Atributos.alma")}</option>
              <option value="mente">{t("ETMOS.Orador.Atributos.mente")}</option>
            </select>
          </div>

          <div class="progressao-row">
            <span class="progressao-row__label">{t("ETMOS.Orador.Progressao.Emocional")}</span>
            <span class="progressao-row__opcao">{vm.opcaoProgressao.emocional}</span>
            <input
              type="text"
              placeholder={t("ETMOS.Orador.Progressao.ItemIdPlaceholder")}
              bind:value={progressaoEmocionalItemIdsRaw}
              disabled={!vm.editable}
            />
          </div>

          <button
            class="btn-primary btn-progressao"
            disabled={!vm.editable || !podeConfirmarProgressao}
            onclick={confirmarSubidaDeNivel}
            aria-label={t("ETMOS.Orador.Progressao.Confirmar")}
          >
            ⭐ {t("ETMOS.Orador.Progressao.Confirmar")}
          </button>
        </div>
      {/if}
    </section>
  {:else if activeTab === "conceito"}
    <section id="tab-panel-conceito" role="tabpanel" aria-labelledby="tab-conceito" class="tab-panel">
      <label class="field field--full">
        <span class="field__label">{t("ETMOS.Orador.Conceito.Basico")}</span>
        <textarea
          disabled={!vm.editable}
          value={vm.conceitoBasico}
          oninput={(e) => handleConceitoInput("basico", e)}
        ></textarea>
      </label>
      <label class="field field--full">
        <span class="field__label">{t("ETMOS.Orador.Conceito.Aparencia")}</span>
        <textarea
          disabled={!vm.editable}
          value={vm.conceitoAparencia}
          oninput={(e) => handleConceitoInput("aparencia", e)}
        ></textarea>
      </label>
      <label class="field field--full">
        <span class="field__label">{t("ETMOS.Orador.Conceito.PontosImportancia")}</span>
        <textarea
          disabled={!vm.editable}
          value={vm.conceitoPontosImportancia}
          oninput={(e) => handleConceitoInput("pontos_importancia", e)}
        ></textarea>
      </label>
      <label class="field field--full">
        <span class="field__label">{t("ETMOS.Orador.Conceito.Futuro")}</span>
        <textarea
          disabled={!vm.editable}
          value={vm.conceitoFuturo}
          oninput={(e) => handleConceitoInput("futuro", e)}
        ></textarea>
      </label>
    </section>
  {/if}
</div>

<style>
  .etmos-orador-sheet {
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
    width: 48px;
    height: 48px;
    object-fit: cover;
    border-radius: var(--fusion-radius-sm, 4px);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
  }

  .sheet-header__info {
    flex: 1;
    min-width: 120px;
  }

  .sheet-header__name {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
  }

  .sheet-header__subtitle {
    font-size: 11px;
    color: var(--fusion-color-text-muted, #9999cc);
    margin-top: 2px;
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

  /* Atributos */
  .atributo-row {
    display: flex;
    gap: 6px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--fusion-color-border, #3a3a5c);
    flex-shrink: 0;
  }

  .atributo-block {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px;
    border-radius: var(--fusion-radius-sm, 4px);
    background: var(--fusion-color-surface-raised, #16213e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
  }

  .atributo-block__label {
    font-size: 10px;
    text-transform: uppercase;
    color: var(--fusion-color-text-muted, #9999cc);
  }

  .atributo-trilha {
    display: flex;
    gap: 3px;
  }

  .atributo-pip {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    background: transparent;
    cursor: pointer;
    padding: 0;
  }

  .atributo-pip:disabled {
    cursor: default;
  }

  .atributo-pip--filled {
    background: var(--fusion-color-accent, #5b8dee);
  }

  /* Trackers */
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
    min-width: 120px;
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

  .tracker-block__value--complexidade {
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 12px;
  }
  .tracker-block__value--trivial { background: rgba(120, 120, 120, 0.25); }
  .tracker-block__value--regular { background: rgba(91, 141, 238, 0.25); }
  .tracker-block__value--dificil { background: rgba(255, 170, 60, 0.25); }
  .tracker-block__value--complexa { background: rgba(255, 100, 100, 0.25); }
  .tracker-block__value--milagre { background: rgba(200, 100, 255, 0.3); }

  .tracker-block__badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
  }
  .tracker-block__badge--normal { color: var(--fusion-color-success, #44cc88); }
  .tracker-block__badge--cansado { color: var(--fusion-color-warning, #ffcc00); }
  .tracker-block__badge--exausto { color: #ff8844; }
  .tracker-block__badge--esgotado { color: #ff4444; }

  .btn-secondary {
    font-size: 10px;
    padding: 3px 8px;
    border-radius: var(--fusion-radius-sm, 4px);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    background: transparent;
    color: var(--fusion-color-text-primary, #e0e0ff);
    cursor: pointer;
  }

  .btn-primary {
    padding: 8px 16px;
    border-radius: var(--fusion-radius-sm, 4px);
    border: none;
    background: var(--fusion-color-accent, #5b8dee);
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-conjurar {
    margin-bottom: 12px;
  }

  /* Tabs */
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

  .section-header:first-child {
    margin-top: 0;
  }

  /* Fields */
  .field-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .field--full {
    grid-column: 1 / -1;
    margin-bottom: 10px;
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

  .field textarea {
    min-height: 56px;
    resize: vertical;
    font-family: inherit;
  }

  .totem-block {
    margin-top: 8px;
  }

  .contestado-block {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--fusion-color-border, #3a3a5c);
  }

  .btn-contestado {
    margin-top: 8px;
  }

  /* Grimório */
  .particula-list {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .particula-row {
    display: grid;
    grid-template-columns: 20px 1fr 1fr auto;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: var(--fusion-radius-sm, 4px);
    border-left: 3px solid var(--fusion-color-border, #3a3a5c);
  }

  .particula-row--funcao { border-left-color: #5b8dee; }
  .particula-row--objeto { border-left-color: #44cc88; }
  .particula-row--caracteristica { border-left-color: #ffcc00; }
  .particula-row--complemento { border-left-color: #cc88ff; }

  .particula-row__icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 3px;
    background: var(--fusion-color-surface-raised, #16213e);
    font-size: 10px;
    font-weight: 700;
  }

  .particula-row__palavra {
    font-weight: 700;
    font-size: 12px;
  }

  .particula-row__significado {
    font-size: 11px;
    color: var(--fusion-color-text-muted, #9999cc);
  }

  .particula-row__nivel {
    font-size: 10px;
    color: var(--fusion-color-text-muted, #9999cc);
  }

  /* Marcos */
  .info-banner {
    font-size: 11px;
    color: var(--fusion-color-text-muted, #9999cc);
    background: var(--fusion-color-surface-raised, #16213e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
    padding: 8px;
    margin-bottom: 10px;
  }

  .marco-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
  }

  .marco-row__label {
    min-width: 80px;
    font-size: 11px;
    color: var(--fusion-color-text-secondary, #b0b0cc);
  }

  .marco-trilha {
    display: flex;
    gap: 3px;
  }

  .marco-pip {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    background: transparent;
    cursor: pointer;
    padding: 0;
  }

  .marco-pip--filled {
    background: var(--fusion-color-magic, #aa66ff);
  }

  .marco-row__bonus {
    font-size: 10px;
    color: var(--fusion-color-success, #44cc88);
  }

  .progressao-block {
    margin-top: 16px;
    padding: 10px;
    border: 1px solid var(--fusion-color-magic, #aa66ff);
    border-radius: var(--fusion-radius-sm, 4px);
    background: rgba(170, 102, 255, 0.08);
  }

  .progressao-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }

  .progressao-row__label {
    font-size: 10px;
    text-transform: uppercase;
    color: var(--fusion-color-text-muted, #9999cc);
  }

  .progressao-row__opcao {
    font-size: 12px;
  }

  .progressao-row select,
  .progressao-row input {
    background: var(--fusion-color-surface-raised, #16213e);
    border: 1px solid var(--fusion-color-border, #3a3a5c);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-color-text-primary, #e0e0ff);
    padding: 4px 6px;
    font-size: 12px;
  }

  .btn-progressao {
    margin-top: 4px;
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
