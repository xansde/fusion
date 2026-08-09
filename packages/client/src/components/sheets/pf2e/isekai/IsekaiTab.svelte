<script lang="ts">
  /**
   * IsekaiTab.svelte — the sheet's Isekai tab.
   *
   * Three sections, in the order a player needs them mid-turn: the Focus pool
   * (what can I spend), the action list (what can I spend it on), and the
   * per-archetype trackers (what am I holding). The archetypes themselves are
   * PICKED in the Plan column, next to the variant toggle — configuration
   * lives with configuration, play lives here.
   *
   * The tab only renders when the variant is on (CharacterSheet gates it), so
   * the only empty state it handles is "on, but nothing picked yet".
   */

  import type { DocUpdatePayload } from "../../../../lib/sheets/pf2e/characterSheetVM.js";
  import { setIsekaiTracker, type PlanOpBuilderContext } from "../../../../lib/sheets/pf2e/planVM.js";
  import { buildIsekaiTabModel } from "../../../../lib/sheets/pf2e/isekai/tabVM.js";
  import { t } from "../../../../lib/i18n/i18n.js";
  import IsekaiFocusPanel from "./IsekaiFocusPanel.svelte";
  import IsekaiActionList from "./IsekaiActionList.svelte";
  import TrackerFrame from "./trackers/TrackerFrame.svelte";
  import DicePoolTracker from "./trackers/DicePoolTracker.svelte";
  import RosterTracker from "./trackers/RosterTracker.svelte";
  import CatalogTracker from "./trackers/CatalogTracker.svelte";
  import StockTracker from "./trackers/StockTracker.svelte";
  import StageTracker from "./trackers/StageTracker.svelte";
  import SignatureTracker from "./trackers/SignatureTracker.svelte";
  import UsesTracker from "./trackers/UsesTracker.svelte";

  interface Props {
    doc: Record<string, unknown>;
    actorId: string;
    /** Archetype ids on the sheet — read once by the caller (planVM). */
    archetypeIds: string[];
    editable: boolean;
    /** Emit a doc:update op. */
    sendOpFn: (op: DocUpdatePayload) => void;
    /** Set the Focus pool's spendable value. */
    onSetFocus: (value: number) => void;
  }

  let { doc, actorId, archetypeIds, editable, sendOpFn, onSetFocus }: Props = $props();

  const model = $derived(buildIsekaiTabModel(doc, archetypeIds));

  const opCtx = $derived<PlanOpBuilderContext>({ actorId, doc, editable });

  /** Persist one tracker's state; the op builder refuses anything unexpected. */
  function writeTracker(archetypeId: string, trackerId: string, state: unknown): void {
    const op = setIsekaiTracker(opCtx, archetypeId, trackerId, state);
    if (op) sendOpFn(op);
  }

  /**
   * Title for a tracker kind this build does not know how to draw.
   *
   * Takes `unknown` because the exhaustive `{#if}` chain below narrows `def`
   * to `never` in its final branch — the branch exists for RUNTIME (a document
   * written by a newer client carrying an eighth tracker kind), which the type
   * system correctly says cannot happen today.
   */
  function unknownTrackerTitle(def: unknown): string {
    const title = (def as { title?: unknown } | null)?.title;
    return typeof title === "string" ? title : t("FUSION.Sheet.Isekai.Tracker.UnknownKind");
  }
</script>

