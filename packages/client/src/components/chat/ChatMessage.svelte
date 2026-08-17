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
   *
   * REQ-ACH-021: the formula, the value of EACH die and the applied modifier are
   * part of the first paint — there is no expander gating them, because a roll a
   * player has to click to read is a roll nobody reads.
   * REQ-ACH-022/023: the nested child rolls and every target's saving throw get
   * the same breakdown treatment, formatted by lib/chat/rollDisplay.ts.
   * REQ-ACH-024: at most four save lines, with a control that expands to all.
   * REQ-ACH-070/071: when the server graded the roll against a target, the card
   * names that target beside the degree of success. Without a target there is
   * no degree to paint — the card stops at the total, and this component never
   * invents a grade the server did not compute.
   * REQ-ACH-025: `continuesPrevious` drops the repeated header of a run of
   * consecutive messages by the same author (the run is computed by
   * lib/chat/chatGrouping.ts — cards, whispers and invalidated never join one).
   * REQ-ACH-081: an invalidated message keeps its place in the log, reads
   * attenuated with its value struck through, and carries the stamp of who
   * voided it. Nothing is removed from the markup — invalidation is an
   * annotation on the log, never a deletion (REQ-ACH-080/085).
   *
   * REQ-ACH-080..086 (A024, chat-tab.prototype.html:614-616 `invBtn`): the row
   * carries a hover-revealed invalidate/revalidate control. Visibility is
   * decided by `lib/chat/invalidateButton.ts` (REQ-ACH-082/083), the client
   * mirror of the server's `mayChangeInvalidation` — but the server is still
   * the ONLY enforcement point (REQ-ACH-090); this component never assumes an
   * emit will succeed. `chat:invalidate` travels through
   * `lib/chat/chatStore.svelte.ts`'s `sendChatInvalidate`, the same `op`
   * funnel `ChatInput` uses for `chat:send`. No local optimism: the row
   * updates when the server's own `doc:update` broadcast arrives
   * (REQ-ACH-086), through the sync path `chatMessageSync.ts` already wires.
   *
   * REQ-ACH-025 (A022, chat-tab.prototype.html:410/592/623-624): the author's
   * name and, on a plain message, the row's left border are painted with a
   * color deterministic per sender (lib/chat/speakerColor.ts) — a continuation
   * row never repaints because it never shows a header. Whisper/blind/card
   * rows keep the prototype's FIXED type colors instead of the per-sender one
   * (a sussurro is always the accent purple, a cega always the warning amber, a
   * system card always the fixed chat-sys blue), so a reader recognizes the
   * TYPE at a glance the same way regardless of who sent it. DEC-ACH-02/
   * DEC-ACH-03 govern the panel's search bar and write box, not this — cited
   * only because the task that added this behavior names them alongside
   * REQ-ACH-025.
   */

  import type { Socket } from "socket.io-client";
  import type { ChatMessage as ChatMessageType } from "@fusion/shared";
  import { ConjuracaoCardSchema } from "@fusion/system-etmos";
  import { SpellCastCardSchema, AbilityCardSchema, adaptSpellCastToAbilityCard } from "@fusion/shared";
  import { t } from "$lib/i18n/i18n.js";
  import {
    getMessageDisplayMeta,
    formatRoll,
    getRollTotalClass,
    toDegreeKey,
    degreeLabelKey,
    degreeCssClass,
    basicSaveHintKey,
    type FormattedRoll,
  } from "../../lib/chat/messageFormatter.js";
  import { classifyNestedChildren } from "../../lib/chat/chatNestedRender.js";
  import { buildRollDisplay, type RollDisplay } from "../../lib/chat/rollDisplay.js";
  import { isCardMessage, isInvalidMessage, isWhisperMessage } from "../../lib/chat/chatGrouping.js";
  import { resolveInvalidatorLabel } from "../../lib/chat/invalidationDisplay.js";
  import { speakerColor, speakerColorKey } from "../../lib/chat/speakerColor.js";
  import { resolveInvalidateAction } from "../../lib/chat/invalidateButton.js";
  import { sendChatInvalidate } from "../../lib/chat/chatStore.svelte.js";
  import { presenceState } from "../../lib/presence/presenceStore.svelte.js";
  import ChatCard from "./ChatCard.svelte";
  import ConjuracaoCard from "./etmos/ConjuracaoCard.svelte";
  import AbilityCard from "./pf2e/AbilityCard.svelte";

  const {
    message,
    children = [],
    continuesPrevious = false,
    socket,
    isGm = false,
    userId = "",
    worldId = "",
  }: {
    message: ChatMessageType;
    /**
     * Nested child rolls (r18-N1) grouped under this message by ChatLog —
     * attack/damage/save rolls of a spell-cast card. Empty for a normal
     * message. Rendered inline (compact roll lines + a "Salvaguardas" section)
     * so one card shows the whole conjuration instead of loose messages.
     */
    children?: ChatMessageType[];
    /**
     * True when this row continues the previous one (same author, neither a
     * card, a whisper nor invalidated) — the header is then not repeated
     * (REQ-ACH-025). The run is decided by `collectContinuations` in
     * lib/chat/chatGrouping.ts, which the log passes down; this component never
     * guesses it, because it cannot see its neighbours.
     */
    continuesPrevious?: boolean;
    /** Optional — only required to render system cards with actionable buttons (e.g. Etmos ConjuracaoCard). */
    socket?: Socket;
    isGm?: boolean;
    userId?: string;
    /** World id — required for the PF2e SpellCastCard's chat:send roll ops (r17-P2). */
    worldId?: string;
  } = $props();

  // Classify nested children into compact roll lines (attack/damage) + graded
  // save lines (r18-N1). Empty buckets when there are no children.
  const nested = $derived(classifyNestedChildren(children));

  // Collapse the saves section past a threshold (design: >4 → "ver todas"),
  // never hiding content during initial streaming (details/summary pattern).
  const SAVES_COLLAPSE_THRESHOLD = 4;
  let savesExpanded = $state(false);
  const savesCollapsible = $derived(nested.saves.length > SAVES_COLLAPSE_THRESHOLD);
  const visibleSaves = $derived(
    savesCollapsible && !savesExpanded
      ? nested.saves.slice(0, SAVES_COLLAPSE_THRESHOLD)
      : nested.saves,
  );

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

  // PF2e interactive ability card — flags.pf2e.abilityCard (r20-X1), the
  // generalization of the r17-P2 spell-cast card. Rides on a plain "text"
  // announcement (so old clients still see the text). Validated with the SAME
  // Zod schema the server uses; a malformed/foreign flag falls through to the
  // plain text renderer. READ COMPAT: a message persisted before r20-X1 carries
  // `flags.pf2e.spellCast` (a SpellCastCard) instead — it is adapted here to a
  // spell AbilityCard so old chat renders through the unified <AbilityCard>.
  const abilityCard = $derived.by(() => {
    const flags = message.flags as Record<string, Record<string, unknown>> | undefined;
    const rawAbility = flags?.["pf2e"]?.["abilityCard"];
    if (rawAbility !== undefined) {
      const result = AbilityCardSchema.safeParse(rawAbility);
      if (result.success) return result.data;
    }
    const rawSpell = flags?.["pf2e"]?.["spellCast"];
    if (rawSpell !== undefined) {
      const legacy = SpellCastCardSchema.safeParse(rawSpell);
      if (legacy.success) return adaptSpellCastToAbilityCard(legacy.data);
    }
    return null;
  });

  // Formatted rolls for the roll type
  const formattedRolls = $derived<FormattedRoll[]>(
    message.rolls ? message.rolls.map(formatRoll) : [],
  );

  // Graded save context persisted by the server (flags.pf2e.checkContext, r17.1).
  // Only `basicSave` is read here — it drives the per-degree damage hint. The
  // degree itself lives on each roll (roll.degreeOfSuccess), computed server-side.
  const isBasicSave = $derived.by(() => {
    const raw = (message.flags as Record<string, Record<string, unknown>> | undefined)?.["pf2e"]?.[
      "checkContext"
    ] as Record<string, unknown> | undefined;
    return raw?.["kind"] === "save" && raw["basicSave"] === true;
  });

  // REQ-ACH-021: one display per roll, computed up front — the breakdown is
  // never conditional on a click.
  const rollDisplays = $derived<RollDisplay[]>(
    message.rolls ? message.rolls.map(buildRollDisplay) : [],
  );

  // REQ-ACH-081: the message stands voided. Read structurally (chatGrouping's
  // predicate, the same one the log groups by) so there is no second notion of
  // "invalidated" in the client.
  const invalidated = $derived(isInvalidMessage(message));
  // Who voided it. The only user directory the client has is the presence list;
  // an id that resolves to nobody is printed as the id (see invalidationDisplay).
  const invalidatedBy = $derived(resolveInvalidatorLabel(message, presenceState.onlineUsers));

  // ---- Per-sender color (REQ-ACH-025, A022) ----
  // Reuses chatGrouping's OWN predicates for "is this a card"/"is this a
  // whisper" — the same ones the log's grouping already relies on — instead of
  // re-deriving a second notion of either from message.type.
  const isCard = $derived(isCardMessage(message));
  const isWhisper = $derived(isWhisperMessage(message));
  const authorColor = $derived(speakerColor(speakerColorKey(message.speaker)));
  // The prototype paints a plain message's left border with the sender's own
  // color, but a whisper/blind/card row keeps its FIXED type color instead
  // (painted below by .msg--whisper/.msg--blind/.msg--sys) — and a
  // continuation row shows no header at all, so no color to apply. `undefined`
  // here means "let the CSS class decide", never "no color painted".
  const borderColor = $derived.by(() => {
    if (continuesPrevious || isWhisper || meta.isBlind || isCard) return undefined;
    return authorColor;
  });

  // ---- Invalidate / revalidate button (REQ-ACH-080..086, A024) ----
  // `null` when the viewer may neither invalidate nor revalidate this row —
  // then no button is rendered at all (REQ-ACH-082/083).
  const invalidateAction = $derived(resolveInvalidateAction(message, isGm, userId));
  let invalidateActing = $state(false);

  async function handleInvalidateClick(): Promise<void> {
    if (!socket || !invalidateAction || invalidateActing) return;
    invalidateActing = true;
    try {
      await sendChatInvalidate(socket, worldId, message._id, invalidateAction === "invalidate");
    } catch {
      // The server is the enforcement point (REQ-ACH-090); a refusal lands in
      // chatStore.error the same way any other chat action's does. The button
      // simply re-enables so the viewer can retry or the row can settle on
      // whatever state the server actually holds.
    } finally {
      invalidateActing = false;
    }
  }
