<script lang="ts">
  /**
   * ActionBar.svelte — the action bar: the shell on the table, with the content the game system
   * supplies (BAR-F1-04; spec 53 REQ-BAR-010/011, REQ-BAR-022/023/025/026, REQ-BAR-033, REQ-BAR-035,
   * REQ-BAR-104, DEC-BAR-01/05/07/09/10; prototype T1, T2, T6, T7).
   *
   * A bar at the centre-bottom of the table, always of the character (or NPC) in hand: a status strip,
   * the tabs, and the slots — golpes, magias, ações, itens, reações and testes a click or a key away,
   * without opening the sheet. The CORE draws the shell; what is in it comes from the provider the
   * system registered for the actor's type (`actionBarRegistry.resolve("Actor", actor.type)`, the
   * same criterion as the sheet).
   *
   * **Whose bar.** Only what `getActiveActor()` says. The ownership gate lives in that store, before
   * the provider (D-BA01): a player who clicks a NPC's token, or another player's, still gets their
   * own character, and no provider is ever called with the other actor — the context below is built
   * ONLY from a released actor. The Mestre with nothing selected has no bar (D-BA10), and neither
   * has an actor whose type has no provider (REQ-BAR-012): in those cases this draws nothing at all.
   *
   * **Where.** Centred in the free area between the left edge and the side drawer (REQ-BAR-022),
   * above the canvas and below the drawer and the windows (`--fusion-z-actionbar`), and folded to
   * the strip when that area drops under ~1000 px (REQ-BAR-025). The prepare notice of the Mestre
   * stacks above it (`barFootprint`).
   *
   * **D-15.** No counter of actions, no pips of "ações restantes", no lock: a cost is a glyph and
   * a faded entry is clicked all the same (REQ-BAR-104). The server decides everything.
   *
   * The behaviour — what a click does, the busy slot, errors, the tab, the fold, the strip's message —
   * is `actionBarController.svelte.ts`; the decisions about what a slot or the strip say are pure
   * modules (`slotModel`, `statusModel`, `turn`), tested without a DOM (§2.10). This file wires them.
   * **Favourites** are in the ACTOR (BAR-F3-01, REQ-BAR-061): `createFavoritesStore` reads the row off
   * the actor document and writes it back with the version lock; the first time the bar opens for an
   * actor that has none, the system's seed is written once (REQ-BAR-064). A favourite whose entry left
   * the sheet is drawn faded as an orphan (REQ-BAR-066) — after the load window, so a late pack does
   * not make a real favourite flash as "Ausente".
   *
   * Not here (D-BA16): remembering the tab or the fold on the device, drag and drop, aim mode, the
   * full slot menu (only open, pin and unpin), the NPC and group bars.
   */

  import type { Socket } from "socket.io-client";
  import { untrack } from "svelte";

  import ContextMenu from "../common/ContextMenu.svelte";
  import SlotGrid from "./SlotGrid.svelte";
  import StatusStrip from "./StatusStrip.svelte";
  import TabBar from "./TabBar.svelte";
  import {
    getActiveActor,
    noteActorUsed,
    setActiveActorProviderCheck,
  } from "../../lib/actionbar/activeActorStore.svelte.js";
  import { actionBarRegistry } from "../../lib/actionbar/actionBarRegistry.js";
  import { createActionBarController } from "../../lib/actionbar/actionBarController.svelte.js";
  import { createLiveActionBarServices } from "../../lib/actionbar/actionBarServices.js";
  import { readActorDoc } from "../../lib/actionbar/actorDocReader.svelte.js";
  import { buildActionBarContext } from "../../lib/actionbar/barContext.js";
  import { publishBarHeight } from "../../lib/actionbar/barFootprint.svelte.js";
  import { createFavoritesStore } from "../../lib/actionbar/favoritesStore.svelte.js";
  import { seedFromEntries } from "../../lib/actionbar/favoritesSource.js";
  import { computeBarLayout, menuOriginAboveBar } from "../../lib/actionbar/layout.js";
  import { ORPHAN_ARM_MS, orphanEntry } from "../../lib/actionbar/orphan.js";
  import { releaseFocusAfterPointer } from "../../lib/actionbar/slotFocus.js";
  import { mapHint } from "../../lib/actionbar/slotModel.js";
  import { runSlotMenuItem, slotMenuItems } from "../../lib/actionbar/slotMenu.js";
  import { conditionIdsOf } from "../../lib/actionbar/statusModel.js";
  import { endTurnAvailable, turnView, type TurnView } from "../../lib/actionbar/turn.js";
  import type { ActionBarEntry, ActionBarProvider } from "../../lib/actionbar/types.js";
  import { registerActionBarShortcuts } from "../../lib/actionbar/actionBarShortcuts.js";
  import { combatStore, getMyTargets } from "../../lib/combat/combatStore.svelte.js";
  import { ownedActorIdsOf } from "../../lib/combat/combatBadge.svelte.js";
  import { worldMirror } from "../../lib/docs/worldSync.js";
  import { t } from "../../lib/i18n/i18n.js";
  import { getSocket } from "../../lib/session.svelte.js";
  import { isDrawerOpen } from "../../lib/sidebar/drawerLayout.svelte.js";

  interface Props {
    /** The socket the table was opened with; the live one is asked for on every use. */
    socket: Socket;
    worldId: string;
    userId: string;
    /** The privileged seat (role ≥ ASSISTANT, `isRolePrivileged`) — the one that may see any actor's bar. */
    isGm: boolean;
  }

  const { socket, worldId, userId, isGm }: Props = $props();

  // -------------------------------------------------------------------------
  // Who the bar is for
  // -------------------------------------------------------------------------

  // An actor without a provider never becomes the active one (REQ-BAR-009, I6): the store asks the
  // registry. The registry is reactive, so a provider that registers after the first paint
  // (`registerPf2eSheets` runs in `onMount`) brings the bar up by itself.
  setActiveActorProviderCheck((candidateId) => {
    const type = worldMirror.getDoc<Record<string, unknown>>("Actor", candidateId)?.["type"];
    return typeof type === "string" && actionBarRegistry.resolve("Actor", type) !== null;
  });

  const active = $derived(getActiveActor());

  /**
   * The provider and the context of the active actor, or null when there is no bar. The context is
   * built only from `kind: "actor"` — the shape the gate releases (§2.4).
   */
  const bar = $derived.by((): { ctx: ReturnType<typeof buildActionBarContext>; provider: ActionBarProvider } | null => {
    if (active.kind !== "actor") return null;
    const actor = readActorDoc(active.actorId);
    if (actor === undefined) return null;
    const type = actor["type"];
    const provider = typeof type === "string" ? actionBarRegistry.resolve("Actor", type) : null;
    if (provider === null) return null;
    const ctx = buildActionBarContext({
      active,
      actor,
      viewer: { userId, isGm },
      combat: combatStore.combat,
      ownedActorIds: ownedActorIdsOf(worldMirror.getByType<Record<string, unknown>>("Actor"), userId),
      targets: getMyTargets(),
    });
    return { ctx, provider };
  });

  /** A provider that throws must not take the table down: log it and draw no bar. */
  function guarded<T>(what: string, fallback: T, run: () => T): T {
    try {
      return run();
    } catch (error) {
      console.error(`[actionbar] provider.${what} failed`, error);
      return fallback;
    }
  }

  const entries = $derived(
    bar === null ? [] : guarded<ActionBarEntry[]>("entries", [], () => bar.provider.entries(bar.ctx)),
  );
  const status = $derived(
    bar === null ? null : guarded("status", null, () => bar.provider.status(bar.ctx)),
  );
  const resolved = $derived(
    bar !== null && status !== null
      ? {
          ctx: bar.ctx,
          provider: bar.provider,
          entries,
          conditionIds: conditionIdsOf(status),
        }
      : null,
  );
  const actorId = $derived(bar?.ctx.actorId ?? null);
  const Details = $derived(bar?.provider.details);

  // -------------------------------------------------------------------------
  // What it does
  // -------------------------------------------------------------------------

  /**
   * The ids the first-opening seed would pin RIGHT NOW: the system's own when its provider declares
   * one, else the shell's (`seedFromEntries`). An empty answer is "nothing to seed yet" (the provider
   * has not loaded), and the seed waits; a provider that throws falls back to the shell's.
   */
  function seedIds(): readonly string[] {
    if (bar === null) return [];
    const { provider, ctx } = bar;
    return guarded<readonly string[]>("seed", seedFromEntries(entries), () =>
      provider.seed !== undefined ? provider.seed(ctx) : seedFromEntries(entries),
    );
  }

  // The favourites live in the actor. The store follows the actor, not every redraw: it is rebuilt
  // only when the active actor changes, and its writes queue behind any still on the wire for the same actor.
  const favorites = $derived(
    actorId === null
      ? null
      : createFavoritesStore({
          actorId,
          readActor: () => readActorDoc(actorId),
          write: (payload) => services.request("doc:update", payload),
          seedIds,
          notify: (message) => {
            controller.notify(message);
          },
        }),
  );

  const services = $derived(
    createLiveActionBarServices({
      getSocket: () => getSocket() ?? socket,
      worldId,
      userId,
      isGm,
      notify: (message) => {
        controller.notify(message);
      },
    }),
  );

  const controller = createActionBarController({
    current: () => resolved,
    services: () => services,
    targets: () => getMyTargets().map((target) => target.tokenId),
    favorites: () => favorites,
    noteUsed: noteActorUsed,
  });

  // What was open belonged to the other actor.
  $effect(() => {
    void actorId;
    untrack(() => {
      controller.resetForActor();
    });
  });

  // What was open on something that has since left the bar (an entry off the sheet, a condition that
  // ended) is closed for good: left open but unseen, the next Esc would be spent closing nothing.
  $effect(() => {
    void resolved;
    untrack(() => {
      controller.reconcile();
    });
  });

  // The first-opening seed (REQ-BAR-064): written once, by whoever may write the actor. Asked again
  // whenever the provider's list changes — a seed with nothing in it waits for the list.
  $effect(() => {
    const store = favorites;
    if (store === null || resolved === null) return;
    void entries;
    untrack(() => {
      store.ensureSeeded();
    });
  });

  // A favourite whose entry is missing is an orphan only after the sheet had time to load (the packs
  // that give the basic actions arrive a moment after the actor's own data).
  let orphansArmed = $state(false);
  $effect(() => {
    void actorId;
    orphansArmed = false;
    const timer = setTimeout(() => {
      orphansArmed = true;
    }, ORPHAN_ARM_MS);
    return () => {
      clearTimeout(timer);
    };
  });

  // The keys 1–9, 0, − and = run the favourites, Esc cancels a menu (BAR-F1-05).
  $effect(() => registerActionBarShortcuts(controller));

  // -------------------------------------------------------------------------
  // Where it sits
  // -------------------------------------------------------------------------

  let viewportWidth = $state(1280);
  const layout = $derived(computeBarLayout({ viewportWidth, drawerOpen: isDrawerOpen() }));

  // Under ~1000 px of free area the bar folds itself to the strip (REQ-BAR-025).
  $effect(() => {
    controller.syncNarrow(layout.narrow);
  });

  // The prepare notice stacks above the bar, whatever its height.
  let barHeight = $state(0);
  $effect(() => {
    publishBarHeight(resolved === null ? 0 : barHeight);
  });
  $effect(() => () => {
    publishBarHeight(0);
  });

  // -------------------------------------------------------------------------
  // The strip's turn and the end-of-turn button
  // -------------------------------------------------------------------------

  const turn = $derived<TurnView>(
    bar === null
      ? { kind: "out" }
      : turnView({
          combat: combatStore.combat,
          isMyTurn: bar.ctx.combat.isMyTurn,
          actorId: bar.ctx.actorId,
          viewerIsGm: isGm,
        }),
  );
  const canEndTurn = $derived(
    bar !== null &&
      endTurnAvailable({
        combat: combatStore.combat,
        isMyTurn: bar.ctx.combat.isMyTurn,
        viewerIsGm: isGm,
      }),
  );

  /** What the strike under the mouse does to the next attack (REQ-BAR-039). */
  const preview = $derived(controller.hovered === null ? null : mapHint(controller.hovered));

  // -------------------------------------------------------------------------
  // Alt: the system's detail panel in the tooltip (REQ-BAR-044)
  // -------------------------------------------------------------------------

  let altHeld = $state(false);

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Alt") return;
    altHeld = true;
    // A tapped Alt would move the focus to the browser's menu; with a detail panel to show it is ours.
    if (Details !== undefined && controller.hovered !== null) event.preventDefault();
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (event.key === "Alt") altHeld = false;
  }

  // -------------------------------------------------------------------------
  // The slot menu
  // -------------------------------------------------------------------------

  let menuAnchor = $state.raw<HTMLElement | null>(null);

  /**
   * The menu opens ABOVE the bar, at the pointer's x (prototype T1: it clears the status strip and
   * the tabs): `y` is the top edge of the bar, and the menu is placed upward from it.
   */
  function openMenu(
    entry: ActionBarEntry,
    at: { x: number; y: number },
    via: "pointer" | "keyboard",
    anchor: HTMLElement,
  ): void {
    menuAnchor = anchor;
    const barTop = anchor.closest("[data-action-bar]")?.getBoundingClientRect().top ?? at.y;
    controller.openMenu(entry.id, { x: at.x, y: menuOriginAboveBar(barTop) }, via);
  }

  const menu = $derived.by(() => {
    const open = controller.menu;
    if (open === null) return null;
    // An orphan is not in the provider's list, but it is pinned: its menu is "Desafixar".
    const entry =
      entries.find((candidate) => candidate.id === open.entryId) ??
      (favorites?.isPinned(open.entryId) === true ? orphanEntry(open.entryId) : undefined);
    return entry === undefined ? null : { entry, open };
  });

  function chooseMenuItem(itemId: string): void {
    if (actorId === null || menu === null) return;
    runSlotMenuItem(itemId, {
      actorId,
      services,
      entry: menu.entry,
      favorites: favorites ?? undefined,
    });
  }

  function endTurn(event: MouseEvent): void {
    releaseFocusAfterPointer(event, document);
    void controller.endTurn();
  }
