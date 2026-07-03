<script lang="ts">
  /**
   * FrasePreview.svelte — live frase_completa preview + validation + cost.
   *
   * Renders the tokens produced by montarFrase() with placeholder tipográfico
   * coloring by categoria (D7), the validarFrase() errors/warnings (CLIENT
   * FEEDBACK ONLY — server re-validates authoritatively on propor), and the
   * custoEstresse() estimate per Complexidade tier, marking tiers above the
   * conjurador's complexidadeMaxima(mente).
   *
   * Design doc m5-etmos-compositor.md §3.2 step (f), §3.5.
   * CA-8: Et + Imu -> "Etimu" renders here.
   */
  import { t } from "$lib/i18n/i18n.js";
  import type { CompositorVM } from "$lib/sheets/etmos/compositorVM.js";

  interface Props {
    vm: CompositorVM;
  }

  const { vm }: Props = $props();

  const tokens = $derived(vm.fraseTokens);
  const validacao = $derived(vm.validacao);
  const custoPreview = $derived(vm.custoPreview);
</script>

<div class="frase-preview" aria-label={t("ETMOS.Compositor.Passo.Preview")}>
  <!-- Frase falada -->
  <div class="frase-preview__frase" data-testid="frase-completa">
    {#if tokens.length === 0}
      <span class="frase-preview__empty">{t("ETMOS.Compositor.Preview.FraseVazia")}</span>
    {:else}
      {#each tokens as tok, i (i)}
        <span class="frase-token frase-token--{tok.categoria}">{tok.text}</span>
      {/each}
    {/if}
  </div>

  <!-- Erros / avisos -->
  {#if validacao.erros.length > 0}
    <ul class="frase-preview__erros" role="list" aria-label="Erros de sintaxe">
      {#each validacao.erros as erro (erro)}
        <li class="frase-preview__erro">{t(erro)}</li>
      {/each}
    </ul>
  {/if}
  {#if validacao.avisos.length > 0}
    <ul class="frase-preview__avisos" role="list" aria-label="Avisos de sintaxe">
      {#each validacao.avisos as aviso (aviso)}
        <li class="frase-preview__aviso">{t(aviso)}</li>
      {/each}
    </ul>
  {/if}

  <!-- Custo por Complexidade -->
  <div class="frase-preview__custos">
    <h4 class="frase-preview__custos-title">{t("ETMOS.Compositor.Preview.CustoPorComplexidade")}</h4>
    <div class="frase-preview__custos-row">
      {#each custoPreview as tier (tier.complexidade)}
        <div
          class="custo-chip"
          class:custo-chip--excede={tier.excedeMaxima}
          title={tier.excedeMaxima ? t("ETMOS.Compositor.Preview.ExcedeMaxima") : ""}
        >
          <span class="custo-chip__label">{t(`ETMOS.Complexidade.${tier.complexidade}`)}</span>
          <span class="custo-chip__value">{tier.custo}</span>
          {#if tier.excedeMaxima}
            <span class="custo-chip__badge" aria-label={t("ETMOS.Compositor.Preview.ExcedeMaxima")}>!</span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .frase-preview {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border-radius: var(--fusion-radius);
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
  }

  .frase-preview__frase {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 16px;
    font-weight: 700;
    font-family: var(--fusion-font-mono);
    min-height: 24px;
  }

  .frase-preview__empty {
    color: var(--fusion-text-muted);
    font-size: 12px;
    font-weight: 400;
    font-family: var(--fusion-font);
  }

  .frase-token {
    padding: 2px 6px;
    border-radius: var(--fusion-radius-sm);
  }

  .frase-token--funcao { color: #ff8b6a; background: rgba(255, 139, 106, 0.12); }
  .frase-token--objeto { color: #66aaff; background: rgba(102, 170, 255, 0.12); }
  .frase-token--caracteristica { color: #3ddc84; background: rgba(61, 220, 132, 0.12); }
  .frase-token--complemento { color: #cc88ff; background: rgba(204, 136, 255, 0.12); }

  .frase-preview__erros,
  .frase-preview__avisos {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .frase-preview__erro {
    font-size: 11px;
    color: var(--fusion-danger);
  }

  .frase-preview__aviso {
    font-size: 11px;
    color: var(--fusion-warning);
  }

  .frase-preview__custos-title {
    margin: 0 0 4px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fusion-text-muted);
  }

  .frase-preview__custos-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .custo-chip {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px 8px;
    border-radius: var(--fusion-radius-sm);
    border: 1px solid var(--fusion-border);
    background: var(--fusion-surface);
    min-width: 56px;
  }

  .custo-chip--excede {
    border-color: var(--fusion-warning);
    background: rgba(255, 200, 87, 0.08);
  }

  .custo-chip__label {
    font-size: 9px;
    color: var(--fusion-text-muted);
    text-transform: uppercase;
  }

  .custo-chip__value {
    font-size: 14px;
    font-weight: 700;
  }

  .custo-chip__badge {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--fusion-warning);
    color: #1a1a1a;
    font-size: 10px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
  }
</style>
