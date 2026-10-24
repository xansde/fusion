<script lang="ts">
  /**
   * PartyStrip.svelte — the Mestre's strip of party chips, at the centre-bottom of the table.
   *
   * It takes the place of the action bar while the bar draws nothing (a Mestre with no token that
   * has a bar selected) and gives way as soon as the bar appears (`barHeight` is 0 when it is not
   * drawn). One small chip per player character, side by side, kept live by the world mirror:
   * portrait, name, and the system's chip body (`registerActorChip`: hit points, defense,
   * conditions) — with none registered, the generic hit points. The strip scrolls on its own when
   * the chips do not fit; the page never does.
   *
   * Hover (or keyboard focus) on a chip opens the system's full summary in a popover above the
   * strip; a click opens the full sheet. Only the Mestre sees it; the data a player may not see is
   * not in his mirror to begin with.
   */

  import type { Socket } from "socket.io-client";

  import { worldMirror } from "../../lib/docs/worldSync.js";
  import { makeSendOpFn } from "../../lib/docs/sendOp.js";
  import { getSocket } from "../../lib/session.svelte.js";
  import { t } from "../../lib/i18n/i18n.js";
  import { openActorSheet } from "../../lib/sheets/openActorSheet.js";
  import {
    resolveActorChip,
    resolveActorSummary,
  } from "../../lib/sheets/actorSummaryRegistry.svelte.js";
  import { displayName } from "../../lib/docs/displayName.js";
  import {
    genericHp,
    placePartyPopover,
    selectPartyActors,
    shouldShowPartyStrip,
  } from "../../lib/party/partyVM.js";
  import type { ContactActorDoc } from "../../lib/contacts/contactsVM.js";
  import { barHeight } from "../../lib/actionbar/barFootprint.svelte.js";
  import { computeBarLayout } from "../../lib/actionbar/layout.js";
  import { isDrawerOpen } from "../../lib/sidebar/drawerLayout.svelte.js";
  import ActorPortrait from "$lib/components/common/ActorPortrait.svelte";

  interface Props {
    /** The socket the table was opened with; the live one is asked for on every use. */
    socket: Socket;
    worldId: string;
    userId: string;
    isGm: boolean;
  }

  const { socket, worldId, userId, isGm }: Props = $props();

  /** Width of the summary popover; the summary adapts to it by container query. */
  const POPOVER_WIDTH = 340;

  let actors = $state<ContactActorDoc[]>(worldMirror.getByType<ContactActorDoc>("Actor"));

  $effect(() => {
    const unsubscribe = worldMirror.subscribe<ContactActorDoc>("Actor", (docs) => {
      actors = docs;
    });
    actors = worldMirror.getByType<ContactActorDoc>("Actor");
    return unsubscribe;
  });

  let viewportWidth = $state(1280);
  let viewportHeight = $state(720);
  const layout = $derived(computeBarLayout({ viewportWidth, drawerOpen: isDrawerOpen() }));

  const party = $derived(isGm ? selectPartyActors(actors, userId) : []);
  const visible = $derived(shouldShowPartyStrip(isGm, barHeight()) && party.length > 0);

  let strip = $state<HTMLElement | null>(null);
  let hovered = $state<{ id: string; left: number; width: number } | null>(null);

  const hoveredDoc = $derived(
    hovered === null ? null : (party.find((d) => d._id === hovered?.id) ?? null),
  );
  const popover = $derived.by(() => {
    if (hovered === null || strip === null) return null;
    const width = Math.min(POPOVER_WIDTH, viewportWidth - 16);
    return {
      width,
      ...placePartyPopover(hovered, { top: strip.getBoundingClientRect().top }, width, {
        width: viewportWidth,
        height: viewportHeight,
      }),
    };
  });

  function show(event: Event, doc: ContactActorDoc): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    hovered = { id: doc._id, left: rect.left, width: rect.width };
  }

  function hide(doc: ContactActorDoc): void {
    if (hovered?.id === doc._id) hovered = null;
  }

  function openSheet(doc: ContactActorDoc): void {
    hovered = null;
    openActorSheet(doc._id, doc as unknown as Record<string, unknown>, {
      userId,
      ownership: 3,
      isGm,
      worldId,
      socket,
      // Lazy socket accessor: a captured socket goes stale across a reconnect.
      sendOpFn: makeSendOpFn(() => getSocket() ?? socket),
    });
  }

  function nameOf(doc: ContactActorDoc): string {
    return displayName(doc as unknown as Record<string, unknown>);
  }
</script>

<svelte:window
  bind:innerWidth={viewportWidth}
  bind:innerHeight={viewportHeight}
  onkeydown={(event) => {
    if (event.key === "Escape") hovered = null;
  }}
/>