</script>

<div
  class="msg {meta.typeClass}"
  class:msg--continued={continuesPrevious}
  class:msg--invalid={invalidated}
  class:msg--whisper={isWhisper}
  class:msg--blind={meta.isBlind}
  class:msg--sys={isCard}
  style:border-left-color={borderColor}
  role="listitem"
>
  <!--
    ---- Invalidate / revalidate control (REQ-ACH-080..086, A024) ----
    Hover-revealed, prototype-style (chat-tab.prototype.html:614-616 `invBtn`).
    Absent entirely when the viewer may neither invalidate nor revalidate this
    row — REQ-ACH-082/083 decide that in lib/chat/invalidateButton.ts.
  -->
  {#if invalidateAction}
    <div class="msg__acts">
      <button
        type="button"
        class="msg__act"
        onclick={() => void handleInvalidateClick()}
        disabled={invalidateActing}
        title={invalidateAction === "invalidate"
          ? t("FUSION.Chat.Invalidate.Button")
          : t("FUSION.Chat.Revalidate.Button")}
        aria-label={invalidateAction === "invalidate"
          ? t("FUSION.Chat.Invalidate.Button")
          : t("FUSION.Chat.Revalidate.Button")}
      >
        {#if invalidateAction === "invalidate"}
          <!-- circle-slash: void, without deleting -->
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <circle cx="6" cy="6" r="4.3" fill="none" stroke="currentColor" stroke-width="1.3" />
            <path d="M3.1 3.1l5.8 5.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
          </svg>
        {:else}
          <!-- restore arc: bring the row back -->
          <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path
              d="M9.3 6A3.3 3.3 0 1 1 7.1 2.9"
              fill="none"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linecap="round"
            />
            <path
              d="M9.3 2.6v3.1h-3.1"
              fill="none"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        {/if}
      </button>
    </div>
  {/if}

  <!-- ---- Header (omitted on a continuation — REQ-ACH-025) ---- -->
  {#if !continuesPrevious}
    <div class="msg__header">
      <span class="msg__time" title={new Date(message.timestamp).toLocaleString()}
        >{meta.timeStr}</span
      >
      <span class="msg__alias" style:color={authorColor}>{meta.alias}</span>
      {#if meta.isWhisper}
        <span class="msg__badge msg__badge--whisper"
          title="Whisper to {message.whisper.join(', ')}">whisper</span>
      {/if}
      {#if meta.isBlind}
        <span class="msg__badge msg__badge--blind">blind</span>
      {/if}
      {#if invalidated}
        <span class="msg__badge msg__badge--invalid">{t("FUSION.Chat.Invalidated.Badge")}</span>
      {/if}
    </div>
  {/if}

  <!--
    REQ-ACH-081: the stamp of who voided it, on the row itself. It is the only
    thing invalidation ADDS to the log — nothing is taken away (REQ-ACH-080).
  -->
  {#if invalidated && invalidatedBy}
    <p class="msg__voided">{t("FUSION.Chat.Invalidated.By", { who: invalidatedBy })}</p>
  {/if}

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
      {@const display = rollDisplays[idx]}
      <!--
        REQ-ACH-070: the portrait the server graded this roll against. Read from
        the raw roll (the formatter carries only what it formats), and painted
        only when it is there — REQ-ACH-071 keeps a targetless roll at its total.
      -->
      {@const target = message.rolls?.[idx]?.target}
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
        </div>

        <!--
          REQ-ACH-021: every die and the applied modifier, on the first paint.
          The aria-label carries the same reading as one sentence, so a screen
          reader gets the roll without walking chip by chip.
        -->
        {#if display}
          <div class="roll-card__breakdown" role="group" aria-label={display.summary}>
            {#each display.segments as segment, si (si)}
              {#if segment.kind === "dice"}
                <span class="roll-term__dice">
                  {#each segment.dice as die, di (di)}
                    <span
                      class="die
                        {die.crit ? 'die--crit' : ''}
                        {die.fumble ? 'die--fumble' : ''}
                        {die.discarded ? 'die--discarded' : ''}
                        {die.exploded ? 'die--exploded' : ''}
                        {die.success ? 'die--success' : ''}
                        {die.failure ? 'die--failure' : ''}"
                    >
                      {die.value}
                    </span>
                  {/each}
                </span>
                {#if segment.flavor}
                  <span class="roll-term__flavor">{segment.flavor}</span>
                {/if}
              {:else}
                <span class="roll-term__value">{segment.text}</span>
              {/if}
            {/each}
          </div>
        {/if}

        <!-- Total -->
        <div class="roll-card__total roll-card__total--{totalClass || 'normal'}">
          {roll.total}
        </div>

        <!--
          Target (REQ-ACH-070) — the name of who the roll was aimed at, right
          above the degree it produced, so the two read as one sentence. The AC
          is never printed: it does not even reach a player's payload
          (REQ-ACH-073).
        -->
        {#if target}
          <div class="roll-card__target">
            {t("FUSION.Chat.Target.Label", { name: target.name })}
          </div>
        {/if}

        <!-- Degree of success (r17.1) — localized badge + basic-save damage hint -->
        {#if roll.degreeOfSuccess}
          {@const dk = toDegreeKey(roll.degreeOfSuccess)}
          {#if dk}
            <div class="roll-card__dos {degreeCssClass(dk)}">{t(degreeLabelKey(dk))}</div>
            {#if isBasicSave}
              <div class="roll-card__basic-hint">{t(basicSaveHintKey(dk))}</div>
            {/if}
          {:else}
            <div class="roll-card__dos">{roll.degreeOfSuccess}</div>
          {/if}
        {/if}

        <!-- Warnings -->
        {#each roll.warnings as warning}
          <p class="roll-card__warning">{warning}</p>
        {/each}

      </div>
    {/each}
  {:else if message.type === "system" && conjuracaoCard}
    <!-- Etmos Compositor de Magias card (flags.etmos.conjuracao) -->
    <ConjuracaoCard card={conjuracaoCard} messageId={message._id} {socket} {isGm} {userId} />
  {:else if message.type === "system" && message.card}
    <!-- Chat card (declarative, no innerHTML) -->
    <ChatCard card={message.card} messageId={message._id} />
  {:else if abilityCard}
    <!-- PF2e interactive ability card (flags.pf2e.abilityCard, or adapted legacy
         flags.pf2e.spellCast) — text announcement + save/damage buttons -->
    {#if message.content}
      <p class="msg__content">{message.content}</p>
    {/if}
    <AbilityCard card={abilityCard} messageId={message._id} {worldId} {socket} {isGm} {userId} />
  {:else}
    <!-- text / whisper / system (no card) -->
    <p class="msg__content">{message.content}</p>
  {/if}

  <!-- ---- Nested child rolls (r18-N1) ---- -->
  <!--
    Attack / damage / save rolls spawned by this spell-cast card, grouped here
    by ChatLog so the conjuration reads as ONE card. Compact roll lines for the
    caster's attack/damage; a "Salvaguardas" section (collapsible past 4) for
    the targets' graded saves. Empty for a normal message.
  -->
  {#if nested.rolls.length > 0 || nested.saves.length > 0}
    <div class="nested" role="group" aria-label={t("FUSION.Chat.SpellCard.Title")}>
      <!--
        REQ-ACH-022: a child roll inside the card is not a poorer citizen — it
        shows its dice and its modifier, and its degree when the server graded it.
      -->
      {#each nested.rolls as line (line.messageId)}
        <div class="nested-roll">
          <span class="nested-roll__label">
            {line.flavor ?? line.formula}
          </span>
          <span class="nested-roll__breakdown">{line.breakdown}</span>
          {#if line.degree}
            <span class="nested-roll__badge {degreeCssClass(line.degree)}"
              >{t(degreeLabelKey(line.degree))}</span
            >
          {/if}
          <span class="nested-roll__total nested-roll__total--{line.totalClass || 'normal'}">
            {line.total}
          </span>
        </div>
      {/each}

      {#if nested.saves.length > 0}
        <div class="nested-saves">
          <div class="nested-saves__title">{t("FUSION.Chat.SpellCard.SavesSection")}</div>
          {#each visibleSaves as save (save.messageId)}
            {@const dk = save.degree}
            <div class="nested-save">
              <span class="nested-save__alias">{save.alias}</span>
              <!-- REQ-ACH-023: the dice of the test, on the target's own line. -->
              <span class="nested-save__breakdown">{save.breakdown}</span>
              <span class="nested-save__total">{save.total}</span>
              {#if dk}
                <span class="nested-save__badge {degreeCssClass(dk)}">{t(degreeLabelKey(dk))}</span>
                {#if save.basicSave}
                  <span class="nested-save__hint">{t(basicSaveHintKey(dk))}</span>
                {/if}
              {:else}
                <span class="nested-save__badge">{save.degreeRaw}</span>
              {/if}
            </div>
          {/each}
          {#if savesCollapsible}
            <button
              type="button"
              class="nested-saves__toggle"
              onclick={() => (savesExpanded = !savesExpanded)}
              aria-expanded={savesExpanded}
            >
              {savesExpanded
                ? t("FUSION.Chat.SpellCard.HideSaves")
                : t("FUSION.Chat.SpellCard.ShowAllSaves", { count: String(nested.saves.length) })}
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /*
    REQ-ACH-025 (A022): every row carries a left border, default neutral gray so
    a continuation (no inline color — same author, header suppressed) still
    aligns with the row above it. `style:border-left-color` (set from script)
    overrides this per-sender for a plain top-level message; the .msg--whisper/
    .msg--blind/.msg--sys rules below override it again, unconditionally, for
    the three fixed types the prototype paints regardless of sender.
  */
  .msg {
    position: relative;
    padding: 0.35rem 0.75rem;
    border-left: 2px solid var(--fusion-border);
    border-bottom: 1px solid transparent;
    transition:
      background-color var(--fusion-transition),
      border-left-color var(--fusion-transition);
  }

  .msg:hover {
    background: var(--fusion-surface-alt);
  }

  /*
    REQ-ACH-080..086 (A024, chat-tab.prototype.html `.acts`): the
    invalidate/revalidate control sits in the row's top-right corner and only
    shows on hover/focus — it never crowds the message body, and a reader who
    is not the GM or the author simply never sees it (the button is absent from
    the markup entirely for them, not just hidden by CSS).
  */
  .msg__acts {
    position: absolute;
    top: -6px;
    right: 4px;
    display: none;
    gap: 0.15rem;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    padding: 0.1rem;
    z-index: 2;
  }

  .msg:hover .msg__acts,
  .msg:focus-within .msg__acts {
    display: flex;
  }

  .msg__act {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: 0;
    color: var(--fusion-text-subtle);
    cursor: pointer;
    padding: 0.15rem 0.3rem;
    border-radius: 3px;
  }

  .msg__act:hover:not(:disabled) {
    color: var(--fusion-text);
    background: var(--fusion-surface);
  }

  .msg__act:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .msg__act svg {
    width: 12px;
    height: 12px;
  }

  /*
    REQ-ACH-025: a continuation of the same author's run keeps the body aligned
    with the message above it and drops the vertical breathing room the header
    used to provide.
  */
  .msg--continued {
    padding-top: 0;
  }

  /*
    REQ-ACH-081: voided, not gone. The whole row is attenuated and every value
    it announces — the text, the roll totals, the child lines — is struck
    through, so a reader scanning the log cannot mistake it for something that
    still counts. The stamp below stays at full contrast: it is the one part of
    the row that is still true.
  */
  .msg--invalid {
    opacity: 0.55;
  }

  .msg--invalid .msg__content,
  .msg--invalid .roll-card__total,
  .msg--invalid .roll-card__dos,
  .msg--invalid .nested-roll__total,
  .msg--invalid .nested-save__total {
    text-decoration: line-through;
  }

  .msg--invalid .msg__voided {
    text-decoration: none;
    opacity: 1;
  }

  .msg__voided {
    font-size: 0.7rem;
    font-style: italic;
    color: var(--fusion-text-muted);
    margin: 0 0 0.15rem;
  }

  .msg__badge--invalid {
    background: rgba(255, 92, 92, 0.15);
    color: var(--fusion-danger);
  }

  /* ---- Type variants ---- */
  .msg--emote {
    color: var(--fusion-text-muted);
  }

  /*
    Fixed type colors (chat-tab.prototype.html: .m--whisper/.m--blind/.m--sys).
    These override the per-sender border painted inline via style:border-left-color
    (borderColor is `undefined` for whisper/blind/card rows precisely so these
    win) — a reader recognizes the TYPE of a row at a glance, the same color
    regardless of who sent it.
  */
  .msg--whisper {
    background: rgba(124, 92, 252, 0.07);
    border-left: 2px solid var(--fusion-accent);
  }

  .msg--blind {
    background: rgba(255, 200, 87, 0.06);
    border-left: 2px solid var(--fusion-warning);
  }

  .msg--sys {
    border-left-color: var(--fusion-chat-sys);
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

  /* REQ-ACH-070: the target, quieter than the degree it explains. */
  .roll-card__target {
    text-align: center;
    font-size: 0.7rem;
    color: var(--fusion-text-muted);
    padding: 0 0.6rem 0.2rem;
    font-style: italic;
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

  /* Degree-of-success badge colors (r17.1) — coherent with the total palette. */
  .roll-card__dos.dos--crit-success {
    color: var(--fusion-success);
    text-shadow: 0 0 10px rgba(61, 220, 132, 0.35);
  }

  .roll-card__dos.dos--success {
    color: var(--fusion-success);
  }

  .roll-card__dos.dos--failure {
    color: var(--fusion-danger);
  }

  .roll-card__dos.dos--crit-failure {
    color: var(--fusion-danger);
    text-shadow: 0 0 10px rgba(255, 92, 92, 0.35);
  }

  .roll-card__basic-hint {
    text-align: center;
    font-size: 0.68rem;
    color: var(--fusion-text-muted);
    padding: 0 0.6rem 0.4rem;
    font-style: italic;
  }

  .roll-card__warning {
    font-size: 0.7rem;
    color: var(--fusion-warning);
    padding: 0 0.6rem 0.3rem;
    margin: 0;
  }

  /* ---- Breakdown (always visible — REQ-ACH-021) ---- */
  .roll-card__breakdown {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.3rem;
    padding: 0.4rem 0.6rem 0;
    font-size: 0.75rem;
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

  /* ---- Nested child rolls (r18-N1) ---- */
  .nested {
    margin-top: 0.35rem;
    padding-left: 0.6rem;
    border-left: 2px solid var(--fusion-accent-dim);
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    max-width: 340px;
  }

  .nested-roll {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.78rem;
  }

  .nested-roll__label {
    color: var(--fusion-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* REQ-ACH-022: the dice of the child roll, right beside its label. */
  .nested-roll__breakdown {
    font-family: var(--fusion-font-mono);
    font-size: 0.72rem;
    color: var(--fusion-text-subtle);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nested-roll__badge {
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fusion-accent);
    flex-shrink: 0;
  }

  .nested-roll__badge.dos--crit-success,
  .nested-roll__badge.dos--success {
    color: var(--fusion-success);
  }

  .nested-roll__badge.dos--failure,
  .nested-roll__badge.dos--crit-failure {
    color: var(--fusion-danger);
  }

  .nested-roll__total {
    font-family: var(--fusion-font-mono);
    font-weight: 700;
    color: var(--fusion-text);
    flex-shrink: 0;
  }

  .nested-roll__total--crit {
    color: var(--fusion-success);
  }

  .nested-roll__total--fumble {
    color: var(--fusion-danger);
  }

  .nested-saves {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding-top: 0.15rem;
  }

  .nested-saves__title {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--fusion-text-subtle);
    margin-bottom: 0.1rem;
  }

  .nested-save {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    font-size: 0.76rem;
    flex-wrap: wrap;
  }

  .nested-save__alias {
    color: var(--fusion-text);
    font-weight: 600;
  }

  .nested-save__total {
    font-family: var(--fusion-font-mono);
    color: var(--fusion-text-muted);
  }

  /* REQ-ACH-023: the dice of the saving throw, on the target's own line. */
  .nested-save__breakdown {
    font-family: var(--fusion-font-mono);
    font-size: 0.7rem;
    color: var(--fusion-text-subtle);
  }

  .nested-save__badge {
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fusion-accent);
  }

  /* Degree badge colors — reuse the roll-card degree palette (r17.1). */
  .nested-save__badge.dos--crit-success {
    color: var(--fusion-success);
  }
  .nested-save__badge.dos--success {
    color: var(--fusion-success);
  }
  .nested-save__badge.dos--failure {
    color: var(--fusion-danger);
  }
  .nested-save__badge.dos--crit-failure {
    color: var(--fusion-danger);
  }

  .nested-save__hint {
    font-size: 0.68rem;
    font-style: italic;
    color: var(--fusion-text-subtle);
  }

  .nested-saves__toggle {
    align-self: flex-start;
    margin-top: 0.15rem;
    background: none;
    border: none;
    padding: 0;
    color: var(--fusion-accent);
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: 0.7rem;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .nested-saves__toggle:hover {
    color: var(--fusion-accent-hover);
  }
</style>
