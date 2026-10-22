<script lang="ts">
  /**
   * CompendiumResultLine.svelte — one line of the Compendium tab (spec 43 §5.5).
   *
   * The same line serves both bodies: the aggregated result over the whole
   * collection and the index of an open pack. It is presentational — the view
   * model is built by `lib/compendium/resultLine.ts` and every gesture is handed
   * back to the panel.
   *
   * Two names (REQ-CPD-040): the translated one in front, the original
   * underneath when they differ, because the table says "Bola de Fogo" and the
   * book says "Fireball". The fields come from what the PACK declared
   * (REQ-CPD-041) and travel in the index — no document is loaded to draw a line
   * (DEC-CMP-02). The run that matched the search is marked as segments
   * (REQ-CPD-042), never as injected HTML.
   *
   * The **in-world seal** (REQ-CPD-043) says a document of the world came from
   * this entry, and nothing else: bringing an entry over clones it with a fresh
   * identity that does not follow the pack (DEC-CPD-12), which is what the seal's
   * tooltip says out loud. It never disables the import (REQ-CPD-064).
   *
   * The picture box is always the same box (REQ-CPD-045): a broken or
   * placeholder image resolves to a DRAWN type icon of the same size, so a
   * failed request cannot leave a hole nor shift the column of names. The icons
   * come from the shared set, never pictographs — an emoji changes shape per operating
   * system and ignores the theme.
   *
   * The bring action names its own destination (`importDestination`): the world
   * (REQ-CPD-060) or the sheet in force (REQ-CPD-061). A player has no world
   * door, so a fixed "into the world" label would be an action the tab is not
   * allowed to offer him at all (CA-CPD-009).
   *
   * Nothing here decides who may see what: the fields already arrive filtered
   * for the reader's role (REQ-CPD-046) and the pack audience is enforced on the
   * server (REQ-CPD-074).
   */

  import type { ResultLine, ResultLineIcon } from "../../lib/compendium/resultLine.js";
  import { resolveFieldLabel } from "../../lib/compendium/resultLine.js";
  import { t } from "../../lib/i18n/i18n.js";
  import type { IconName } from "@fusion/shared";
  import Icon from "../common/Icon.svelte";
  import CostGlyphs from "../common/CostGlyphs.svelte";

  interface Props {
    /** The line, already built for this reader (`buildResultLine`). */
    line: ResultLine;
    /** Open the preview window (REQ-CPD-050) — G094 owns where it lands. */
    onPreview?: (() => void) | undefined;
    /** Bring it over; absent when this reader has no destination (REQ-CPD-060). */
    onImport?: (() => void) | undefined;
    /**
     * Where that gesture lands (REQ-CPD-060 × REQ-CPD-061): the world, or the
     * sheet the panel is pointing at. The line does not choose the destination
     * — it only tells the truth about the one in force, so a player, who has no
     * world door at all, never reads "trazer para o mundo" over an action that
     * writes on a sheet (CA-CPD-009). Required on purpose: a default here would
     * be a label that lies every time a caller forgets to pass it.
     */
    importDestination: "world" | "sheet";
    /** True while this line's import is in flight. */
    importing?: boolean | undefined;
    /** Start of a drag; only ever called on a line with a destination. */
    onDragStart?: ((event: DragEvent) => void) | undefined;
    /** The `<img>` failed — the panel remembers, and the icon takes over. */
    onImageError?: (() => void) | undefined;
    /**
     * Pin or unpin this entry (REQ-CPD-082). Absent means the panel offers no
     * pinning here — the line never invents the gesture, and the pinned list
     * itself belongs to `lib/compendium/compendiumPrefs.ts`.
     */
    onTogglePin?: (() => void) | undefined;
    /** Whether this entry is currently pinned; drawn as `aria-pressed`. */
    pinned?: boolean | undefined;
  }

  const {
    line,
    onPreview,
    onImport,
    importDestination,
    importing = false,
    onDragStart,
    onImageError,
    onTogglePin,
    pinned = false,
  }: Props = $props();

  /**
   * The two labels of the bring action, chosen by the destination in force —
   * the same pair the preview window uses, which is what keeps line and window
   * saying the same thing (REQ-CPD-053).
   */
  const importLabelKey = $derived(
    importDestination === "world"
      ? "FUSION.Compendium.Line.Import"
      : "FUSION.Compendium.Line.ImportToSheet",
  );
  const importTitleKey = $derived(
    importDestination === "world"
      ? "FUSION.Compendium.Line.ImportShort"
      : "FUSION.Compendium.Line.ImportToSheetShort",
  );

  /** The drawn glyph per kind, from the shared icon set. */
  const ICON_NAMES: Record<ResultLineIcon, IconName> = {
    actor: "user",
    item: "package",
    journal: "book-open",
    table: "dices",
    macro: "scroll",
    scene: "map",
    playlist: "list-music",
    unknown: "circle-question-mark",
  };

  /** A value that carries action-cost marks (◆ ◇ ⟳) is drawn with Fusion's own marks. */
  function hasCostGlyph(text: string): boolean {
    return /[◆◇⟳↺]/u.test(text);
  }
