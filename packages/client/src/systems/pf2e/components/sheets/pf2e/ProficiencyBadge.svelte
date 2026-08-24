<script lang="ts">
  /**
   * ProficiencyBadge.svelte — TEML rank badge (Untrained/Trained/Expert/Master/Legendary).
   *
   * Ports the design contract's ProficiencyBadge.jsx
   * (.fusion-build/r10-design/claude-design/components/character/ProficiencyBadge.jsx)
   * to Svelte 5. Two visual weights:
   *   - "outline" (default, skill rows): coloured letter + coloured border, no fill.
   *   - "filled" (spell stat bar / specimen): tinted fill + coloured border.
   *
   * Colors come from the --fusion-prof-* tokens (base.css, DEC-R10-08).
   */

  import { t } from "$lib/i18n/i18n.js";

  interface Props {
    rank?: "U" | "T" | "E" | "M" | "L";
    variant?: "outline" | "filled";
    size?: number;
    title?: string;
  }

  let { rank = "U", variant = "outline", size = 18, title }: Props = $props();

  const RANK_LABEL_KEYS: Record<string, string> = {
    U: "FUSION.Sheet.Proficiency.Untrained",
    T: "FUSION.Sheet.Proficiency.Trained",
    E: "FUSION.Sheet.Proficiency.Expert",
    M: "FUSION.Sheet.Proficiency.Master",
    L: "FUSION.Sheet.Proficiency.Legendary",
  };

  const resolvedTitle = $derived(title ?? t(RANK_LABEL_KEYS[rank] ?? RANK_LABEL_KEYS["U"]!));
  const filled = $derived(variant === "filled");
</script>

<span
  class="prof-badge prof-badge--{rank.toLowerCase()}"
  class:prof-badge--filled={filled}
  title={resolvedTitle}
  style="width: {size}px; height: {size}px; font-size: {Math.round(size * 0.56)}px;"
>
  {rank}
</span>

<style>
  .prof-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--fusion-radius-sm);
    font-weight: 700;
    font-family: var(--fusion-font);
    flex-shrink: 0;
    box-sizing: border-box;
    color: var(--fusion-prof-u);
    background: transparent;
    border: 1px solid var(--fusion-border);
  }

  .prof-badge--t { color: var(--fusion-accent); border-color: var(--fusion-prof-t-border); }
  .prof-badge--e { color: var(--fusion-prof-e); border-color: var(--fusion-prof-e-border); }
  .prof-badge--m { color: var(--fusion-prof-m); border-color: var(--fusion-prof-m-border); }
  .prof-badge--l { color: var(--fusion-prof-l); border-color: var(--fusion-prof-l-border); }

  .prof-badge--filled {
    border-color: var(--fusion-prof-u-border);
    background: var(--fusion-prof-u-bg);
  }
  .prof-badge--filled.prof-badge--t {
    color: var(--fusion-accent-hover);
    background: var(--fusion-prof-t-bg);
    border-color: var(--fusion-prof-t-border);
  }
  .prof-badge--filled.prof-badge--e { background: var(--fusion-prof-e-bg); border-color: var(--fusion-prof-e-border); }
  .prof-badge--filled.prof-badge--m { background: var(--fusion-prof-m-bg); border-color: var(--fusion-prof-m-border); }
  .prof-badge--filled.prof-badge--l { background: var(--fusion-prof-l-bg); border-color: var(--fusion-prof-l-border); }
</style>
