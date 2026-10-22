<script lang="ts">
  /**
   * AreaStyleControls — colour (6 swatches), border (thin/medium/thick) and fill opacity
   * (10-70%) of an area template. Used both by the tool picker (the style of the next
   * area) and by the right-click menu of a pinned one.
   */
  import { AREA_PALETTE, AREA_FILL_MIN, AREA_FILL_MAX, type AreaBorder, type AreaStyle } from "@fusion/shared";

  interface Props {
    style: AreaStyle;
    onchange: (patch: Partial<AreaStyle>) => void;
  }
  let { style, onchange }: Props = $props();

  const BORDERS: ReadonlyArray<{ value: AreaBorder; label: string }> = [
    { value: "thin", label: "Fina" },
    { value: "medium", label: "Média" },
    { value: "thick", label: "Grossa" },
  ];

  const fillPct = $derived(Math.round(style.fill * 100));
</script>

<div class="area-style" role="group" aria-label="Estilo da área">
  <div class="area-style__swatches">
    {#each AREA_PALETTE as c (c)}
      <button
        type="button"
        class="area-style__swatch"
        class:area-style__swatch--on={style.color.toLowerCase() === c}
        style:background={c}
        aria-label={`Cor ${c}`}
        aria-pressed={style.color.toLowerCase() === c}
        onclick={() => {
          onchange({ color: c });
        }}
      ></button>
    {/each}
  </div>
  <div class="area-style__borders" role="group" aria-label="Espessura da borda">
    {#each BORDERS as b (b.value)}
      <button
        type="button"
        class="area-style__border"
        class:area-style__border--on={style.border === b.value}
        aria-pressed={style.border === b.value}
        onclick={() => {
          onchange({ border: b.value });
        }}
      >
        {b.label}
      </button>
    {/each}
  </div>
  <label class="area-style__fill">
    <span>Opacidade {fillPct}%</span>
    <input
      type="range"
      min={Math.round(AREA_FILL_MIN * 100)}
      max={Math.round(AREA_FILL_MAX * 100)}
      step="5"
      value={fillPct}
      aria-label="Opacidade do preenchimento"
      oninput={(e) => {
        onchange({ fill: Number(e.currentTarget.value) / 100 });
      }}
    />
  </label>
</div>

<style>
  .area-style {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.2rem 0.3rem;
  }
  .area-style__swatches {
    display: flex;
    gap: 0.3rem;
  }
  .area-style__swatch {
    border: 2px solid transparent;
    border-radius: 50%;
    cursor: pointer;
    height: 1.2rem;
    padding: 0;
    width: 1.2rem;
  }
  .area-style__swatch--on {
    border-color: #fff;
    box-shadow: 0 0 0 1px #000;
  }
  .area-style__borders {
    display: flex;
    gap: 0.2rem;
  }
  .area-style__border {
    background: transparent;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    cursor: pointer;
    flex: 1;
    font-family: var(--fusion-font);
    font-size: 0.7rem;
    padding: 0.15rem 0.2rem;
  }
  .area-style__border--on {
    background: var(--fusion-accent);
    border-color: var(--fusion-accent);
    color: var(--fusion-bg);
  }
  .area-style__fill {
    color: var(--fusion-text-muted);
    display: flex;
    flex-direction: column;
    font-size: 0.7rem;
    gap: 0.15rem;
  }
  .area-style__fill input {
    width: 100%;
  }
</style>
