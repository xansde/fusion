<script lang="ts">
  /**
   * PartyPanel.svelte — the Mestre's table of player characters (drawer tab "party", group "gm").
   *
   * One card per player character, side by side, kept live by the world mirror. What a card SHOWS
   * is the game system's summary component (`actorSummaryRegistry`); with none registered it falls
   * back to the generic hit points. The card header opens the full sheet. Only the Mestre has this
   * tab (the registry hides "gm" tabs from players) and the panel draws nothing for anyone else:
   * hiding is ergonomics, and the data a player may not see is not in his mirror to begin with.
   */

  import type { SidebarPanelProps } from "../../lib/sidebar/registry.js";
  import { worldMirror } from "../../lib/docs/worldSync.js";
  import { makeSendOpFn } from "../../lib/docs/sendOp.js";
  import { getSocket } from "../../lib/session.svelte.js";
  import { t } from "../../lib/i18n/i18n.js";
  import { openActorSheet } from "../../lib/sheets/openActorSheet.js";
  import { resolveActorSummary } from "../../lib/sheets/actorSummaryRegistry.svelte.js";
  import { displayName } from "../../lib/docs/displayName.js";
  import { genericHp, selectPartyActors } from "../../lib/party/partyVM.js";
  import type { ContactActorDoc } from "../../lib/contacts/contactsVM.js";
  import ActorPortrait from "$lib/components/common/ActorPortrait.svelte";

  const { socket, worldId, userId, isGm }: SidebarPanelProps = $props();

  // Seeded from the mirror at construction (the panel is mounted only while its tab is open), so
  // the first frame already draws the table the client holds.
  let actors = $state<ContactActorDoc[]>(worldMirror.getByType<ContactActorDoc>("Actor"));

  $effect(() => {
    const unsubscribe = worldMirror.subscribe<ContactActorDoc>("Actor", (docs) => {
      actors = docs;
    });
    actors = worldMirror.getByType<ContactActorDoc>("Actor");
    return unsubscribe;
  });

  const party = $derived(isGm ? selectPartyActors(actors, userId) : []);

  function openSheet(doc: ContactActorDoc): void {
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

{#if isGm}
  <div class="party-panel" data-testid="party-panel">
    {#if party.length === 0}
      <p class="party-panel__empty" data-empty="party">{t("FUSION.Party.Empty")}</p>
    {:else}
      <div class="party-panel__grid">
        {#each party as doc (doc._id)}
          {@const Summary = resolveActorSummary(doc.type ?? "character")}
          {@const hp = genericHp(doc)}
          <article class="party-card" data-actor-id={doc._id}>
            <button
              type="button"
              class="party-card__head"
              title={t("FUSION.Party.OpenSheet", { name: nameOf(doc) })}
              aria-label={t("FUSION.Party.OpenSheet", { name: nameOf(doc) })}
              onclick={() => {
                openSheet(doc);
              }}
            >
              <ActorPortrait
                img={doc.img ?? null}
                docRef={{ table: "actors", id: doc._id }}
                name={nameOf(doc)}
                size={32}
              />
              <span class="party-card__name">{nameOf(doc)}</span>
            </button>
            {#if Summary}
              <Summary
                doc={doc as unknown as Record<string, unknown>}
                actorId={doc._id}
                ownership={3}
                {userId}
                {isGm}
                {worldId}
              />
            {:else if hp}
              <p class="party-card__hp">
                <span class="party-card__hp-label">{t("FUSION.Party.Hp")}</span>
                <span class="party-card__hp-value">{hp.value} / {hp.max}</span>
              </p>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .party-panel {
    box-sizing: border-box;
    height: 100%;
    min-width: 0;
    overflow-x: hidden;
    overflow-y: auto;
    padding: var(--fusion-space-3);
    font-family: var(--fusion-font);
    color: var(--fusion-text);
  }

  .party-panel__empty {
    margin: 0;
    color: var(--fusion-text-muted);
    font-size: var(--fusion-text-sm);
  }

  /* One column on a narrow drawer, as many as fit on a wide one: never a sideways scroll. */
  .party-panel__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
    gap: var(--fusion-space-3);
  }

  .party-card {
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-2);
    min-width: 0;
    padding: var(--fusion-space-2);
    border: 1px solid var(--fusion-border-strong);
    border-radius: var(--fusion-radius);
    background: var(--fusion-surface);
  }

  .party-card__head {
    display: flex;
    align-items: center;
    gap: var(--fusion-space-2);
    min-width: 0;
    min-height: var(--fusion-target);
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .party-card__head:hover .party-card__name {
    color: var(--fusion-accent);
  }

  .party-card__head:focus-visible {
    outline: 2px solid var(--fusion-focus);
    outline-offset: 1px;
  }

  .party-card__name {
    overflow: hidden;
    font-size: var(--fusion-text-md);
    font-weight: var(--fusion-weight-bold);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .party-card__hp {
    display: flex;
    justify-content: space-between;
    margin: 0;
  }

  .party-card__hp-label {
    color: var(--fusion-text-muted);
    font-size: var(--fusion-text-sm);
  }

  .party-card__hp-value {
    font-family: var(--fusion-font-mono);
    font-weight: var(--fusion-weight-bold);
  }
</style>
