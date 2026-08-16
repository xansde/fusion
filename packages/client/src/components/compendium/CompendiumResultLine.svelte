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
   * are inline SVG, never pictographs — an emoji changes shape per operating
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

  /**
   * Path data per icon, drawn on a 24×24 grid. Simple silhouettes on purpose:
   * at 1.8rem the line is a glyph, not an illustration.
   */
  const ICON_PATHS: Record<ResultLineIcon, string> = {
    actor: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0",
    item: "M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 0v20M3 7l9 5 9-5",
    journal: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Zm3 0v16M11 8h5M11 12h5",
    table: "M4 5h16v14H4V5Zm0 5h16M4 15h16M9.5 5v14M14.5 5v14",
    macro: "m8 7-5 5 5 5M16 7l5 5-5 5M13 4l-2 16",
    scene: "m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2V6Zm6-2v14m6-12v14",
    playlist: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
    unknown: "M12 17h.01M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7",
  };
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
      <svg
        class="result-line__icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d={ICON_PATHS[line.icon]} />
      </svg>
    {/if}
  </span>

  <div class="result-line__info">
    <span class="result-line__name" title={line.nameText}>
      {#each line.name as segment, i (i)}
        {#if segment.matched}<mark class="result-line__match">{segment.text}</mark>{:else}{segment.text}{/if}
      {/each}
    </span>

    {#if line.secondaryName !== null && line.secondaryNameText !== null}
      <!-- The original name, kept so the reader can check the source (DEC-CPD-06). -->
      <span class="result-line__name-original" title={line.secondaryNameText}>
        {#each line.secondaryName as segment, i (i)}
          {#if segment.matched}<mark class="result-line__match">{segment.text}</mark>{:else}{segment.text}{/if}
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
          <span class="result-line__field-value">
            {#each field.segments as segment, i (i)}
              {#if segment.matched}<mark class="result-line__match">{segment.text}</mark>{:else}{segment.text}{/if}
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
        <svg
          viewBox="0 0 24 24"
          fill={pinned ? "currentColor" : "none"}
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M9 3h6l-1 6 4 4H6l4-4-1-6Zm3 10v8" />
        </svg>
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
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
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
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M12 4v11m0 0-4-4m4 4 4-4M4 19h16" />
        </svg>
      </button>
    {/if}
  </div>
</li>

<style>
  .result-line {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.4rem;
    background: var(--fusion-surface-alt, #2a2a2a);
    border: 1px solid var(--fusion-border, #444);
    border-radius: var(--fusion-radius-sm, 4px);
  }

  .result-line--draggable {
    cursor: grab;
  }
  .result-line--draggable:active {
    cursor: grabbing;
  }

  .result-line:hover {
    background: var(--fusion-border, #444);
  }

  /*
   * REQ-CPD-045: the picture box has ONE size, and both fillings obey it. The
   * fallback is drawn inside the same box, so an image that never arrives costs
   * the row nothing in height nor in alignment.
   */
  .result-line__figure {
    width: 1.8rem;
    height: 1.8rem;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--fusion-surface, #222);
    border-radius: 3px;
    overflow: hidden;
  }

  .result-line__img,
  .result-line__icon {
    width: 1.8rem;
    height: 1.8rem;
  }

  .result-line__img {
    object-fit: cover;
  }

  .result-line__icon {
    padding: 0.22rem;
    box-sizing: border-box;
    color: var(--fusion-text-muted, #888);
  }

  .result-line__info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .result-line__name {
    font-size: 0.82rem;
    color: var(--fusion-text, #eee);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .result-line__name-original {
    font-size: 0.68rem;
    font-style: italic;
    color: var(--fusion-text-muted, #888);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .result-line__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.1rem 0.4rem;
    font-size: 0.7rem;
    color: var(--fusion-text-muted, #888);
  }

  .result-line__field-label::after {
    content: " ";
  }

  .result-line__field-label {
    opacity: 0.75;
  }

  .result-line__seal {
    color: var(--fusion-success, #27ae60);
    border: 1px solid currentcolor;
    border-radius: 9999px;
    padding: 0 0.3rem;
    font-size: 0.65rem;
  }

  .result-line__actions {
    display: flex;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .result-line__action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.4rem;
    height: 1.4rem;
    padding: 0;
    background: none;
    border: 1px solid var(--fusion-border, #444);
    border-radius: var(--fusion-radius-sm, 4px);
    color: var(--fusion-text-muted, #888);
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .result-line__action svg {
    width: 0.9rem;
    height: 0.9rem;
  }

  .result-line__action:hover {
    background: var(--fusion-surface, #222);
    color: var(--fusion-text, #eee);
  }

  .result-line__action:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /*
   * Pinned: colour AND a filled glyph AND `aria-pressed` — three channels for
   * one state, so the state is never told by colour alone (REQ-CPD-094).
   */
  .result-line__action--on {
    color: var(--fusion-accent, #c0a060);
    border-color: var(--fusion-accent, #c0a060);
  }

  .result-line__match {
    background: var(--fusion-accent, #c0a060);
    color: var(--fusion-surface, #222);
    border-radius: 2px;
    padding: 0 1px;
  }
</style>
