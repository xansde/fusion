<script lang="ts">
  /**
   * ConjuracaoCard.svelte — Compositor de Magias chat card (Etmos).
   *
   * Renders `flags.etmos.conjuracao` (ConjuracaoCard, @fusion/system-etmos)
   * by state and by the viewing user's role (design doc
   * m5-etmos-compositor.md §3.4). Mounted by ChatMessage.svelte in place of
   * the generic ChatCard when a message carries this flag — this is NOT a
   * `message.card` (CardData) declarative card, it's the Compositor's own
   * state-machine payload, mirroring buildCardMessage's shape in
   * packages/server/src/etmos/conjuracao-handlers.ts.
   *
   * Every button emits ONE of the five `etmos:conjuracao:*` socket ops
   * (packages/shared/src/etmos/protocol.ts's payload schemas) via sendOp —
   * the server re-validates every transition through the pure state machine
   * (podeTransicionar/aplicar) and is the SOLE source of truth; this
   * component's podeArbitrar/podeRolar/etc. getters only decide which
   * buttons to SHOW, never enforce permission themselves.
   *
   * Design doc §3.4. Spec 19-sistema-etmos.md REQ-ETM-029..033/026.
   */

  import type { Socket } from "socket.io-client";
  import type { ConjuracaoCard as ConjuracaoCardData, Complexidade } from "@fusion/system-etmos";
  import { t } from "$lib/i18n/i18n.js";
  import { sendOp } from "$lib/docs/sendOp.js";
  import { worldMirror } from "$lib/docs/worldSync.js";
  import {
    ConjuracaoCardVM,
    resolveViewerRole,
    COMPLEXIDADE_NUMERO,
    numeroParaComplexidade,
    complexidadeParaNumero,
  } from "$lib/sheets/etmos/conjuracaoCardVM.js";
  import type {
    ArbitrarOp,
    RolarOp,
    ResolverOp,
    CancelarOp,
  } from "$lib/sheets/etmos/conjuracaoCardVM.js";

  type EtmosCardOp = ArbitrarOp | RolarOp | ResolverOp | CancelarOp;

  interface Props {
    card: ConjuracaoCardData;
    messageId: string;
    socket?: Socket | undefined;
    isGm?: boolean;
    userId?: string;
  }

  const { card, messageId, socket, isGm = false, userId = "" }: Props = $props();

  // Resolve "is the current user the owner of the conjurador Actor" from the
  // client's DocumentMirror — best-effort, read-only (the server is the
  // authoritative gate; see module docstring).
  const isOwnerOfConjurador = $derived.by(() => {
    if (!userId) return false;
    const actor = worldMirror.getDoc<Record<string, unknown>>("Actor", card.conjurador_actor_id);
    const ownership = actor?.["ownership"] as Record<string, number> | undefined;
    if (!ownership) return false;
    const level = ownership[userId] ?? ownership["default"] ?? 0;
    return level >= 3; // OwnershipLevel.OWNER
  });

  const rankTotem = $derived.by(() => {
    const actor = worldMirror.getDoc<Record<string, unknown>>("Actor", card.conjurador_actor_id);
    const sys = actor?.["system"] as Record<string, unknown> | undefined;
    const totem = sys?.["totem"] as Record<string, unknown> | undefined;
    return typeof totem?.["rank"] === "number" ? totem["rank"] : 0;
  });

  const role = $derived(resolveViewerRole({ isGm, isOwnerOfConjurador }));
  const vm = $derived(new ConjuracaoCardVM({ card, messageId, role, rankTotem }));

  // ---------------------------------------------------------------------------
  // Arbitrar panel local state (mini-painel inline — design doc §3.4)
  // ---------------------------------------------------------------------------

  let arbitrarAberto = $state(false);
  let complexidadeNumero = $state(2); // "regular" default (1=trivial..5=milagre)
  let custoOverride = $state<number | null>(null);
  let notasNarrador = $state("");
  let dificuldadeAlvo = $state<number | null>(null);
  let pending = $state(false);
  let errorMsg = $state<string | null>(null);

  const complexidadeSelecionada = $derived<Complexidade>(numeroParaComplexidade(complexidadeNumero));
  const custoSugerido = $derived(vm.custoSugerido(complexidadeSelecionada));

  function openArbitrar(): void {
    arbitrarAberto = true;
    errorMsg = null;
  }

  function closeArbitrar(): void {
    arbitrarAberto = false;
  }

  async function emit<R = unknown>(op: EtmosCardOp): Promise<R | null> {
    if (!socket) {
      console.warn("[ConjuracaoCard] no socket provided — cannot emit", op.type);
      return null;
    }
    pending = true;
    errorMsg = null;
    try {
      const { type, ...payload } = op;
      return await sendOp<R>(socket, { type, payload });
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
      return null;
    } finally {
      pending = false;
    }
  }

  async function handleConfirmArbitrar(): Promise<void> {
    const result = await emit(
      vm.buildArbitrarOp({
        complexidade: complexidadeSelecionada,
        custoEstresseOverride: custoOverride,
        notasNarrador,
        dificuldadeAlvo,
      }),
    );
    if (result) arbitrarAberto = false;
  }

  async function handleRecusar(): Promise<void> {
    await emit(vm.buildRecusarOp(notasNarrador));
  }

  async function handleRolar(): Promise<void> {
    await emit(vm.buildRolarOp());
  }

  async function handleResolver(): Promise<void> {
    await emit(vm.buildResolverOp());
  }

  async function handleCancelar(): Promise<void> {
    await emit(vm.buildCancelarOp());
  }