</script>

<svelte:window bind:innerWidth={viewportWidth} onkeydown={onKeyDown} onkeyup={onKeyUp} onblur={() => (altHeld = false)} />

{#if resolved !== null && status !== null}
  <section
    class="abar"
    class:abar--collapsed={controller.collapsed}
    aria-label={t("FUSION.ActionBar.Label")}
    data-action-bar
    data-actor-id={resolved.ctx.actorId}
    style:left="{layout.centerX}px"
    style:width="{layout.width}px"
    bind:clientHeight={barHeight}
  >
    <StatusStrip
      {status}
      actorId={resolved.ctx.actorId}
      viewerIsGm={resolved.ctx.viewer.isGm}
      actorType={String(resolved.ctx.actor["type"] ?? "")}
      {turn}
      {preview}
      openCondition={controller.openCondition}
      ontogglecondition={(id) => {
        controller.toggleCondition(id);
      }}
      onclosecondition={() => {
        controller.cancel();
      }}
      collapsed={controller.collapsed}
      onexpand={() => {
        controller.toggleCollapsed();
      }}
    />

    {#if !controller.collapsed}
      <TabBar
        active={controller.tab}
        onselect={(tab) => {
          controller.setTab(tab);
        }}
        oncollapse={() => {
          controller.toggleCollapsed();
        }}
      />

      <div class="ab-slots">
        <SlotGrid
          tab={controller.tab}
          {entries}
          favorites={favorites?.slots() ?? []}
          showOrphans={orphansArmed}
          isBusy={(entryId) => controller.isBusy(entryId)}
          {altHeld}
          {Details}
          menuEntryId={controller.menu?.entryId ?? null}
          onrun={(entry) => {
            void controller.runEntry(entry);
          }}
          onorphan={() => {
            controller.notify(t("FUSION.ActionBar.Favorites.Orphan.Click"));
          }}
          oncontext={openMenu}
          onhover={(entry) => {
            controller.setHovered(entry);
          }}
          onleave={(entry) => {
            controller.clearHovered(entry);
          }}
        />

        {#if canEndTurn}
          <button type="button" class="ab-end" data-action="end-turn" onclick={endTurn}>
            {t("FUSION.ActionBar.EndTurn")}
          </button>
        {/if}
      </div>
    {/if}

    <!-- The short message of the strip: a refusal of the server, "sem alvo". -->
    <div class="abar__notice" role="status" aria-live="polite">
      {#if controller.notice !== null}<span class="abar__notice-text">{controller.notice}</span>{/if}
    </div>
  </section>

  <!-- The slot menu. Opened with the pointer, the focus is NOT handed back to the slot when it closes:
       a focused button silences the number keys (Q-BAR-07). Opened with the keyboard it is. -->
  {#if menu !== null}
    <ContextMenu
      open={true}
      items={slotMenuItems(menu.entry, favorites ?? undefined)}
      label={menu.entry.label}
      showLabel
      point={{ x: menu.open.x, y: menu.open.y }}
      placement="top-start"
      anchor={menuAnchor}
      openedBy={menu.open.via}
      restoreFocus={menu.open.via === "keyboard"}
      onselect={chooseMenuItem}
      onclose={() => {
        controller.closeMenu();
      }}
    />
  {/if}
{/if}

<style>
  /* The prototype's `.abar`: centred in the free area (the left and the width come from the
     layout), translucent, over the canvas. `--fusion-z-actionbar` puts it under the drawer and the
     windows and above the canvas and the prepare notice. */
  .abar {
    position: absolute;
    bottom: 14px;
    z-index: var(--fusion-z-actionbar);
    box-sizing: border-box;
    transform: translateX(-50%);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    background: rgba(24, 24, 31, 0.94);
    backdrop-filter: blur(6px);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    box-shadow: var(--fusion-shadow-modal);
  }

  .ab-slots {
    display: flex;
    align-items: flex-end;
    gap: 12px;
    min-height: 70px;
    padding: 2px 8px 10px 10px;
    overflow-x: auto;
  }

  .ab-end {
    flex: none;
    align-self: flex-end;
    width: 88px;
    height: 64px;
    margin-left: auto;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-accent);
    color: var(--fusion-on-accent);
    font-family: var(--fusion-font);
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.2;
    cursor: pointer;
  }

  .ab-end:hover {
    background: var(--fusion-accent-hover);
  }

  .ab-end:focus-visible {
    outline: 2px solid var(--fusion-accent-hover);
    outline-offset: 2px;
  }

  /* The toast above the bar (prototype `.toast`). The region is always there, so a screen reader
     hears the text when it appears. */
  .abar__notice {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 10px);
    transform: translateX(-50%);
    pointer-events: none;
  }

  .abar__notice-text {
    display: block;
    padding: 5px 12px;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
    font-size: 12px;
    white-space: nowrap;
    box-shadow: var(--fusion-shadow-modal);
  }
</style>