</script>

<li
  class="result-line"
  class:result-line--draggable={line.draggable}
  draggable={line.draggable ? "true" : "false"}
  ondragstart={(event) => onDragStart?.(event)}
>
  <!--
    One fixed box, whatever fills it (REQ-CPD-045): the image and the drawn icon
    share the same size rule, so a broken request never collapses the column.
  -->
  <span class="result-line__figure">
    {#if line.imageSrc !== null}
      <img
        class="result-line__img"
        src={line.imageSrc}
        alt=""
        aria-hidden="true"
        loading="lazy"
        onerror={() => onImageError?.()}
      />
    {:else}
      <span class="result-line__icon" aria-hidden="true"><Icon name={ICON_NAMES[line.icon]} size={20} /></span>
    {/if}
  </span>

  <div class="result-line__info">
    <span class="result-line__name" title={line.nameText}>
      {#each line.name as segment, i (i)}
        {#if segment.matched}<mark class="result-line__match">{segment.text}</mark>{:else if hasCostGlyph(segment.text)}<CostGlyphs glyphs={segment.text} size={14} />{:else}{segment.text}{/if}
      {/each}
    </span>

    {#if line.secondaryName !== null && line.secondaryNameText !== null}
      <!-- The original name, kept so the reader can check the source (DEC-CPD-06). -->
      <span class="result-line__name-original" title={line.secondaryNameText}>
        {#each line.secondaryName as segment, i (i)}
          {#if segment.matched}<mark class="result-line__match">{segment.text}</mark>{:else if hasCostGlyph(segment.text)}<CostGlyphs glyphs={segment.text} size={14} />{:else}{segment.text}{/if}
        {/each}
      </span>
    {/if}

    <span class="result-line__meta">
      {#if line.packLabel !== null}
        <span class="result-line__source">{line.packLabel}</span>
      {/if}
      {#if line.subtype !== null}
        <span class="result-line__subtype">{line.subtype}</span>
      {/if}
      {#each line.fields as field (field.key)}
        <span class="result-line__field">
          <span class="result-line__field-label">{resolveFieldLabel(field, t)}</span>
          <span class="result-line__field-value" title={field.value}>
            {#each field.segments as segment, i (i)}
              {#if segment.matched}<mark class="result-line__match">{segment.text}</mark>{:else if hasCostGlyph(segment.text)}<CostGlyphs glyphs={segment.text} size={14} />{:else}{segment.text}{/if}
            {/each}
          </span>
        </span>
      {/each}
      {#if line.inWorld}
        <!-- Informs, never blocks, and promises no sameness (DEC-CPD-12). -->
        <span class="result-line__seal" title={t("FUSION.Compendium.Line.InWorldHint")}>
          {t("FUSION.Compendium.Line.InWorld")}
        </span>
      {/if}
    </span>
  </div>

  <div class="result-line__actions">
    {#if onTogglePin}
      <!--
        REQ-CPD-082: pinning is a two-state button, not two buttons — the state
        travels in `aria-pressed` so it is never told by colour alone
        (REQ-CPD-094), and the label says which way it goes.
      -->
      <button
        class="result-line__action"
        class:result-line__action--on={pinned}
        type="button"
        onclick={() => onTogglePin()}
        aria-pressed={pinned}
        aria-label={t(pinned ? "FUSION.Compendium.Line.Unpin" : "FUSION.Compendium.Line.Pin", {
          name: line.nameText,
        })}
        title={t(pinned ? "FUSION.Compendium.Line.Unpin" : "FUSION.Compendium.Line.Pin", {
          name: line.nameText,
        })}
      >
        <Icon name={pinned ? "pin-off" : "pin"} size={18} />
      </button>
    {/if}
    {#if onPreview}
      <button
        class="result-line__action"
        type="button"
        onclick={() => onPreview()}
        aria-label={t("FUSION.Compendium.Line.Preview", { name: line.nameText })}
        title={t("FUSION.Compendium.Line.PreviewShort")}
      >
        <Icon name="eye" size={18} />
      </button>
    {/if}
    {#if onImport}
      <button
        class="result-line__action"
        type="button"
        onclick={() => onImport()}
        disabled={importing}
        aria-label={t(importLabelKey, { name: line.nameText })}
        title={t(importTitleKey)}
      >
        <Icon name="download" size={18} />
      </button>
    {/if}
  </div>
</li>

<style>
  /*
   * Flat row split by a divider (no card in card). The name shows whole: two
   * lines at most, and the full text is in its title.
   */
  .result-line {
    display: flex;
    align-items: flex-start;
    gap: var(--fusion-space-2);
    padding: var(--fusion-space-2) var(--fusion-space-1);
    border-radius: var(--fusion-radius-sm);
  }

  .result-line:hover,
  .result-line:focus-within {
    background: var(--fusion-surface-alt);
  }

  .result-line--draggable {
    cursor: grab;
  }
  .result-line--draggable:active {
    cursor: grabbing;
  }

  /*
   * REQ-CPD-045: the picture box has ONE size, and both fillings obey it. The
   * fallback is drawn inside the same box, so an image that never arrives costs
   * the row nothing in height nor in alignment.
   */
  .result-line__figure {
    width: 2rem;
    height: 2rem;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--fusion-surface-alt);
    border-radius: var(--fusion-radius-sm);
    overflow: hidden;
  }

  .result-line__img {
    width: 2rem;
    height: 2rem;
    object-fit: cover;
  }

  .result-line__icon {
    display: inline-flex;
    color: var(--fusion-text-muted);
  }

  .result-line__info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-top: 2px;
  }

  .result-line__name {
    font-size: var(--fusion-text-base);
    font-weight: 500;
    color: var(--fusion-text);
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .result-line__name-original {
    font-size: var(--fusion-text-xs);
    color: var(--fusion-text-muted);
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 1;
    line-clamp: 1;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .result-line__meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--fusion-space-1) var(--fusion-space-2);
    font-size: var(--fusion-text-xs);
    color: var(--fusion-text-muted);
  }

  .result-line__field-label::after {
    content: " ";
  }

  .result-line__field-value {
    display: inline-flex;
    align-items: center;
    color: var(--fusion-text);
  }

  .result-line__seal {
    padding: 0 var(--fusion-space-2);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-success-dim);
    color: var(--fusion-text);
  }

  .result-line__actions {
    display: flex;
    flex-shrink: 0;
  }

  .result-line__action {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: var(--fusion-target);
    min-height: var(--fusion-target);
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    cursor: pointer;
    transition:
      background var(--fusion-transition),
      color var(--fusion-transition);
  }

  .result-line__action:hover {
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
  }

  .result-line__action:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /*
   * Pinned: colour AND a different glyph (pin-off) AND `aria-pressed` — three
   * channels for one state, so the state is never told by colour alone (REQ-CPD-094).
   */
  .result-line__action--on {
    color: var(--fusion-accent);
  }

  .result-line__match {
    background: var(--fusion-accent);
    color: var(--fusion-on-accent);
    border-radius: var(--fusion-radius-sm);
    padding: 0 1px;
  }
</style>
