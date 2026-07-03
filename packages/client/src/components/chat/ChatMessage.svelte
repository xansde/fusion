<script lang="ts">
  /**
   * ChatMessage.svelte — renders a single chat message row.
   *
   * Handles all five message types: text, roll, emote, whisper, system.
   * Roll type: shows total prominently, expandable term breakdown,
   *   crit/fumble coloring on d20 single-die rolls.
   * System type with CardData: renders a declarative chat card.
   *
   * REQ-CHT-007..015: message types and their visual treatment.
   * REQ-CHT-024..028: chat cards, buttons, no arbitrary HTML.
   */

  import type { Socket } from "socket.io-client";
  import type { ChatMessage as ChatMessageType } from "@fusion/shared";
  import { ConjuracaoCardSchema } from "@fusion/system-etmos";
  import {
    getMessageDisplayMeta,
    formatRoll,
    getRollTotalClass,
    type FormattedRoll,
  } from "../../lib/chat/messageFormatter.js";
  import ChatCard from "./ChatCard.svelte";
  import ConjuracaoCard from "./etmos/ConjuracaoCard.svelte";

  const {
    message,
    socket,
    isGm = false,
    userId = "",
  }: {
    message: ChatMessageType;
    /** Optional — only required to render system cards with actionable buttons (e.g. Etmos ConjuracaoCard). */
    socket?: Socket;
    isGm?: boolean;
    userId?: string;
  } = $props();

  const meta = $derived(getMessageDisplayMeta(message));

  // Etmos Compositor de Magias card — flags.etmos.conjuracao (design doc
  // m5-etmos-compositor.md §3.1/§3.4). NOT a `message.card` (CardData) —
  // buildCardMessage (conjuracao-handlers.ts) stores the state machine
  // payload directly under flags, so this is detected separately from the
  // generic declarative ChatCard path. Validated (not just cast) with the
  // SAME Zod schema the server uses (readCard's ConjuracaoCardSchema) —
  // a malformed/foreign flag silently falls through to the text renderer
  // instead of crashing the chat log.
  const conjuracaoCard = $derived.by(() => {
    const raw = (message.flags as Record<string, Record<string, unknown>> | undefined)?.["etmos"]?.[
      "conjuracao"
    ];
    if (raw === undefined) return null;
    const result = ConjuracaoCardSchema.safeParse(raw);
    return result.success ? result.data : null;
  });

  // Formatted rolls for the roll type
  const formattedRolls = $derived<FormattedRoll[]>(
    message.rolls ? message.rolls.map(formatRoll) : [],
  );

  // Expanded state per roll index
  let expandedRolls = $state<boolean[]>([]);

  function toggleRollExpanded(idx: number): void {
    expandedRolls[idx] = !expandedRolls[idx];
  }
</script>

