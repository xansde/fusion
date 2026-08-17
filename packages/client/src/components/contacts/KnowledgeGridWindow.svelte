<script lang="ts">
  /**
   * KnowledgeGridWindow.svelte — the "Quem conhece quem" window (spec 39 §5.7).
   *
   * Opened from the Contatos tab's fixed footer, which only a privileged role
   * has (REQ-CTT-060), and drawn OUTSIDE the drawer by the window manager
   * (REQ-CTT-061) — the drawer is 280px wide and a grid of the whole table
   * would never be legible in it.
   *
   * Contacts are rows, characters are columns, and three activations move the
   * model (all of them in `lib/contacts/knowledgeGrid.ts`, none of them here):
   * the cell cycles one pair (REQ-CTT-062), the contact's name cycles the
   * general rule and aligns its row (REQ-CTT-063), the character's name cycles
   * the whole column (REQ-CTT-064).
   *
   * Two absences are the point of this file, not omissions:
   *
   *  - **It cannot create, delete or edit an actor** (REQ-CTT-066): the single
   *    op it can send is `actor:setKnowledge`, and the server refuses that path
   *    for anyone unprivileged (G060) — hiding the window was never the
   *    protection.
   *  - **The list's cards carry no knowledge control at all** (REQ-CTT-067):
   *    editing lives here and only here, so a state can never be moved from two
   *    places that disagree.
   *
   * RNF-CTT-04: the grid scrolls inside its own box with both headers pinned —
   * the row of characters stays on top, the column of contacts stays at the
   * left — so the whole table and every contact of the world stay readable.
   */

  import type { Socket } from "socket.io-client";
  import { worldMirror } from "../../lib/docs/worldSync.js";
  import { getSocket } from "../../lib/session.svelte.js";
  import { sendOp, OpError } from "../../lib/docs/sendOp.js";
  import { t } from "../../lib/i18n/i18n.js";
  import type { ContactActorDoc } from "../../lib/contacts/contactsVM.js";
  import {
    KNOWLEDGE_OP_TYPE,
    KNOWLEDGE_STATE_KEYS,
    buildKnowledgeGrid,
    cellCycleEdit,
    columnCycleEdits,
    knowledgeOpPayload,
    rowCycleEdit,
    type KnowledgeGridRow,
  } from "../../lib/contacts/knowledgeGrid.js";
  import { KNOWLEDGE_STATES, type ActorKnowledgeEdit } from "@fusion/shared";

  const { socket }: { socket: Socket } = $props();

  let actors = $state<ContactActorDoc[]>(worldMirror.getByType<ContactActorDoc>("Actor"));
  let failure = $state<string | null>(null);

  $effect(() => {
    const unsubscribe = worldMirror.subscribe<ContactActorDoc>("Actor", (docs) => {
      actors = docs;
    });
    actors = worldMirror.getByType<ContactActorDoc>("Actor");
    return unsubscribe;
  });

  const grid = $derived(buildKnowledgeGrid(actors));

  /** pt-BR name of a state — the word, so the colour is never the only channel. */
  function stateLabel(state: number): string {
    return t(KNOWLEDGE_STATE_KEYS[state as 0 | 1 | 2]);
  }

  function nameOrPlaceholder(name: string): string {
    return name.length > 0 ? name : t("FUSION.Contacts.Knowledge.Unnamed");
  }

  /**
   * Ask the server to apply a batch of edits. The window never writes the
   * document itself: it sends the one op it has and lets the refusal show
   * (REQ-CTT-080 — the control being visible is not what authorizes it).
   */
  async function send(edits: readonly ActorKnowledgeEdit[]): Promise<void> {
    if (edits.length === 0) return;
    // Lazy accessor: a captured socket goes stale across a reconnect, and this
    // window outlives one.
    const live = getSocket() ?? socket;
    try {
      await sendOp(live, { type: KNOWLEDGE_OP_TYPE, payload: knowledgeOpPayload(edits) });
      failure = null;
    } catch (err) {
      failure = err instanceof OpError ? err.message : String(err);
    }
  }

  function onCell(row: KnowledgeGridRow, characterId: string): void {
    void send([cellCycleEdit(row, characterId)]);
  }

  function onRow(row: KnowledgeGridRow): void {
    void send([rowCycleEdit(row)]);
  }

  function onColumn(characterId: string): void {
    void send(columnCycleEdits(grid, characterId));
  }
</script>

<!--
  One SVG icon per state (dot / half-filled circle / check), matching the
  prototype's dense matrix (`SYM = ["·", "◐", "✓"]` in npcs-tab.prototype.html)
  in shape, not in glyph: this window is reachable from both the Contatos
  footer and the NPCs footer (REQ-NPC-072), so DEC-ACH-04's "drawn icons,
  never emoji" — cited by spec 42 as a principle of the whole gaveta, not only
  its own tab — reaches it too. A `·`/`◐`/`✓` text character sits inside the
  Unicode ranges the repo already treats as emoji-ish (see the EMOJI regex in
  NpcsFooter.test.ts); an SVG path never does. The full word still never
  leaves the accessible name (REQ-CTT-094 — never colour alone).
