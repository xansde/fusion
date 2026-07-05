<script lang="ts">
  /**
   * PlanOptionalBadge.svelte — small amber "optional-rule active" badge,
   * dropped next to a Slot's name when the slot exists only because a
   * variant rule (e.g. Free Archetype) is toggled on.
   *
   * Ports the design contract's `OptionalBadge`
   * (.fusion-build/r10-design/claude-design/components/plan/LevelCard.jsx).
   */

  import { t } from "../../../../lib/i18n/i18n.js";
</script>

<span class="plan-optional-badge">{t("FUSION.Sheet.Plan.OptionalRuleActive")}</span>

<style>
  .plan-optional-badge {
    display: inline-block;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--fusion-warning);
    background: var(--fusion-warning-dim);
    border: 1px solid var(--fusion-prof-m-border);
    padding: 1px 6px;
    border-radius: var(--fusion-radius-sm);
    margin-left: 6px;
    vertical-align: middle;
  }
</style>
