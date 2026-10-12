<script lang="ts">
  /**
   * Slot.svelte — one entry of the action bar (BAR-F1-04; spec 53 REQ-BAR-029..032, REQ-BAR-037,
   * REQ-BAR-043..045, REQ-BAR-104, DEC-BAR-15; prototype `.slot`).
   *
   * An icon with its SHORT NAME underneath (DEC-BAR-15: without Paizo art the generic icons repeat —
   * two swords side by side — and the name settles the doubt), the cost in the top-left corner, a
   * seal in the top-right (spell rank, MAP, quantity), the key of a Favorites slot bottom-left and
   * the bonus or DC bottom-centre. The full name, the cost in words, the traits and the effect are
   * in the tooltip.
   *
   * What it decides lives in `slotModel.ts` (tested without a DOM, §2.10); this file draws it and
   * forwards the gestures to the bar:
   *
   *  - **A click runs the entry** — also when the slot is faded. Faded is a signal, not a lock
   *    (D-15, REQ-BAR-104): `aria-disabled` says it is unavailable and the tooltip says why, but the
   *    click is not swallowed, and the pointer is not a `not-allowed` one; the sheet's own function
   *    refuses, when it refuses.
   *  - **A mouse click gives the focus back** (`releaseFocusAfterPointer`, Q-BAR-07): the button
   *    would otherwise keep it and the shortcut guard would silence the number keys.
   *  - **Right-click, the menu key and Shift+F10 ask for the slot's menu**; hovering or focusing tells
   *    the bar which entry is "under the mouse" (the strip repeats a strike's "depois deste: MAP −10").
   *  - **The tooltip is the generic one** (BAR-F1-03), anchored to the button; Alt swaps it for the
   *    system's detail panel when the provider has one. Its Escape is taken by the tooltip unless
   *    the key is for something else (a text field, a dialog) — or one Escape would also drop the
   *    selected token.
   *
   * D-15: nothing here counts, spends or blocks an action. The cost is a glyph.
   */

  import type { Component } from "svelte";
  import { getContext } from "svelte";

  import Tooltip from "../common/Tooltip.svelte";
  import { isEscapeForSomethingElse } from "../../lib/canvas/tokens/token-interaction.js";
  import { i18n, t } from "../../lib/i18n/i18n.js";
  import { tooltipOffsetAboveBar } from "../../lib/actionbar/layout.js";
  import { releaseFocusAfterPointer } from "../../lib/actionbar/slotFocus.js";
  import { slotView, tooltipView } from "../../lib/actionbar/slotModel.js";
  import type { ActionBarEntry } from "../../lib/actionbar/types.js";
  import { isKeyboardFocus } from "../../lib/ui/triggerWiring.js";
  import { iconKeyFor, iconSvg } from "./icons.js";
  import {
    SLOT_ICON_SOURCE,
    resolveSlotIconUrl,
    type SlotIconSource,
  } from "../../lib/actionbar/actionBarIcons.js";
  import { fusionApi } from "../../lib/api.js";
  import { session } from "../../lib/session.svelte.js";

  interface Props {
    entry: ActionBarEntry;
    /** The key seal of a Favorites slot ("1"… "="); absent on the tabs. */
    keyLabel?: string | undefined;
    /** The key as `aria-keyshortcuts` writes it ("1", "-", "="). */
    keyShortcut?: string | undefined;
    /** The slot's own `execute` is running: a second click is ignored. */
    busy?: boolean | undefined;
    /** Alt is held: the tooltip shows the system's detail panel (when there is one). */
    altHeld?: boolean | undefined;
    /** The system's detail panel (`provider.details`). */
    Details?: Component<{ entry: ActionBarEntry }> | undefined;
    /** The slot menu of THIS slot is open: its tooltip steps aside. */
    menuOpen?: boolean | undefined;
    onrun: (entry: ActionBarEntry) => void;
    oncontext: (
      entry: ActionBarEntry,
      at: { x: number; y: number },
      via: "pointer" | "keyboard",
      anchor: HTMLElement,
    ) => void;
    onhover: (entry: ActionBarEntry) => void;
    onleave: (entry: ActionBarEntry) => void;
  }

  const {
    entry,
    keyLabel,
    keyShortcut,
    busy = false,
    altHeld = false,
    Details,
    menuOpen = false,
    onrun,
    oncontext,
    onhover,
    onleave,
  }: Props = $props();

  let button = $state<HTMLButtonElement | null>(null);
  /** Whether the mouse rests on the slot — a blur after a click must not end the hover. */
  let pointerInside = false;
  /**
   * How far above the slot the tooltip sits. The prototype (T1) puts it above the WHOLE bar, not over
   * the status strip — which, hovering a strike, is where "depois deste: MAP −10" is being shown — so
   * the gap is the distance from the slot to the top of the bar, taken when the slot is entered.
   */
  let tipOffset = $state(6);

  const view = $derived(slotView(entry));
  const tip = $derived(tooltipView(entry, i18n.locale, { hasDetails: Details !== undefined }));
  const iconMarkup = $derived(iconSvg(iconKeyFor(entry.icon, entry.kind)));
  const faded = $derived(view.state === "unavailable" || view.state === "spent");

  // BAR-F3-05: the entry's custom image (REQ-BAR-029, D-BA02). The bar hands every slot its icon
  // source by context, so SlotGrid stays as it is. The assets route answers 401 to a bare src, so the
  // image is painted only through the actor's read grant, as the portrait does (`ActorPortrait`);
  // the generic icon stays until it arrives, and comes back if it fails.
  const iconSource = getContext<SlotIconSource | undefined>(SLOT_ICON_SOURCE);
  const customIcon = $derived(iconSource?.iconOf(entry.id) ?? null);
  const iconActorId = $derived(iconSource?.actorId ?? null);
  let imageSrc = $state<string | null>(null);
  let imageFailed = $state(false);

  $effect(() => {
    imageFailed = false;
    imageSrc = null;
    const path = customIcon;
    const actorId = iconActorId;
    if (path === null || actorId === null) return;
    let cancelled = false;
    void resolveSlotIconUrl(path, actorId, {
      token: fusionApi.getToken(),
      userId: session.user?.id,
    })
      .then((url) => {
        if (cancelled) return;
        if (url === null) imageFailed = true;
        else imageSrc = url;
      })
      .catch(() => {
        if (!cancelled) imageFailed = true;
      });
    return () => {
      cancelled = true;
    };
  });

  const showImage = $derived(customIcon !== null && imageSrc !== null && !imageFailed);

  function click(event: MouseEvent): void {
    releaseFocusAfterPointer(event, document);
    onrun(entry);
  }

  function contextmenu(event: MouseEvent): void {
    event.preventDefault();
    oncontext(entry, { x: event.clientX, y: event.clientY }, "pointer", event.currentTarget as HTMLElement);
  }

  /** The menu key and Shift+F10 open the menu at the slot, for whoever has no right button. */
  function keydown(event: KeyboardEvent): void {
    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    const box = target.getBoundingClientRect();
    oncontext(entry, { x: box.left + box.width / 2, y: box.top }, "keyboard", target);
  }

  /** Measures the gap from this slot to the top of the bar (`data-action-bar`): the tooltip clears the whole bar. */
  function measureAboveBar(): void {
    const bar = button?.closest("[data-action-bar]");
    if (button === null || bar === null || bar === undefined) {
      tipOffset = 6;
      return;
    }
    tipOffset = tooltipOffsetAboveBar(
      button.getBoundingClientRect().top,
      bar.getBoundingClientRect().top,
    );
  }

  function pointerenter(event: PointerEvent): void {
    if (event.pointerType === "touch") return;
    pointerInside = true;
    measureAboveBar();
    onhover(entry);
  }

  function pointerleave(): void {
    pointerInside = false;
    onleave(entry);
  }

  /** Keyboard focus counts as hovering; the focus a mouse click leaves does not. */
  function focus(event: FocusEvent): void {
    if (!isKeyboardFocus(event.target)) return;
    measureAboveBar();
    onhover(entry);
  }

  function blur(): void {
    if (!pointerInside) onleave(entry);
  }

  /** The tooltip takes an Escape unless it is meant for a text field, a dialog or the like. */
  function takesEscape(event: KeyboardEvent): boolean {
    return !isEscapeForSomethingElse(event, document);
  }
