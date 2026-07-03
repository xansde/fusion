<script lang="ts">
  /**
   * MarcosTrilha.svelte — clickable 5-box Marco de Crescimento track.
   *
   * [V2 interno] stub (design doc §3.5, REQ-ETM-035..039): clicking a box
   * sets the trilha's `value` up to that box (or clears it if the same box is
   * clicked again). The full level-up trigger (Tabela E, subida de nível) is
   * M5-E scope — this component only tracks the clickable boxes so the
   * Orador sheet's Marcos tab is not blocked on the compositor batch.
   *
   * Design doc m5-etmos-compositor.md §3.5, §4.1.
   */
  interface Props {
    label: string;
    value: number;
    max: number;
    onSet: (value: number) => void;
  }

  const { label, value, max, onSet }: Props = $props();

  function handleClick(boxIndex: number): void {
    const clickedValue = boxIndex + 1;
    onSet(clickedValue === value ? clickedValue - 1 : clickedValue);
  }
</script>

<div class="marcos-trilha" role="group" aria-label={label}>
  <span class="marcos-trilha__label">{label}</span>
  <div class="marcos-trilha__boxes">
    {#each { length: max } as _, i (i)}
      <button
        type="button"
        class="marcos-trilha__box"
        class:marcos-trilha__box--filled={i < value}
        onclick={() => handleClick(i)}
        aria-label="{label} {String(i + 1)}/{String(max)}"
        aria-pressed={i < value}
      ></button>
    {/each}
  </div>
  {#if value >= max}
    <span class="marcos-trilha__complete" aria-label="Trilha completa">✓</span>
  {/if}
</div>

<style>
  .marcos-trilha {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .marcos-trilha__label {
    font-size: 11px;
    color: var(--fusion-text-muted);
    min-width: 64px;
  }

  .marcos-trilha__boxes {
    display: flex;
    gap: 4px;
  }

  .marcos-trilha__box {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    border: 1px solid var(--fusion-border);
    background: var(--fusion-surface);
    cursor: pointer;
    padding: 0;
  }

  .marcos-trilha__box:hover {
    border-color: var(--fusion-accent);
  }

  .marcos-trilha__box--filled {
    background: var(--fusion-accent);
    border-color: var(--fusion-accent);
  }

  .marcos-trilha__complete {
    color: var(--fusion-success);
    font-weight: 700;
  }
</style>
