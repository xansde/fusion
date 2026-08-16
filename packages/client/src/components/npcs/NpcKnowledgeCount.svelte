<script lang="ts">
  /**
   * NpcKnowledgeCount.svelte — knowledge on the row, in reading (spec 42 §5.9, G077).
   *
   * "2 conhecem · 1 entreviram", and nothing else (REQ-NPC-070). This component is a
   * `<span>` on purpose: it has no button, no select, no handler and no socket, so
   * there is no control on the row that could alter knowledge (REQ-NPC-071). The one
   * place knowledge is edited is the "Quem conhece quem" window, opened from the
   * footer (REQ-NPC-072) — a door, not a duplicate.
   *
   * Nothing is drawn when the counts are absent: a payload without the knowledge map
   * is every non-privileged payload (REQ-NPC-083, REQ-CTT-084), and an actor nobody
   * could count deserves silence rather than a zero that reads as a fact.
   */

  import { t } from "../../lib/i18n/i18n.js";
  import { describeNpcKnowledge, type NpcKnowledgeCounts } from "../../lib/npcs/npcKnowledge.js";

  const { knowledge }: { knowledge: NpcKnowledgeCounts | null } = $props();

  const label = $derived(describeNpcKnowledge(knowledge));
</script>

{#if label}
  <span
    class="npcs-row__knowledge"
    data-npc-knowledge-known={label.vars.known}
    data-npc-knowledge-glimpsed={label.vars.glimpsed}
    aria-label={t(label.labelKey, label.vars)}
  >
    {t(label.textKey, label.vars)}
  </span>
{/if}

<style>
  /* Discreet, like the 39's counts: it is context for the Mestre, not a headline. */
  .npcs-row__knowledge {
    font-size: 0.68rem;
    color: var(--fusion-text-subtle);
    white-space: nowrap;
  }
</style>
