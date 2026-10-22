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
   * `readOnly` forces the control off no matter what `resolveInvalidateAction`
   * would otherwise allow — a surface that does not subscribe to that
   * `doc:update` broadcast (ChatContextWindow.svelte, REQ-ACH-014) would let
   * the viewer fire a real `chat:invalidate` and never see it take effect,
   * success OR refusal. Every other caller leaves it at its default `false`.
   *
   * REQ-ACH-025 (A022, chat-tab.prototype.html:410/592/623-624): the author's
   * name and, on a plain message, the row's left border are painted with a
   * color deterministic per sender (lib/chat/speakerColor.ts's
   * `resolveSpeakerColor` — the sender's own REQ-USR-002 world color when
   * presence has a record for them, REQ-CHT-008's "cor do jogador", falling
   * back to a per-alias hash only when it doesn't) — a continuation row never
   * repaints because it never shows a header. Whisper/blind/card rows keep the
   * prototype's FIXED type colors instead of the per-sender one (a sussurro is
   * always the accent purple, a cega always the warning amber, a system card
   * always the fixed chat-sys blue), so a reader recognizes the TYPE at a
   * glance the same way regardless of who sent it. DEC-ACH-02/DEC-ACH-03
   * govern the panel's search bar and write box, not this — cited only
   * because the task that added this behavior names them alongside
   * REQ-ACH-025.
   */

  import type { Socket } from "socket.io-client";
  import type { ChatMessage as ChatMessageType } from "@fusion/shared";
  import { t, i18n } from "$lib/i18n/i18n.js";
  import {
    getMessageDisplayMeta,
    formatRoll,
    getRollTotalClass,
    toDegreeKey,
    degreeLabelKey,
    degreeCssClass,
    basicSaveHintKey,
    isRedundantRollContent,
    type FormattedRoll,
  } from "../../lib/chat/messageFormatter.js";
  import { classifyNestedChildren } from "../../lib/chat/chatNestedRender.js";
  import { buildRollDisplay, type RollDisplay } from "../../lib/chat/rollDisplay.js";
  import { rollBreakdownRows } from "../../lib/chat/rollBreakdownParts.js";
  import { isCardMessage, isInvalidMessage } from "../../lib/chat/chatGrouping.js";
  import { resolveInvalidatorLabel } from "../../lib/chat/invalidationDisplay.js";
  import { resolveSpeakerColor } from "../../lib/chat/speakerColor.js";
  import { resolveInvalidateAction } from "../../lib/chat/invalidateButton.js";
  import { sendChatInvalidate } from "../../lib/chat/chatStore.svelte.js";
  import { presenceState } from "../../lib/presence/presenceStore.svelte.js";
  import ChatCard from "./ChatCard.svelte";
  import Icon from "../common/Icon.svelte";
  import CostGlyphs from "../common/CostGlyphs.svelte";
  import { splitCostGlyphs } from "../../lib/chat/costGlyphText.js";
  import { rollModeIcons, rollModeI18nStem } from "./rollModeIcons.js";
  import { resolveChatCardExtension } from "../../lib/chat/chatCardExtensionRegistry.svelte.js";

  const {
    message,
    children = [],
    continuesPrevious = false,
    socket,
    isGm = false,
    userId = "",
    worldId = "",
    readOnly = false,
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
    /** Optional — only required to render system cards with actionable buttons (e.g. SpellCastCard). */
    socket?: Socket;
    isGm?: boolean;
    userId?: string;
    /** World id — required for the PF2e SpellCastCard's chat:send roll ops (r17-P2). */
    worldId?: string;
    /**
     * True on a surface that must never let this row fire a write it cannot
     * show the outcome of (ChatContextWindow.svelte). Suppresses the
     * invalidate/revalidate control entirely, regardless of what
     * `resolveInvalidateAction` would return — a viewer/GM in every other
     * respect still sees the row exactly as-is, including an existing
     * invalidation's struck-through styling (REQ-ACH-081), just with no
     * button to change that state from here.
     */
    readOnly?: boolean;
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

  // System interactive card extension — e.g. PF2e's ability card
  // (flags.pf2e.abilityCard, r20-X1; or the legacy flags.pf2e.spellCast it
  // adapts). Rides on a plain "text" announcement (so old clients still see
  // the text). This core component never imports a system's card component
  // or flag shape directly (F3, DEC-SEP-02) — it asks the
  // chatCardExtensionRegistry, which the active system populated at boot
  // (systems/pf2e's registerPf2eSheets()). A world with no matching
  // extension (or no system at all) simply falls through to plain text.
  //
  // ALQ-F1-10: the mounted extension component also receives `children` —
  // the SAME nested-roll array `nested.rolls`/`nested.saves` are classified
  // from below — so a card whose "apply damage" buttons must ride a
  // SPECIFIC fired roll (not local per-clicker state) can derive that from
  // the real broadcast children every viewer receives, GM included, instead
  // of only the one viewer who happened to click the roll button.
  const cardExtension = $derived(resolveChatCardExtension(message));

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

  // ui-fundacao: where the modifier came from — the parts the server checked against the formula
  // (`flags.fusion.breakdown`) plus the conditional modifiers it added. Printed under the first roll.
  const breakdownRows = $derived(rollBreakdownRows(message));

  // REQ-ACH-081: the message stands voided. Read structurally (chatGrouping's
  // predicate, the same one the log groups by) so there is no second notion of
  // "invalidated" in the client.
  const invalidated = $derived(isInvalidMessage(message));
  // Who voided it. The only user directory the client has is the presence list;
  // an id that resolves to nobody is printed as the id (see invalidationDisplay).
  const invalidatedBy = $derived(resolveInvalidatorLabel(message, presenceState.onlineUsers));

  // ---- Per-sender color (REQ-ACH-025, A022; REQ-CHT-008, REQ-USR-002) ----
  // Reuses chatGrouping's OWN predicate for "is this a card" — the same one
  // the log's grouping already relies on — instead of re-deriving a second
  // notion of it from message.type. The whisper TYPE tint, unlike the card
  // check, is keyed strictly to `message.type === "whisper"`
  // (chat-tab.prototype.html:578/623) — NOT the broader `isWhisperMessage`
  // predicate (msg.type === "whisper" || msg.whisper.length > 0). A PRIVATE
  // ROLL (gmroll/selfroll) also populates `whisper[]`, but the prototype
  // keeps its border the sender's own color and marks it only with a seal
  // ("ao Mestre"/"só eu") — it is not painted as a sussurro.
  const isCard = $derived(isCardMessage(message));
  const isWhisperType = $derived(message.type === "whisper");
  // resolveSpeakerColor prefers the sender's own world color (REQ-USR-002,
  // the same field painted on their cursor/ruler/pings and edited in
  // Settings) so a message never invents a SECOND identity color for someone
  // who already has one (REQ-CHT-008: "borda na cor do jogador"). It falls
  // back to the deterministic per-alias hash only when presence has no
  // record for that userId. `presenceState.onlineUsers` is the same directory
  // `invalidatedBy` above already reads — no second source of user color.
  const authorColor = $derived(resolveSpeakerColor(message.speaker, presenceState.onlineUsers));
  // The prototype paints a plain message's left border with the sender's own
  // color, but a whisper/blind/card row keeps its FIXED type color instead
  // (painted below by .msg--whisper/.msg--blind/.msg--sys) — and a
  // continuation row shows no header at all, so no color to apply. `undefined`
  // here means "let the CSS class decide", never "no color painted".
  const borderColor = $derived.by(() => {
    if (continuesPrevious || isWhisperType || meta.isBlind || isCard) return undefined;
    return authorColor;
  });

  // ---- Invalidate / revalidate button (REQ-ACH-080..086, A024) ----
  // `null` when the viewer may neither invalidate nor revalidate this row —
  // then no button is rendered at all (REQ-ACH-082/083). `readOnly` forces
  // `null` even when `resolveInvalidateAction` would allow it, for a surface
  // that cannot show whether the write it triggered succeeded or was refused.
  const invalidateAction = $derived(
    readOnly ? null : resolveInvalidateAction(message, isGm, userId),
  );
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
  class:msg--whisper={isWhisperType}
  class:msg--blind={meta.isBlind}
  class:msg--sys={isCard}
  style:border-left-color={borderColor}
  role="listitem"
>
  <!--
    ---- Invalidate / revalidate control (REQ-ACH-080..086, A024) ----
    Hover/focus-revealed (chat-tab.prototype.html:614-616 `invBtn`). Absent entirely when the
    viewer may neither invalidate nor revalidate this row — REQ-ACH-082/083 decide that in
    lib/chat/invalidateButton.ts. ui-chat: icons of the shared set ("ban" / "undo-2").
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
        <Icon name={invalidateAction === "invalidate" ? "ban" : "undo-2"} size={18} />
      </button>
    </div>
  {/if}

  <!--
    ---- Header (omitted on a continuation — REQ-ACH-025) ----
    ui-chat: the sender's color is a dot beside the name, not the color of the name itself — a
    player color (amarelo, verde-limão) fails AA as text on one theme or the other; as a mark it
    only has to be seen. The name reads in the text color; the hour is plain text, not monospaced.
  -->
  {#if !continuesPrevious}
    <div class="msg__header">
      <span class="msg__dot" style:background-color={authorColor} aria-hidden="true"></span>
      <span class="msg__alias">{meta.alias}</span>
      {#if meta.isWhisper}
        <span class="msg__badge msg__badge--whisper">{t("FUSION.Chat.Badge.Whisper")}</span>
      {/if}
      {#if meta.isBlind}
        <span class="msg__badge msg__badge--blind">{t("FUSION.Chat.RollMode.Blind.Label")}</span>
      {/if}
      {#if invalidated}
        <span class="msg__badge msg__badge--invalid">{t("FUSION.Chat.Invalidated.Badge")}</span>
      {/if}
      <span class="msg__time" title={new Date(message.timestamp).toLocaleString()}
        >{meta.timeStr}</span
      >
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
    <p class="msg__content msg__content--emote">{meta.alias} {message.content}</p>
  {:else if message.type === "roll"}
    <!-- The server's own summary ("Atletismo: 14") only repeats the card: printed only when a person wrote it. -->
    {#if message.content && !isRedundantRollContent(message.content, message.rolls ?? [])}
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
      <!--
        ui-chat (direção A, revisao-ui-2026-10-22 frame d): ONE box per roll. The name of the roll and
        its total share the first line; the dice and the formula below; then where the modifier came from.
      -->
      <div class="roll-card" role="group" aria-label={roll.flavor ?? roll.formula}>
        <div class="roll-card__head">
          <span class="roll-card__title" class:roll-card__title--formula={!roll.flavor}
            >{roll.flavor ?? roll.formula}</span
          >
          {#if roll.rollMode !== "public"}
            <span class="roll-card__mode">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -- static icon set -->
              {@html rollModeIcons[roll.rollMode]}
              {t(`${rollModeI18nStem[roll.rollMode]}.Label`)}
            </span>
          {/if}
          <span class="roll-card__total roll-card__total--{totalClass || 'normal'}">{roll.total}</span>
        </div>

        <!--
          REQ-ACH-021: every die and the applied modifier, on the first paint.
          The aria-label carries the same reading as one sentence, so a screen
          reader gets the roll without walking chip by chip.
        -->
        {#if display}
          <div class="roll-card__breakdown" role="group" aria-label={display.summary}>
            {#if roll.flavor}
              <span class="roll-card__formula" title={roll.expandedFormula}>{roll.formula}</span>
            {/if}
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

        {#if idx === 0 && breakdownRows.length > 0}
          <dl class="roll-card__parts" aria-label={t("FUSION.Chat.Breakdown.Label")} data-testid="roll-card-parts">
            {#each breakdownRows as row, ri (ri)}
              <div class="roll-card__part" class:roll-card__part--off={!row.applied}>
                <dt class="roll-card__part-label">
                  {row.label}
                  {#if row.conditional}
                    <span class="roll-card__part-note">{t("FUSION.Chat.Breakdown.Conditional")}</span>
                  {/if}
                  {#if !row.applied}
                    <span class="roll-card__part-note">{t("FUSION.Chat.Breakdown.NotApplied")}</span>
                  {/if}
                </dt>
                <dd class="roll-card__part-value">{row.valueFormatted}</dd>
              </div>
            {/each}
          </dl>
        {/if}

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
        {#each roll.warnings as warning, wi (wi)}
          <p class="roll-card__warning">{warning}</p>
        {/each}
      </div>
    {/each}
  {:else if message.type === "system" && message.card}
    <!-- Chat card (declarative, no innerHTML) -->
    <ChatCard card={message.card} messageId={message._id} />
  {:else if cardExtension}
    <!-- System interactive card extension (e.g. PF2e's ability card) —
         text announcement + save/damage buttons, mounted via the registry. -->
    {#if message.content}
      <!-- The cost in a stored announcement ("lança X (grau 2) ◆◆") is drawn by Fusion's own
           marks with its words for screen readers — at render time, no migration. -->
      <p class="msg__content msg__content--announce">
        {#each splitCostGlyphs(message.content, i18n.locale) as part, pi (pi)}{#if part.kind === "text"}{part.text}{:else}<CostGlyphs
              glyphs={part.glyphs}
              size={13}
            /><span class="msg__sr">{part.label}</span>{/if}{/each}
      </p>
    {/if}
    {@const CardExtensionComponent = cardExtension.component}
    <CardExtensionComponent
      card={cardExtension.card}
      messageId={message._id}
      {worldId}
      {socket}
      {isGm}
      {userId}
      {children}
      flags={message.flags}
    />
  {:else}
    <!-- text / whisper / system (no card) -->
    <p class="msg__content">{message.content}</p>
  {/if}

  <!-- ---- Nested child rolls (r18-N1) ---- -->
  <!--
    Attack / damage / save rolls spawned by this card, grouped here by ChatLog so
    the ability reads as ONE card. Compact roll lines for the caster's
    attack/damage; a "Salvaguardas" section (collapsible past 4) for the targets'
    graded saves. Empty for a normal message.
  -->
  {#if nested.rolls.length > 0 || nested.saves.length > 0}
    <div class="nested" role="group" aria-label={t("FUSION.Chat.SpellCard.Title")}>
      <!--
        REQ-ACH-022: a child roll inside the card is not a poorer citizen — it
        shows its dice and its modifier, and its degree when the server graded it.
        ui-chat: and where the modifier came from, the same rows a loose card prints.
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
          {#each line.extras ?? [] as extra (extra)}
            <span class="nested-roll__extra">{extra}</span>
          {/each}
          {#if line.parts.length > 0}
            <dl class="nested-roll__parts" aria-label={t("FUSION.Chat.Breakdown.Label")}>
              {#each line.parts as row, ri (ri)}
                <div class="roll-card__part" class:roll-card__part--off={!row.applied}>
                  <dt class="roll-card__part-label">
                    {row.label}
                    {#if row.conditional}
                      <span class="roll-card__part-note">{t("FUSION.Chat.Breakdown.Conditional")}</span>
                    {/if}
                    {#if !row.applied}
                      <span class="roll-card__part-note">{t("FUSION.Chat.Breakdown.NotApplied")}</span>
                    {/if}
                  </dt>
                  <dd class="roll-card__part-value">{row.valueFormatted}</dd>
                </div>
              {/each}
            </dl>
          {/if}
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
    REQ-ACH-025 (A022): every row carries a left border, default neutral so a
    continuation (same author, header suppressed) still aligns with the row above
    it. `style:border-left-color` (set from script) overrides this per-sender for a
    plain top-level message; .msg--whisper/.msg--blind/.msg--sys override it again
    for the three fixed types the prototype paints regardless of sender.
    ui-chat: rows are separated by space, never by a box of their own.
  */
  .msg {
    position: relative;
    padding: var(--fusion-space-2) var(--fusion-space-3);
    border-left: 3px solid var(--fusion-border);
    font-size: var(--fusion-text-base);
    line-height: var(--fusion-leading);
    transition:
      background-color var(--fusion-transition),
      border-left-color var(--fusion-transition);
  }

  .msg:hover {
    background: var(--fusion-surface-alt);
  }

  /*
    REQ-ACH-080..086 (A024): the invalidate/revalidate control sits in the row's
    top-right corner and only shows on hover/focus. RNF-ACH-04 (REQ-UIF-064):
    revealed via opacity, not `display: none`, so a keyboard user can focus it.
    It floats over the row, so it carries the popover shadow.
  */
  .msg__acts {
    position: absolute;
    top: var(--fusion-space-1);
    right: var(--fusion-space-2);
    display: flex;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    box-shadow: var(--fusion-shadow-popover);
    z-index: 2;
    opacity: 0;
    transition: opacity var(--fusion-transition);
  }

  .msg:hover .msg__acts,
  .msg:focus-within .msg__acts {
    opacity: 1;
  }

  .msg__act {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--fusion-target);
    min-height: var(--fusion-target);
    background: none;
    border: 0;
    color: var(--fusion-text-muted);
    cursor: pointer;
    border-radius: var(--fusion-radius);
  }

  .msg__act:hover:not(:disabled) {
    color: var(--fusion-text);
    background: var(--fusion-surface-alt);
  }

  .msg__act:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .msg__act:focus-visible {
    outline: 2px solid var(--fusion-focus);
    outline-offset: 1px;
  }

  /* REQ-ACH-025: a continuation keeps the body aligned and drops the header's room. */
  .msg--continued {
    padding-top: 0;
  }

  /*
    REQ-ACH-081: voided, not gone. The row is attenuated and every value it
    announces is struck through; the stamp stays at full contrast.
  */
  .msg--invalid {
    opacity: 0.6;
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
    font-size: var(--fusion-text-sm);
    color: var(--fusion-text-muted);
    margin: 0 0 var(--fusion-space-1);
  }

  /* ---- Type variants (fixed type colors: whisper, blind, card) ---- */
  .msg--emote {
    color: var(--fusion-text-muted);
  }

  .msg--whisper {
    background: var(--fusion-accent-dim);
    border-left-color: var(--fusion-accent);
  }

  .msg--blind {
    background: var(--fusion-warning-dim);
    border-left-color: var(--fusion-warning);
  }

  .msg--sys {
    border-left-color: var(--fusion-chat-sys);
  }

  .msg--system {
    color: var(--fusion-text-muted);
  }

  /* ---- Header ---- */
  .msg__header {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--fusion-space-1) var(--fusion-space-2);
    margin-bottom: var(--fusion-space-1);
  }

  .msg__dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex: none;
    background-color: var(--fusion-border-strong);
  }

  .msg__alias {
    font-weight: var(--fusion-weight-bold);
    color: var(--fusion-text);
    overflow-wrap: anywhere;
  }

  .msg__time {
    margin-left: auto;
    font-size: var(--fusion-text-xs);
    color: var(--fusion-text-subtle);
    flex: none;
  }

  .msg__badge {
    font-size: var(--fusion-text-xs);
    font-weight: var(--fusion-weight-medium);
    border-radius: var(--fusion-radius-sm);
    padding: 0 var(--fusion-space-1);
    color: var(--fusion-text);
  }

  .msg__badge--whisper {
    background: var(--fusion-accent-dim);
  }

  .msg__badge--blind {
    background: var(--fusion-warning-dim);
  }

  .msg__badge--invalid {
    background: var(--fusion-danger-dim);
  }

  /* ---- Content ---- */
  .msg__content {
    color: var(--fusion-text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin: 0;
    max-width: var(--fusion-measure);
  }

  .msg__content--emote {
    color: var(--fusion-text-muted);
  }

  /* The line a system card is announced with ("Bico (PAM 1)"): a caption over the card. */
  .msg__content--announce {
    font-size: var(--fusion-text-sm);
    color: var(--fusion-text-muted);
  }

  /* Read by screen readers only (the drawn cost is aria-hidden). */
  .msg__sr {
    clip-path: inset(50%);
    height: 1px;
    overflow: hidden;
    position: absolute;
    white-space: nowrap;
    width: 1px;
  }

  /* ---- Roll card: one box per roll (direção A) ---- */
  .roll-card {
    margin-top: var(--fusion-space-2);
    padding: var(--fusion-space-2) var(--fusion-space-3);
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-left: 4px solid var(--fusion-chat-sys);
    border-radius: var(--fusion-radius);
    max-width: 360px;
  }

  .roll-card__head {
    display: flex;
    align-items: center;
    gap: var(--fusion-space-2);
  }

  .roll-card__title {
    flex: 1;
    min-width: 0;
    font-size: var(--fusion-text-md);
    font-weight: var(--fusion-weight-bold);
    color: var(--fusion-text);
    overflow-wrap: anywhere;
  }

  .roll-card__title--formula {
    font-family: var(--fusion-font-mono);
  }

  .roll-card__mode {
    display: inline-flex;
    align-items: center;
    gap: var(--fusion-space-1);
    font-size: var(--fusion-text-xs);
    color: var(--fusion-text-muted);
    flex: none;
  }

  .roll-card__total {
    font-family: var(--fusion-font-mono);
    font-size: var(--fusion-text-2xl);
    font-weight: var(--fusion-weight-bold);
    line-height: var(--fusion-leading-tight);
    color: var(--fusion-text);
    flex: none;
  }

  .roll-card__total--crit {
    color: var(--fusion-success);
  }

  .roll-card__total--fumble {
    color: var(--fusion-danger);
  }

  /* ---- Dice and formula (always visible — REQ-ACH-021) ---- */
  .roll-card__breakdown {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--fusion-space-1) var(--fusion-space-2);
    margin-top: var(--fusion-space-1);
    font-size: var(--fusion-text-sm);
    color: var(--fusion-text-muted);
  }

  .roll-card__formula {
    font-family: var(--fusion-font-mono);
    overflow-wrap: anywhere;
  }

  .roll-term__dice {
    display: flex;
    flex-wrap: wrap;
    gap: var(--fusion-space-1);
  }

  .roll-term__value {
    font-family: var(--fusion-font-mono);
    color: var(--fusion-text);
  }

  .roll-term__flavor {
    color: var(--fusion-text-muted);
  }

  /* ---- Individual dice ---- */
  .die {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.75rem;
    height: 1.75rem;
    padding: 0 var(--fusion-space-1);
    border-radius: var(--fusion-radius-sm);
    border: 1px solid var(--fusion-border-strong);
    background: var(--fusion-surface);
    font-family: var(--fusion-font-mono);
    font-size: var(--fusion-text-sm);
    font-weight: var(--fusion-weight-bold);
    color: var(--fusion-text);
  }

  .die--crit {
    border-color: var(--fusion-success);
    background: var(--fusion-success-dim);
  }

  .die--fumble {
    border-color: var(--fusion-danger);
    background: var(--fusion-danger-dim);
  }

  .die--discarded {
    opacity: 0.5;
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

  /* ---- Where the modifier came from: one line per part, label left, value right ---- */
  .roll-card__parts,
  .nested-roll__parts {
    margin: var(--fusion-space-2) 0 0;
    font-size: var(--fusion-text-sm);
    color: var(--fusion-text-muted);
  }

  .nested-roll__parts {
    flex: 1 1 100%;
    margin-top: 0;
  }

  .roll-card__part {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--fusion-space-3);
    padding: var(--fusion-space-1) 0;
    border-top: 1px solid var(--fusion-border);
  }

  .roll-card__part-label {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .roll-card__part-value {
    margin: 0;
    font-family: var(--fusion-font-mono);
    font-weight: var(--fusion-weight-bold);
    color: var(--fusion-text);
    flex: none;
  }

  .roll-card__part--off .roll-card__part-label,
  .roll-card__part--off .roll-card__part-value {
    color: var(--fusion-text-subtle);
  }

  .roll-card__part--off .roll-card__part-value {
    text-decoration: line-through;
  }

  .roll-card__part-note {
    margin-left: var(--fusion-space-1);
    font-size: var(--fusion-text-xs);
    color: var(--fusion-text-subtle);
  }

  /* REQ-ACH-070: the target, quieter than the degree it explains. */
  .roll-card__target {
    margin-top: var(--fusion-space-2);
    font-size: var(--fusion-text-sm);
    color: var(--fusion-text-muted);
  }

  .roll-card__dos {
    margin-top: var(--fusion-space-1);
    font-weight: var(--fusion-weight-bold);
    color: var(--fusion-text);
  }

  /* Degree-of-success colors (r17.1): the semantic colors, no glow. */
  .roll-card__dos.dos--crit-success,
  .roll-card__dos.dos--success {
    color: var(--fusion-success);
  }

  .roll-card__dos.dos--failure,
  .roll-card__dos.dos--crit-failure {
    color: var(--fusion-danger);
  }

  .roll-card__basic-hint {
    font-size: var(--fusion-text-sm);
    color: var(--fusion-text-muted);
  }

  .roll-card__warning {
    font-size: var(--fusion-text-sm);
    color: var(--fusion-warning);
    margin: var(--fusion-space-1) 0 0;
  }

  /* ---- Nested child rolls (r18-N1): under the card above, grouped by a rule, not a box ---- */
  .nested {
    margin-top: var(--fusion-space-2);
    padding-left: var(--fusion-space-3);
    border-left: 2px solid var(--fusion-border-strong);
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-2);
    max-width: 360px;
  }

  .nested-roll {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--fusion-space-1) var(--fusion-space-2);
    font-size: var(--fusion-text-sm);
  }

  /* The label owns its row and wraps: clipped, it hid the calculation and left the line unreadable (L2 round 2, D7). */
  .nested-roll__label {
    color: var(--fusion-text);
    font-weight: var(--fusion-weight-medium);
    flex: 1 1 100%;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  /* BHR-F4-09: the part an effect of the roller added (the Apoio of the companion), on its own row. */
  .nested-roll__extra {
    flex: 1 1 100%;
    min-width: 0;
    color: var(--fusion-text-muted);
    overflow-wrap: anywhere;
  }

  /* REQ-ACH-022: the dice of the child roll, on the row below its label, never clipped. */
  .nested-roll__breakdown {
    font-family: var(--fusion-font-mono);
    color: var(--fusion-text-muted);
    flex: 1 1 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .nested-roll__badge {
    font-weight: var(--fusion-weight-bold);
    color: var(--fusion-text);
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
    font-size: var(--fusion-text-lg);
    font-weight: var(--fusion-weight-bold);
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
    gap: var(--fusion-space-1);
  }

  .nested-saves__title {
    font-size: var(--fusion-text-sm);
    font-weight: var(--fusion-weight-bold);
    color: var(--fusion-text-muted);
  }

  .nested-save {
    display: flex;
    align-items: baseline;
    gap: var(--fusion-space-1) var(--fusion-space-2);
    font-size: var(--fusion-text-sm);
    flex-wrap: wrap;
  }

  .nested-save__alias {
    color: var(--fusion-text);
    font-weight: var(--fusion-weight-bold);
  }

  .nested-save__total {
    font-family: var(--fusion-font-mono);
    font-weight: var(--fusion-weight-bold);
    color: var(--fusion-text);
  }

  /* REQ-ACH-023: the dice of the saving throw, on the target's own line. */
  .nested-save__breakdown {
    font-family: var(--fusion-font-mono);
    color: var(--fusion-text-muted);
  }

  .nested-save__badge {
    font-weight: var(--fusion-weight-bold);
    color: var(--fusion-text);
  }

  .nested-save__badge.dos--crit-success,
  .nested-save__badge.dos--success {
    color: var(--fusion-success);
  }

  .nested-save__badge.dos--failure,
  .nested-save__badge.dos--crit-failure {
    color: var(--fusion-danger);
  }

  .nested-save__hint {
    flex: 1 1 100%;
    color: var(--fusion-text-muted);
  }

  .nested-saves__toggle {
    align-self: flex-start;
    min-height: var(--fusion-target);
    background: none;
    border: none;
    padding: 0;
    color: var(--fusion-text);
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: var(--fusion-text-sm);
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .nested-saves__toggle:hover {
    color: var(--fusion-accent-hover);
  }
</style>