<div class="msg {meta.typeClass}" role="listitem">
  <!-- ---- Header ---- -->
  <div class="msg__header">
    <span class="msg__time" title={new Date(message.timestamp).toLocaleString()}>{meta.timeStr}</span>
    <span class="msg__alias">{meta.alias}</span>
    {#if meta.isWhisper}
      <span class="msg__badge msg__badge--whisper"
        title="Whisper to {message.whisper.join(', ')}">whisper</span>
    {/if}
    {#if meta.isBlind}
      <span class="msg__badge msg__badge--blind">blind</span>
    {/if}
  </div>

  <!-- ---- Body ---- -->
  {#if message.type === "emote"}
    <p class="msg__content msg__content--emote">
      <em>{meta.alias} {message.content}</em>
    </p>
  {:else if message.type === "roll"}
    <!-- Roll message: content + roll cards -->
    {#if message.content}
      <p class="msg__content">{message.content}</p>
    {/if}
    {#each formattedRolls as roll, idx (roll.rollId)}
      {@const totalClass = getRollTotalClass(roll)}
      <div class="roll-card">
        <!-- Roll header -->
        <div class="roll-card__header">
          <span class="roll-card__formula" title={roll.expandedFormula}>
            {roll.formula}
          </span>
          {#if roll.flavor}
            <span class="roll-card__flavor">{roll.flavor}</span>
          {/if}
          {#if roll.rollMode !== "public"}
            <span class="roll-card__mode">{roll.rollMode}</span>
          {/if}
          <button
            class="roll-card__expand-btn"
            onclick={() => toggleRollExpanded(idx)}
            aria-expanded={expandedRolls[idx] ?? false}
            aria-label="Toggle roll breakdown"
          >
            {expandedRolls[idx] ? "▲" : "▼"}
          </button>
        </div>

        <!-- Total -->
        <div class="roll-card__total roll-card__total--{totalClass || 'normal'}">
          {roll.total}
        </div>

        <!-- Degree of success -->
        {#if roll.degreeOfSuccess}
          <div class="roll-card__dos">{roll.degreeOfSuccess}</div>
        {/if}

        <!-- Warnings -->
        {#each roll.warnings as warning}
          <p class="roll-card__warning">{warning}</p>
        {/each}

        <!-- Expandable breakdown -->
        {#if expandedRolls[idx]}
          <div class="roll-card__breakdown" role="table" aria-label="Roll breakdown">
            {#each roll.terms as term}
              {#if term.type !== "operator"}
                <div class="roll-term">
                  <span class="roll-term__expr">{term.expression}</span>
                  {#if term.dice}
                    <span class="roll-term__dice">
                      {#each term.dice as die}
                        <span
                          class="die
                            {die.isCrit ? 'die--crit' : ''}
                            {die.isFumble ? 'die--fumble' : ''}
                            {die.discarded ? 'die--discarded' : ''}
                            {die.exploded ? 'die--exploded' : ''}
                            {die.isSuccess ? 'die--success' : ''}
                            {die.isFailure ? 'die--failure' : ''}"
                          title="{die.discarded ? 'discarded' : ''}{die.exploded ? ' exploded' : ''}"
                        >
                          {die.value}
                        </span>
                      {/each}
                    </span>
                  {:else}
                    <span class="roll-term__value">{term.total}</span>
                  {/if}
                  {#if term.flavor}
                    <span class="roll-term__flavor">{term.flavor}</span>
                  {/if}
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  {:else if message.type === "system" && conjuracaoCard}
    <!-- Etmos Compositor de Magias card (flags.etmos.conjuracao) -->
    <ConjuracaoCard card={conjuracaoCard} messageId={message._id} {socket} {isGm} {userId} />
  {:else if message.type === "system" && message.card}
    <!-- Chat card (declarative, no innerHTML) -->
    <ChatCard card={message.card} messageId={message._id} />
  {:else}
    <!-- text / whisper / system (no card) -->
    <p class="msg__content">{message.content}</p>
  {/if}
</div>

<style>
  .msg {
    padding: 0.35rem 0.75rem;
    border-bottom: 1px solid transparent;
    transition: background-color var(--fusion-transition);
  }

  .msg:hover {
    background: var(--fusion-surface-alt);
  }

  /* ---- Type variants ---- */
  .msg--emote {
    color: var(--fusion-text-muted);
  }

  .msg--whisper {
    background: rgba(124, 92, 252, 0.07);
    border-left: 2px solid var(--fusion-accent-dim);
  }

  .msg--system {
    color: var(--fusion-text-muted);
    font-size: 0.8125rem;
  }

  /* ---- Header ---- */
  .msg__header {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    margin-bottom: 0.15rem;
  }

  .msg__time {
    color: var(--fusion-text-subtle);
    font-size: 0.7rem;
    font-family: var(--fusion-font-mono);
    flex-shrink: 0;
  }

  .msg__alias {
    font-weight: 600;
    font-size: 0.8125rem;
    color: var(--fusion-text);
  }

  .msg__badge {
    font-size: 0.65rem;
    border-radius: var(--fusion-radius-sm);
    padding: 0 0.35rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .msg__badge--whisper {
    background: var(--fusion-accent-dim);
    color: var(--fusion-accent);
  }

  .msg__badge--blind {
    background: rgba(255, 200, 87, 0.15);
    color: var(--fusion-warning);
  }

  /* ---- Content ---- */
  .msg__content {
    font-size: 0.875rem;
    color: var(--fusion-text);
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  }

  .msg__content--emote {
    color: var(--fusion-text-muted);
  }

  /* ---- Roll card ---- */
  .roll-card {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    margin-top: 0.35rem;
    overflow: hidden;
    max-width: 320px;
  }

  .roll-card__header {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.6rem;
    background: rgba(255,255,255,0.03);
    border-bottom: 1px solid var(--fusion-border);
    font-size: 0.75rem;
    color: var(--fusion-text-muted);
  }

  .roll-card__formula {
    font-family: var(--fusion-font-mono);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .roll-card__flavor {
    color: var(--fusion-accent);
    font-style: italic;
  }

  .roll-card__mode {
    background: var(--fusion-accent-dim);
    color: var(--fusion-accent);
    border-radius: 3px;
    padding: 0 0.25rem;
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .roll-card__expand-btn {
    background: none;
    border: none;
    color: var(--fusion-text-subtle);
    cursor: pointer;
    font-size: 0.65rem;
    padding: 0;
    line-height: 1;
    flex-shrink: 0;
  }

  .roll-card__expand-btn:hover {
    color: var(--fusion-text);
  }

  .roll-card__total {
    text-align: center;
    font-size: 2.5rem;
    font-weight: 700;
    line-height: 1;
    padding: 0.75rem 0;
    color: var(--fusion-text);
  }

  .roll-card__total--crit {
    color: var(--fusion-success);
    text-shadow: 0 0 16px rgba(61, 220, 132, 0.45);
  }

  .roll-card__total--fumble {
    color: var(--fusion-danger);
    text-shadow: 0 0 16px rgba(255, 92, 92, 0.45);
  }

  .roll-card__dos {
    text-align: center;
    font-size: 0.75rem;
    color: var(--fusion-accent);
    padding: 0 0.6rem 0.4rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .roll-card__warning {
    font-size: 0.7rem;
    color: var(--fusion-warning);
    padding: 0 0.6rem 0.3rem;
    margin: 0;
  }

  /* ---- Breakdown ---- */
  .roll-card__breakdown {
    padding: 0.4rem 0.6rem;
    border-top: 1px solid var(--fusion-border);
  }

  .roll-term {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-bottom: 0.25rem;
    font-size: 0.75rem;
  }

  .roll-term__expr {
    font-family: var(--fusion-font-mono);
    color: var(--fusion-text-muted);
    min-width: 3rem;
  }

  .roll-term__dice {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem;
  }

  .roll-term__value {
    font-family: var(--fusion-font-mono);
    color: var(--fusion-text);
  }

  .roll-term__flavor {
    color: var(--fusion-accent);
    font-style: italic;
    font-size: 0.7rem;
  }

  /* ---- Individual dice ---- */
  .die {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 4px;
    border: 1px solid var(--fusion-border);
    background: var(--fusion-surface);
    font-size: 0.75rem;
    font-family: var(--fusion-font-mono);
    font-weight: 600;
    color: var(--fusion-text);
  }

  .die--crit {
    border-color: var(--fusion-success);
    background: rgba(61, 220, 132, 0.1);
    color: var(--fusion-success);
  }

  .die--fumble {
    border-color: var(--fusion-danger);
    background: rgba(255, 92, 92, 0.1);
    color: var(--fusion-danger);
  }

  .die--discarded {
    opacity: 0.35;
    text-decoration: line-through;
  }

  .die--exploded {
    border-color: var(--fusion-warning);
  }

  .die--success {
    border-color: var(--fusion-success);
  }

  .die--failure {
    border-color: var(--fusion-danger);
  }
</style>