-->
{#snippet stateIcon(state: number)}
  {#if state === 0}
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" focusable="false">
      <circle cx="6" cy="6" r="1.4" fill="currentColor" />
    </svg>
  {:else if state === 1}
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" focusable="false">
      <circle cx="6" cy="6" r="4.3" fill="none" stroke="currentColor" stroke-width="1.3" />
      <path d="M6 1.7A4.3 4.3 0 0 1 6 10.3Z" fill="currentColor" />
    </svg>
  {:else}
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true" focusable="false">
      <path
        d="M2.3 6.2 5 8.9 9.7 3.3"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  {/if}
{/snippet}

<div class="knowledge-grid">
  {#if failure}
    <p class="knowledge-grid__error" role="alert">
      {t("FUSION.Contacts.Knowledge.Failed", { message: failure })}
    </p>
  {/if}

  <!-- REQ-CTT-065: the legend of the three states, in words. -->
  <div class="knowledge-grid__legend" aria-label={t("FUSION.Contacts.Knowledge.Legend")}>
    {#each KNOWLEDGE_STATES as state (state)}
      <span class="knowledge-grid__legend-item" data-state={state}>
        <span class="knowledge-grid__swatch" data-state={state} aria-hidden="true">
          {@render stateIcon(state)}
        </span>
        {stateLabel(state)}
      </span>
    {/each}
    <span class="knowledge-grid__legend-item">
      <!-- REQ-CTT-062/DEC-ACH-04: the same "conhecido" check as the cells,
           underlined — the exact mark a cell that is both known and an
           exception draws, matching contacts-tab.prototype.html:1632. -->
      <span class="knowledge-grid__swatch knowledge-grid__swatch--exception" aria-hidden="true">
        {@render stateIcon(2)}
      </span>
      {t("FUSION.Contacts.Knowledge.Exception")}
    </span>
  </div>

  {#if grid.rows.length === 0}
    <p class="knowledge-grid__empty">{t("FUSION.Contacts.Knowledge.Empty")}</p>
  {:else if grid.columns.length === 0}
    <p class="knowledge-grid__empty">{t("FUSION.Contacts.Knowledge.NoCharacters")}</p>
  {:else}
    <!-- RNF-CTT-04: the grid keeps its own scroll and both headers are pinned. -->
    <div class="knowledge-grid__scroll">
      <table class="knowledge-grid__table">
        <thead>
          <tr>
            <th class="knowledge-grid__corner" scope="col"
              >{t("FUSION.Contacts.Knowledge.Contact")}</th
            >
            {#each grid.columns as column (column.id)}
              <th class="knowledge-grid__col-head" scope="col" data-character-id={column.id}>
                <!-- REQ-CTT-064: the character's name is the column's control. -->
                <button
                  class="knowledge-grid__head-btn"
                  type="button"
                  aria-label={t("FUSION.Contacts.Knowledge.CycleColumn", {
                    name: nameOrPlaceholder(column.name),
                  })}
                  onclick={() => onColumn(column.id)}
                >
                  {nameOrPlaceholder(column.name)}
                </button>
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each grid.rows as row (row.id)}
            <tr data-contact-id={row.id}>
              <th class="knowledge-grid__row-head" scope="row">
                <!-- REQ-CTT-063: the contact's name cycles the general rule. -->
                <button
                  class="knowledge-grid__head-btn"
                  type="button"
                  aria-label={t("FUSION.Contacts.Knowledge.CycleRow", {
                    name: nameOrPlaceholder(row.name),
                  })}
                  onclick={() => onRow(row)}
                >
                  <span class="knowledge-grid__contact-name">{nameOrPlaceholder(row.name)}</span>
                  <!-- REQ-CTT-065: the general rule in force, written out. -->
                  <span class="knowledge-grid__general" data-general={row.general}>
                    {t("FUSION.Contacts.Knowledge.General", { state: stateLabel(row.general) })}
                  </span>
                </button>
              </th>

              {#each row.cells as cell (cell.characterId)}
                {@const column = grid.columns.find((c) => c.id === cell.characterId)}
                <td class="knowledge-grid__cell">
                  <!-- REQ-CTT-062: one activation, one step of the cycle. The
                       compact icon (dot/half-circle/check, matching the
                       prototype's dense matrix) is what the eye reads; the
                       full state — and, for an exception, the word itself —
                       reaches assistive tech through the accessible name
                       alone (REQ-CTT-094), never written into the cell. -->
                  <button
                    class="knowledge-grid__state"
                    class:knowledge-grid__state--exception={cell.isException}
                    type="button"
                    data-state={cell.state}
                    data-exception={cell.isException}
                    aria-label={cell.isException
                      ? t("FUSION.Contacts.Knowledge.CycleCellException", {
                          character: nameOrPlaceholder(column?.name ?? ""),
                          contact: nameOrPlaceholder(row.name),
                          state: stateLabel(cell.state),
                        })
                      : t("FUSION.Contacts.Knowledge.CycleCell", {
                          character: nameOrPlaceholder(column?.name ?? ""),
                          contact: nameOrPlaceholder(row.name),
                          state: stateLabel(cell.state),
                        })}
                    onclick={() => onCell(row, cell.characterId)}
                  >
                    <span class="knowledge-grid__state-symbol" aria-hidden="true">
                      {@render stateIcon(cell.state)}
                    </span>
                  </button>
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .knowledge-grid {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    height: 100%;
    min-height: 0;
    padding: 0.4rem;
    font-family: var(--fusion-font);
    color: var(--fusion-text);
  }

  .knowledge-grid__error {
    margin: 0;
    color: var(--fusion-danger);
    font-size: 0.75rem;
  }

  .knowledge-grid__legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    flex: 0 0 auto;
    font-size: 0.68rem;
    color: var(--fusion-text-muted);
  }

  .knowledge-grid__legend-item {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }

  /* Bare, colour-only icon — no swatch box — the same treatment as the
     prototype's `.keys i` (npcs-tab.prototype.html/contacts-tab.prototype.html):
     the glyph itself carries the colour, nothing sits behind it. */
  .knowledge-grid__swatch {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.1rem;
    color: var(--fusion-text-subtle);
  }

  .knowledge-grid__swatch[data-state="1"] {
    color: var(--fusion-warning);
  }

  .knowledge-grid__swatch[data-state="2"] {
    color: var(--fusion-success);
  }

  /* REQ-CTT-062: the exception mark is the same "conhecido" check, underlined
     — never a dashed box that no cell actually draws. */
  .knowledge-grid__swatch--exception {
    border-bottom: 1.5px solid currentColor;
    padding-bottom: 1px;
  }

  /* REQ-CTT-093 (REQ-UIF-064): the window's controls are cells of a grid, where a
     lost focus ring is a lost place — the outline is on the element itself so a
     control added later cannot be born without it. */
  .knowledge-grid button:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: -2px;
  }

  .knowledge-grid__empty {
    margin: 0.6rem 0.2rem;
    font-size: 0.78rem;
    color: var(--fusion-text-muted);
  }

  /* RNF-CTT-04: own scroll, sticky head row and sticky first column. */
  .knowledge-grid__scroll {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
  }

  .knowledge-grid__table {
    border-collapse: separate;
    border-spacing: 0;
    font-size: 0.75rem;
  }

  .knowledge-grid__corner,
  .knowledge-grid__col-head,
  .knowledge-grid__row-head,
  .knowledge-grid__cell {
    border-bottom: 1px solid var(--fusion-border);
    border-right: 1px solid var(--fusion-border);
    padding: 0.15rem 0.3rem;
    text-align: left;
    vertical-align: middle;
    background: var(--fusion-surface);
  }

  .knowledge-grid__cell {
    text-align: center;
    padding: 0.1rem;
  }

  .knowledge-grid__corner,
  .knowledge-grid__col-head {
    position: sticky;
    top: 0;
    z-index: 2;
    background: var(--fusion-surface-alt);
    white-space: nowrap;
  }

  .knowledge-grid__corner,
  .knowledge-grid__row-head {
    position: sticky;
    left: 0;
    background: var(--fusion-surface-alt);
    min-width: 7rem;
    max-width: 10rem;
  }

  .knowledge-grid__corner {
    z-index: 3;
    font-size: 0.62rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--fusion-text-subtle);
  }

  .knowledge-grid__row-head {
    z-index: 1;
    font-weight: 400;
  }

  .knowledge-grid__head-btn {
    display: flex;
    flex-direction: column;
    gap: 0.05rem;
    width: 100%;
    padding: 0.15rem 0.25rem;
    background: none;
    border: none;
    border-radius: var(--fusion-radius-sm);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .knowledge-grid__head-btn:hover,
  .knowledge-grid__head-btn:focus-visible {
    background: var(--fusion-surface);
    color: var(--fusion-accent);
  }

  .knowledge-grid__contact-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .knowledge-grid__general {
    font-size: 0.62rem;
    color: var(--fusion-text-subtle);
  }

  /* Compact, one-symbol cell — the density of the prototype's matrix, not the
     word-per-cell block this replaced. */
  .knowledge-grid__state {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    padding: 0;
    margin: 0 auto;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-subtle);
    font: inherit;
    cursor: pointer;
  }

  .knowledge-grid__state-symbol {
    display: inline-flex;
    line-height: 1;
  }

  .knowledge-grid__state[data-state="1"] {
    color: var(--fusion-warning);
  }

  .knowledge-grid__state[data-state="2"] {
    color: var(--fusion-success);
  }

  /* REQ-CTT-062: an exception is told apart by an underline under its icon —
     matching contacts-tab.prototype.html's `.matrix td button.cell.ex` — never
     a box outline, which reads as a focus ring (the word still reaches
     assistive tech via aria-label). */
  .knowledge-grid__state--exception .knowledge-grid__state-symbol {
    border-bottom: 1.5px solid currentColor;
    padding-bottom: 1px;
  }

  .knowledge-grid__state:hover,
  .knowledge-grid__state:focus-visible {
    background: var(--fusion-surface-alt);
  }
</style>
