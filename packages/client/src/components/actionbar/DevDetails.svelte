<script lang="ts">
  /**
   * DevDetails.svelte — SCAFFOLDING (BAR-F1-04; removed by BAR-F2-07 with `devStubProvider.ts`).
   *
   * The detail panel the dev stub provider offers (`provider.details`), so the Alt expansion of the
   * tooltip can be seen in the real app before a system brings its own (the PF2e sheet's). Made-up text.
   */
  import type { ActionBarEntry } from "../../lib/actionbar/types.js";

  const { entry }: { entry: ActionBarEntry } = $props();
</script>

<div class="dev-details">
  <b>{entry.label}</b>
  <p>Painel de detalhe do provedor de teste (SCAFFOLDING). Aberto com Alt; o do sistema real é o mesmo da ficha.</p>
  <p>Id da entrada: <code>{entry.id}</code></p>
</div>

<style>
  .dev-details {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 240px;
  }

  .dev-details p {
    margin: 0;
    color: var(--fusion-text-muted);
  }
</style>