</script>

<button
  bind:this={button}
  type="button"
  class="slot"
  class:slot--off={view.state === "unavailable"}
  class:slot--spent={view.state === "spent"}
  class:slot--on={view.state === "active"}
  class:slot--busy={busy}
  class:slot--img={showImage}
  data-entry-id={entry.id}
  data-kind={entry.kind}
  data-state={view.state}
  aria-label={view.ariaLabel}
  aria-disabled={faded ? "true" : undefined}
  aria-pressed={entry.kind === "toggle" ? (view.state === "active" ? "true" : "false") : undefined}
  aria-busy={busy ? "true" : undefined}
  aria-keyshortcuts={keyShortcut}
  onclick={click}
  oncontextmenu={contextmenu}
  onkeydown={keydown}
  onpointerenter={pointerenter}
  onpointerleave={pointerleave}
  onfocus={focus}
  onblur={blur}
>
  {#if view.costGlyph !== null}
    <i class="slot__c" aria-hidden="true">{view.costGlyph}</i>
  {/if}
  {#if view.seal !== null}
    <i class="slot__seal slot__seal--{view.seal.kind}" aria-hidden="true">{view.seal.text}</i>
  {/if}
  {#if showImage}
    <span class="slot__img" aria-hidden="true"
      ><img
        alt=""
        src={imageSrc}
        onerror={() => {
          imageFailed = true;
        }}
      /></span
    >
  {:else}
    <span class="slot__ic" aria-hidden="true">{@html iconMarkup}</span>
  {/if}
  <span class="slot__name" aria-hidden="true">{view.shortLabel}</span>
  {#if keyLabel !== undefined}
    <i class="slot__k" aria-hidden="true">{keyLabel}</i>
  {/if}
  {#if view.badge !== null}
    <i class="slot__v" aria-hidden="true">{view.badge}</i>
  {/if}
</button>

{#snippet shortTip()}
  <div class="tip__h">
    <b>{tip.title}</b>
    {#if tip.cost !== null}
      <span class="tip__c">{tip.cost.glyphs} {tip.cost.label}</span>
    {/if}
  </div>
  {#if tip.subtitle !== ""}
    <div class="tip__sub">{tip.subtitle}</div>
  {/if}
  {#if tip.traits.length > 0}
    <div class="tip__tr">
      {#each tip.traits as trait (trait)}
        <span>{trait}</span>
      {/each}
    </div>
  {/if}
  {#if tip.numbers !== null}
    <div class="tip__nm">
      {#if tip.numbers.label !== null}{tip.numbers.label}{" "}{/if}<b>{tip.numbers.value}</b>{#if tip.numbers.variant !== null}{" "}<i>({tip.numbers.variant})</i>{/if}
    </div>
  {:else if tip.effect !== null && tip.effectFigure !== null}
    <!-- The effect line already says the bonus ("Bônus +5 (base +9, MAP −4) · Dano …"): it takes the
         place of the numbers row, figure in bold, instead of saying it twice. -->
    <div class="tip__nm">{tip.effect.slice(0, tip.effectFigure.start)}<b>{tip.effect.slice(tip.effectFigure.start, tip.effectFigure.end)}</b>{tip.effect.slice(tip.effectFigure.end)}</div>
  {/if}
  {#if tip.hint !== null}
    <div class="tip__hint">{tip.hint}</div>
  {/if}
  {#if tip.effect !== null && tip.effectFigure === null}
    <p class="tip__fx">{tip.effect}</p>
  {/if}
  {#if tip.why !== null}
    <div class="tip__why">
      <b>{tip.why.kind === "spent" ? t("FUSION.ActionBar.Tooltip.Spent") : t("FUSION.ActionBar.Tooltip.Unavailable")}:</b>
      {tip.why.reason}
    </div>
  {/if}
  <div class="tip__foot">
    {tip.footer === "alt-and-menu"
      ? t("FUSION.ActionBar.Tooltip.Footer.AltAndMenu")
      : t("FUSION.ActionBar.Tooltip.Footer.Menu")}
  </div>
{/snippet}

{#snippet fullTip()}
  {#if Details !== undefined}
    <Details {entry} />
  {/if}
{/snippet}

<Tooltip
  anchor={button}
  placement="top"
  offset={tipOffset}
  openDelay={180}
  disabled={menuOpen}
  content={shortTip}
  expandedContent={Details === undefined ? undefined : fullTip}
  expanded={altHeld && Details !== undefined}
  consumeEscape={takesEscape}
/>

<style>
  /* The prototype's `.slot` (docs/design/barra-de-acoes/prototipo-barra-fiel.html), 64 px tall to
     make room for the short name under the icon (DEC-BAR-15). A grid cell or a fixed column sets
     the width. */
  .slot {
    position: relative;
    display: block;
    box-sizing: border-box;
    width: 100%;
    min-width: 52px;
    height: 64px;
    padding: 0;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text-muted);
    font-family: var(--fusion-font);
    /* A faded slot is still clickable (REQ-BAR-104): never a `not-allowed` pointer. */
    cursor: pointer;
    transition:
      color var(--fusion-transition),
      border-color var(--fusion-transition),
      background-color var(--fusion-transition);
  }

  .slot:hover {
    color: var(--fusion-text);
    border-color: var(--fusion-text-muted);
  }

  .slot:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 2px;
  }

  .slot__ic {
    position: absolute;
    left: 50%;
    top: 9px;
    width: 22px;
    height: 22px;
    margin-left: -11px;
  }

  /* The icon is injected markup, so it carries no scope class. */
  .slot__ic :global(svg) {
    display: block;
    width: 22px;
    height: 22px;
  }

  /* BAR-F3-05: the entry's custom image fills the slot under a gradient that darkens its top and its
     base (prototype T1); the marks stay above it, with a shadow, so the cost, the key, the bonus, the
     seal and the name read on any picture. */
  .slot__img {
    position: absolute;
    inset: 2px;
    overflow: hidden;
    border-radius: 5px;
  }

  .slot__img img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .slot__img::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to bottom,
      rgba(0, 0, 0, 0.55),
      rgba(0, 0, 0, 0) 34%,
      rgba(0, 0, 0, 0) 52%,
      rgba(0, 0, 0, 0.78)
    );
  }

  .slot--img .slot__c,
  .slot--img .slot__k,
  .slot--img .slot__v,
  .slot--img .slot__seal,
  .slot--img .slot__name {
    z-index: 1;
    text-shadow: 0 1px 2px #000;
  }

  .slot--img .slot__name {
    color: var(--fusion-text);
  }

  .slot__name {
    position: absolute;
    left: 3px;
    right: 3px;
    top: 35px;
    overflow: hidden;
    font-size: 10px;
    font-weight: 500;
    line-height: 12px;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .slot i {
    font-style: normal;
  }

  .slot__c {
    position: absolute;
    left: 4px;
    top: 3px;
    color: var(--fusion-text);
    font-size: 9px;
    line-height: 1;
    letter-spacing: -0.4px;
    white-space: nowrap;
  }

  .slot__k {
    position: absolute;
    left: 4px;
    bottom: 4px;
    color: var(--fusion-text-muted);
    font: 600 9px/1 var(--fusion-font-mono);
  }

  .slot__v {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 4px;
    color: var(--fusion-text);
    font: 700 10.5px/1 var(--fusion-font);
    font-variant-numeric: tabular-nums;
    text-align: center;
    white-space: nowrap;
  }

  .slot__seal {
    position: absolute;
    right: 3px;
    top: 3px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    box-sizing: border-box;
    border: 1px solid var(--fusion-border);
    border-radius: 7px;
    background: var(--fusion-surface);
    color: var(--fusion-text);
    font: 700 9px/12px var(--fusion-font);
    text-align: center;
  }

  /* Spell rank: round, accent. */
  .slot__seal--rank {
    width: 14px;
    padding: 0;
    border-color: var(--fusion-accent);
    color: var(--fusion-accent-hover);
  }

  /* Counts for the multiple attack penalty (T4). */
  .slot__seal--map {
    border-color: var(--fusion-warning);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-warning);
    font-size: 8px;
  }

  /* Faded: dimmed, with the reason in the tooltip (REQ-BAR-031). Spent until it recharges is the
     same dimming with a dashed edge. Neither is a lock (REQ-BAR-104). */
  .slot--off,
  .slot--spent {
    opacity: 0.45;
  }

  .slot--spent {
    border-style: dashed;
  }

  /* A toggle that is on: edge and a lit dot (T1, "Esgueirar"). */
  .slot--on {
    border-color: var(--fusion-accent);
    background: var(--fusion-accent-dim);
    color: var(--fusion-accent-hover);
  }

  .slot--on::after {
    content: "";
    position: absolute;
    right: 4px;
    bottom: 5px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fusion-accent);
    box-shadow: 0 0 0 2px var(--fusion-accent-dim);
  }

  /* Its own `execute` is running: a second click does nothing, and the slot says so. */
  .slot--busy {
    opacity: 0.7;
    cursor: progress;
  }

  /* ----- The tooltip's content (the box itself is the generic Tooltip's) ----- */

  .tip__h {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  .tip__h b {
    font-size: 12.5px;
  }

  .tip__c {
    color: var(--fusion-text);
    font-size: 11px;
    white-space: nowrap;
  }

  .tip__sub {
    margin-top: 1px;
    color: var(--fusion-text-muted);
  }

  .tip__tr {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 5px;
  }

  .tip__tr span {
    padding: 0 6px;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface);
    color: var(--fusion-text-muted);
    font-size: 10px;
  }

  .tip__nm {
    margin-top: 5px;
    font-variant-numeric: tabular-nums;
  }

  .tip__nm b {
    font-family: var(--fusion-font-mono);
  }

  .tip__nm i {
    color: var(--fusion-text-muted);
    font-style: normal;
  }

  .tip__hint {
    margin-top: 3px;
    color: var(--fusion-accent-hover);
  }

  .tip__fx {
    margin: 4px 0 0;
    color: var(--fusion-text-muted);
  }

  .tip__why {
    margin-top: 6px;
    padding: 4px 6px;
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-warning-dim);
    color: var(--fusion-warning);
  }

  .tip__foot {
    margin-top: 6px;
    padding-top: 5px;
    border-top: 1px solid var(--fusion-border);
    color: var(--fusion-text-muted);
    font-size: 10.5px;
  }
</style>