</script>

<div class="conj-card conj-card--{card.estado}" aria-label={t("ETMOS.Card.Titulo")}>
  <!-- Header -->
  <div class="conj-card__header">
    <span class="conj-card__icon" aria-hidden="true">✦</span>
    <span class="conj-card__title">{t("ETMOS.Card.Titulo")}</span>
    <span class="conj-card__estado conj-card__estado--{card.estado}">
      {t(`ETMOS.Card.Estado.${card.estado}`)}
    </span>
  </div>

  <!-- Frase -->
  <div class="conj-card__frase">{card.frase.frase_completa}</div>

  <!-- Intenção -->
  <div class="conj-card__intencao">
    <span class="conj-card__intencao-label">{t("ETMOS.Card.Intencao")}:</span>
    <span class="conj-card__intencao-text">{card.frase.intencao}</span>
  </div>

  <!-- Arbitragem (once set) -->
  {#if card.complexidade !== null}
    <div class="conj-card__arbitragem">
      <span class="conj-card__badge">{t(`ETMOS.Complexidade.${card.complexidade}`)}</span>
      {#if card.custo_estresse !== null}
        <span class="conj-card__badge conj-card__badge--custo">
          {t("ETMOS.Card.Resultado.CustoEstresse")}: {card.custo_estresse}
        </span>
      {/if}
      {#if vm.mostrarAvisoExcedeMaxima}
        <span class="conj-card__badge conj-card__badge--warning" title={t("ETMOS.Card.Arbitrar.AvisoExcedeMaxima")}>
          ⚠ {t("ETMOS.Compositor.Preview.ExcedeMaxima")}
        </span>
      {/if}
    </div>
    {#if card.notas_narrador}
      <p class="conj-card__notas">{card.notas_narrador}</p>
    {/if}
  {/if}

  <!-- Resultado da rolagem -->
  {#if card.estado === "rolada" || card.estado === "resolvida"}
    <div class="conj-card__resultado">
      {#if card.classe_dificuldade}
        <span class="conj-card__badge conj-card__badge--classe">
          {t(vm.classeDificuldadeLabel ?? "")}
        </span>
      {/if}
      {#if vm.resultadoLabel}
        <span class="conj-card__badge conj-card__badge--{card.sucesso ? 'sucesso' : 'falha'}">
          {t(vm.resultadoLabel)}
          {#if card.margem !== null}
            ({card.margem >= 0 ? "+" : ""}{card.margem})
          {/if}
        </span>
      {/if}
    </div>
    {#if vm.temControleFadiga && card.controle_fadiga}
      <div class="conj-card__fadiga">
        <span class="conj-card__fadiga-title">{t("ETMOS.Card.Fadiga.Titulo")}: {card.controle_fadiga.valor}</span>
        {#if card.controle_fadiga.falhou}
          <span class="conj-card__badge conj-card__badge--falha">{t("ETMOS.Card.Fadiga.Falhou")}</span>
        {:else if card.controle_fadiga.morreu}
          <span class="conj-card__badge conj-card__badge--warning">{t("ETMOS.Card.Fadiga.Morreu")}</span>
        {:else}
          <span class="conj-card__badge">{t("ETMOS.Card.Fadiga.Resistiu")}</span>
        {/if}
      </div>
    {/if}
  {/if}

  {#if errorMsg}
    <p class="conj-card__error" role="alert">{errorMsg}</p>
  {/if}

  <!-- Arbitrar mini-painel (inline popover) -->
  {#if arbitrarAberto}
    <div class="conj-card__arbitrar-panel" role="group" aria-label={t("ETMOS.Card.Acoes.Arbitrar")}>
      <label class="conj-card__field">
        <span>{t("ETMOS.Card.Arbitrar.Complexidade")}</span>
        <select bind:value={complexidadeNumero}>
          {#each COMPLEXIDADE_NUMERO as c, i (c)}
            <option value={i + 1}>{complexidadeParaNumero(c)} — {t(`ETMOS.Complexidade.${c}`)}</option>
          {/each}
        </select>
      </label>
      <p class="conj-card__custo-sugerido">
        {t("ETMOS.Card.Arbitrar.CustoSugerido")}: <strong>{custoSugerido}</strong>
      </p>
      <label class="conj-card__field">
        <span>{t("ETMOS.Card.Arbitrar.CustoOverride")}</span>
        <input
          type="number"
          min="0"
          placeholder={String(custoSugerido)}
          value={custoOverride ?? ""}
          oninput={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value;
            custoOverride = v === "" ? null : Number(v);
          }}
        />
      </label>
      <label class="conj-card__field">
        <span>{t("ETMOS.Card.Arbitrar.DificuldadeAlvo")}</span>
        <input
          type="number"
          value={dificuldadeAlvo ?? ""}
          oninput={(e) => {
            const v = (e.currentTarget as HTMLInputElement).value;
            dificuldadeAlvo = v === "" ? null : Number(v);
          }}
        />
      </label>
      <label class="conj-card__field">
        <span>{t("ETMOS.Card.Arbitrar.Notas")}</span>
        <textarea rows="2" bind:value={notasNarrador}></textarea>
      </label>
      <div class="conj-card__panel-actions">
        <button type="button" class="conj-card__btn conj-card__btn--ghost" onclick={closeArbitrar} disabled={pending}>
          {t("FUSION.Header.Leave")}
        </button>
        <button type="button" class="conj-card__btn conj-card__btn--primary" onclick={handleConfirmArbitrar} disabled={pending}>
          {t("ETMOS.Card.Acoes.Confirmar")}
        </button>
      </div>
    </div>
  {/if}

  <!-- Actions -->
  {#if !vm.isFinal}
    <div class="conj-card__actions">
      {#if vm.podeArbitrar && !arbitrarAberto}
        <button type="button" class="conj-card__btn conj-card__btn--primary" onclick={openArbitrar} disabled={pending}>
          {t("ETMOS.Card.Acoes.Arbitrar")}
        </button>
      {/if}
      {#if vm.podeRecusar}
        <button type="button" class="conj-card__btn conj-card__btn--danger" onclick={handleRecusar} disabled={pending}>
          {t("ETMOS.Card.Acoes.Recusar")}
        </button>
      {/if}
      {#if vm.podeRolar}
        <button type="button" class="conj-card__btn conj-card__btn--primary" onclick={handleRolar} disabled={pending}>
          {t("ETMOS.Card.Acoes.Rolar")}
        </button>
      {/if}
      {#if vm.podeResolver}
        <button type="button" class="conj-card__btn conj-card__btn--primary" onclick={handleResolver} disabled={pending}>
          {t("ETMOS.Card.Acoes.Resolver")}
        </button>
      {/if}
      {#if vm.podeCancelar}
        <button type="button" class="conj-card__btn conj-card__btn--ghost" onclick={handleCancelar} disabled={pending}>
          {t("ETMOS.Card.Acoes.Cancelar")}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .conj-card {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    overflow: hidden;
    max-width: 360px;
    margin-top: 0.35rem;
    padding: 0.5rem 0.7rem;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .conj-card__header {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .conj-card__icon {
    color: #cc88ff;
  }

  .conj-card__title {
    flex: 1;
    font-weight: 600;
    font-size: 0.8125rem;
  }

  .conj-card__estado {
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 6px;
    border-radius: 10px;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    color: var(--fusion-text-muted);
  }

  .conj-card--rolada .conj-card__estado,
  .conj-card--resolvida .conj-card__estado {
    color: var(--fusion-success);
    border-color: var(--fusion-success);
  }

  .conj-card--recusada .conj-card__estado,
  .conj-card--cancelada .conj-card__estado {
    color: var(--fusion-danger);
    border-color: var(--fusion-danger);
  }

  .conj-card__frase {
    font-family: var(--fusion-font-mono);
    font-weight: 700;
    font-size: 1rem;
    color: var(--fusion-text);
  }

  .conj-card__intencao {
    font-size: 0.75rem;
    color: var(--fusion-text-muted);
  }

  .conj-card__intencao-label {
    font-weight: 600;
    margin-right: 4px;
  }

  .conj-card__arbitragem,
  .conj-card__resultado {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .conj-card__badge {
    font-size: 0.7rem;
    padding: 2px 7px;
    border-radius: 10px;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    color: var(--fusion-text);
  }

  .conj-card__badge--custo { color: var(--fusion-accent); }
  .conj-card__badge--warning { color: var(--fusion-warning); border-color: var(--fusion-warning); }
  .conj-card__badge--sucesso { color: var(--fusion-success); border-color: var(--fusion-success); }
  .conj-card__badge--falha { color: var(--fusion-danger); border-color: var(--fusion-danger); }
  .conj-card__badge--classe { color: var(--fusion-text-muted); }

  .conj-card__notas {
    font-size: 0.75rem;
    color: var(--fusion-text-muted);
    font-style: italic;
    margin: 0;
  }

  .conj-card__fadiga {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.75rem;
  }

  .conj-card__fadiga-title {
    color: var(--fusion-text-muted);
  }

  .conj-card__error {
    font-size: 0.7rem;
    color: var(--fusion-danger);
    margin: 0;
  }

  .conj-card__arbitrar-panel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface);
    border: 1px dashed var(--fusion-accent-dim);
  }

  .conj-card__field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 0.7rem;
    color: var(--fusion-text-muted);
  }

  .conj-card__field input,
  .conj-card__field select,
  .conj-card__field textarea {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    padding: 4px 6px;
    font-size: 0.75rem;
    font-family: var(--fusion-font);
  }

  .conj-card__custo-sugerido {
    font-size: 0.7rem;
    color: var(--fusion-text-muted);
    margin: 0;
  }

  .conj-card__panel-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }

  .conj-card__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding-top: 4px;
    border-top: 1px solid var(--fusion-border);
  }

  .conj-card__btn {
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.3rem 0.65rem;
  }

  .conj-card__btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .conj-card__btn--primary {
    background: var(--fusion-accent);
    color: #fff;
  }

  .conj-card__btn--primary:not(:disabled):hover {
    background: var(--fusion-accent-hover);
  }

  .conj-card__btn--ghost {
    background: transparent;
    border-color: var(--fusion-border);
    color: var(--fusion-text-muted);
  }

  .conj-card__btn--danger {
    background: rgba(255, 92, 92, 0.12);
    border-color: var(--fusion-danger);
    color: var(--fusion-danger);
  }
</style>