{#if visible && layout.width > 0}
  <div
    class="party-strip"
    data-testid="party-strip"
    style:left="{layout.centerX - layout.width / 2}px"
    style:width="{layout.width}px"
  >
    <div class="party-strip__row" bind:this={strip} role="list" aria-label={t("FUSION.Party.Strip")}>
      {#each party as doc (doc._id)}
        {@const Chip = resolveActorChip(doc.type ?? "character")}
        {@const hp = genericHp(doc)}
        <button
          type="button"
          role="listitem"
          class="party-strip__chip"
          data-actor-id={doc._id}
          title={t("FUSION.Party.OpenSheet", { name: nameOf(doc) })}
          aria-label={t("FUSION.Party.OpenSheet", { name: nameOf(doc) })}
          onclick={() => {
            openSheet(doc);
          }}
          onpointerenter={(event) => {
            show(event, doc);
          }}
          onpointerleave={() => {
            hide(doc);
          }}
          onfocus={(event) => {
            show(event, doc);
          }}
          onblur={() => {
            hide(doc);
          }}
        >
          <span class="party-strip__head">
            <ActorPortrait
              img={doc.img ?? null}
              docRef={{ table: "actors", id: doc._id }}
              name={nameOf(doc)}
              size={28}
            />
            <span class="party-strip__name">{nameOf(doc)}</span>
          </span>
          {#if Chip}
            <Chip
              doc={doc as unknown as Record<string, unknown>}
              actorId={doc._id}
              ownership={3}
              {userId}
              {isGm}
              {worldId}
            />
          {:else if hp}
            <span class="party-strip__hp">
              <span class="party-strip__hp-label">{t("FUSION.Party.Hp")}</span>
              <span class="party-strip__hp-value">{hp.value} / {hp.max}</span>
            </span>
          {/if}
        </button>
      {/each}
    </div>

    {#if hoveredDoc !== null && popover !== null}
      {@const Summary = resolveActorSummary(hoveredDoc.type ?? "character")}
      <div
        class="party-strip__popover"
        data-testid="party-strip-popover"
        style:left="{popover.left}px"
        style:bottom="{popover.bottom}px"
        style:width="{popover.width}px"
        style:max-height="{popover.maxHeight}px"
      >
        <p class="party-strip__popover-name">{nameOf(hoveredDoc)}</p>
        {#if Summary}
          <Summary
            doc={hoveredDoc as unknown as Record<string, unknown>}
            actorId={hoveredDoc._id}
            ownership={3}
            {userId}
            {isGm}
            {worldId}
          />
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Same place and free-area geometry as the action bar (`.abar`): centre-bottom, between the left
     edge and the drawer. The wrapper takes no pointer; the row inside does. No transform and no
     containment here: the popover is `position: fixed` and must be placed against the window. */
  .party-strip {
    position: absolute;
    bottom: 14px;
    z-index: var(--fusion-z-actionbar);
    box-sizing: border-box;
    display: flex;
    justify-content: center;
    pointer-events: none;
    font-family: var(--fusion-font);
    color: var(--fusion-text);
  }

  .party-strip__row {
    display: flex;
    gap: var(--fusion-space-2);
    box-sizing: border-box;
    max-width: 100%;
    padding: var(--fusion-space-2);
    overflow-x: auto;
    overflow-y: hidden;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    background: var(--fusion-surface);
    box-shadow: var(--fusion-shadow-modal);
    pointer-events: auto;
  }

  .party-strip__chip {
    display: grid;
    flex: 0 0 11.5rem;
    align-content: start;
    gap: var(--fusion-space-1);
    min-width: 0;
    padding: var(--fusion-space-1) var(--fusion-space-2);
    border: 1px solid var(--fusion-border-strong);
    border-radius: var(--fusion-radius);
    background: var(--fusion-surface);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .party-strip__chip:hover {
    border-color: var(--fusion-accent);
    background: var(--fusion-accent-dim);
  }

  .party-strip__chip:focus-visible {
    outline: 2px solid var(--fusion-focus);
    outline-offset: 1px;
  }

  .party-strip__head {
    display: flex;
    align-items: center;
    gap: var(--fusion-space-2);
    min-width: 0;
  }

  .party-strip__name {
    overflow: hidden;
    font-size: var(--fusion-text-sm);
    font-weight: var(--fusion-weight-bold);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .party-strip__hp {
    display: flex;
    justify-content: space-between;
  }

  .party-strip__hp-label {
    color: var(--fusion-text-muted);
    font-size: var(--fusion-text-xs);
  }

  .party-strip__hp-value {
    font-family: var(--fusion-font-mono);
    font-weight: var(--fusion-weight-bold);
  }

  .party-strip__popover {
    position: fixed;
    box-sizing: border-box;
    padding: var(--fusion-space-3);
    overflow-y: auto;
    border: 1px solid var(--fusion-border-strong);
    border-radius: var(--fusion-radius-lg);
    background: var(--fusion-surface);
    box-shadow: var(--fusion-shadow-modal);
    pointer-events: none;
  }

  .party-strip__popover-name {
    margin: 0 0 var(--fusion-space-2);
    font-size: var(--fusion-text-md);
    font-weight: var(--fusion-weight-bold);
  }
</style>