<div class="isekai-tab">
  {#if model.archetypes.length === 0}
    <p class="isekai-tab__empty">{t("FUSION.Sheet.Isekai.NoArchetypes")}</p>
  {:else}
    <div class="isekai-tab__chips">
      {#each model.archetypes as arq (arq.id)}
        <span class="isekai-tab__chip" style={`--accent: ${arq.color}`}>
          {arq.name}
          <span class="isekai-tab__tagline">“{arq.tagline}”</span>
        </span>
      {/each}
    </div>

    <IsekaiFocusPanel focus={model.focus} {editable} onSet={onSetFocus} />

    <IsekaiActionList actions={model.actions} focusAvailable={model.focus.value} />

    {#if model.trackers.length > 0}
      <div class="isekai-tab__trackers">
        {#each model.trackers as tracker (`${tracker.archetype.id}:${tracker.def.id}`)}
          {@const write = (next: unknown) => {
            writeTracker(tracker.archetype.id, tracker.def.id, next);
          }}
          {#if tracker.def.kind === "dice-pool"}
            <DicePoolTracker
              archetype={tracker.archetype}
              def={tracker.def}
              level={model.level}
              trackerState={tracker.state}
              {editable}
              onChange={write}
            />
          {:else if tracker.def.kind === "roster"}
            <RosterTracker
              archetype={tracker.archetype}
              def={tracker.def}
              level={model.level}
              trackerState={tracker.state}
              {editable}
              onChange={write}
            />
          {:else if tracker.def.kind === "catalog"}
            <CatalogTracker
              archetype={tracker.archetype}
              def={tracker.def}
              level={model.level}
              trackerState={tracker.state}
              {editable}
              onChange={write}
            />
          {:else if tracker.def.kind === "stock"}
            <StockTracker
              archetype={tracker.archetype}
              def={tracker.def}
              trackerState={tracker.state}
              {editable}
              onChange={write}
            />
          {:else if tracker.def.kind === "stage"}
            <StageTracker
              archetype={tracker.archetype}
              def={tracker.def}
              trackerState={tracker.state}
              {editable}
              onChange={write}
            />
          {:else if tracker.def.kind === "list"}
            <SignatureTracker
              archetype={tracker.archetype}
              def={tracker.def}
              level={model.level}
              trackerState={tracker.state}
              {editable}
              onChange={write}
            />
          {:else if tracker.def.kind === "uses"}
            <UsesTracker
              archetype={tracker.archetype}
              def={tracker.def}
              level={model.level}
              trackerState={tracker.state}
              {editable}
              onChange={write}
            />
          {:else}
            <!--
              An unknown tracker kind means the document was written by a newer
              client. Say so, rather than rendering nothing and letting the
              player think their Séquito was wiped.
            -->
            <TrackerFrame
              title={unknownTrackerTitle(tracker.def)}
              accent={tracker.archetype.color}
            >
              <span class="isekai-tab__unknown">{t("FUSION.Sheet.Isekai.Tracker.UnknownKind")}</span>
            </TrackerFrame>
          {/if}
        {/each}
      </div>
    {/if}

    <section class="isekai-tab__recharge">
      <h3 class="isekai-tab__section">{t("FUSION.Sheet.Isekai.Recharge.Title")}</h3>
      {#each model.archetypes as arq (arq.id)}
        {#each arq.panels as panel, i (`${arq.id}:${String(i)}`)}
          <div class="panel" style={`--accent: ${arq.color}`}>
            <div class="panel__title">{panel.title}</div>
            {#if panel.subtitle}<div class="panel__sub">{panel.subtitle}</div>{/if}
            {#each panel.paragraphs as paragraph, p (p)}
              <!--
                Authored rules text shipped in the bundle, with inline <b>
                emphasis — same treatment the compendium panel gives pack
                descriptions. Never user input, never fetched from a peer.
              -->
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <p class="panel__p">{@html paragraph}</p>
            {/each}
          </div>
        {/each}
      {/each}
    </section>
  {/if}
</div>

<style>
  .isekai-tab {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 4px 0 16px;
  }

  .isekai-tab__empty {
    margin: 0;
    font-size: 12px;
    font-style: italic;
    color: var(--fusion-text-subtle);
  }

  .isekai-tab__chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .isekai-tab__chip {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--accent);
    border-radius: var(--fusion-radius-pill);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    font-size: 11px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 0.02em;
  }

  .isekai-tab__tagline {
    font-size: 10px;
    font-weight: 400;
    font-style: italic;
    color: var(--fusion-text-muted);
  }

  .isekai-tab__trackers {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 10px;
    align-items: start;
  }

  .isekai-tab__unknown {
    font-size: 10.5px;
    font-style: italic;
    color: var(--fusion-text-subtle);
  }

  .isekai-tab__section {
    margin: 0 0 6px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fusion-text-muted);
  }

  .isekai-tab__recharge {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .panel {
    padding: 8px 11px;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-left: 3px solid var(--accent);
    border-radius: var(--fusion-radius);
  }

  .panel__title {
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--accent);
  }

  .panel__sub {
    font-size: 9.5px;
    color: var(--fusion-text-subtle);
    margin-bottom: 3px;
  }

  .panel__p {
    margin: 3px 0 0;
    font-size: 11px;
    line-height: 1.45;
    color: var(--fusion-text-muted);
  }

  .panel__p :global(b) {
    color: var(--fusion-text);
  }
</style>
