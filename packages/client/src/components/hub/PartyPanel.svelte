<script lang="ts">
  /**
   * PartyPanel.svelte — the Comitiva panel of the Hub (spec 28).
   *
   * REQ-HUB-043..048: one row per active player character — name, portrait,
   * HP bar and active conditions — expandable in place for detail, refreshed
   * live from the DocumentMirror. Read-only by design: the panel shows state
   * and never edits it (REQ-HUB-048); with no edit affordances there is no
   * sheet-opening plumbing to carry.
   *
   * Visibility is the server's: the mirror only ever holds what the redaction
   * layer sent this user (REQ-HUB-045), so rendering "everything the mirror
   * has" *is* the correct per-user cut.
   */

  import { worldMirror } from "$lib/docs/index.js";
  import { HUB_SURFACE_CLASS } from "$lib/hub/layers.js";
  import {
    selectPartyActors,
    buildPartyMember,
    type PartyActorDoc,
    type PartyMemberVM,
  } from "$lib/hub/partyRoster.js";
  import ActorPortrait from "../common/ActorPortrait.svelte";

  let actors = $state<PartyActorDoc[]>(worldMirror.getByType<PartyActorDoc>("Actor"));
  let expandedId = $state<string | null>(null);

  $effect(() => {
    // subscribe() only notifies on change, so re-read on attach to cover any
    // ops applied between component init and this effect running. Every Actor
    // change thereafter lands here — REQ-HUB-047's "tempo real".
    actors = worldMirror.getByType<PartyActorDoc>("Actor");
    return worldMirror.subscribe<PartyActorDoc>("Actor", (docs) => {
      actors = docs;
    });
  });

  const members = $derived<PartyMemberVM[]>(selectPartyActors(actors).map(buildPartyMember));

  function toggle(id: string): void {
    expandedId = expandedId === id ? null : id;
  }

  function hpTone(fraction: number): string {
    if (fraction <= 0.25) return "bad";
    if (fraction <= 0.5) return "warn";
    return "ok";
  }
</script>

<div class="party {HUB_SURFACE_CLASS}">
  {#if members.length === 0}
    <p class="empty">
      Nenhum personagem de jogador na mesa — a comitiva nasce quando um personagem ganha um dono.
    </p>
  {:else}
    <ul class="roster">
      {#each members as member (member.id)}
        <li class="member">
          <button
            type="button"
            class="row"
            aria-expanded={expandedId === member.id}
            onclick={() => toggle(member.id)}
          >
            <ActorPortrait img={member.img} name={member.name} size={36} />
            <span class="who">
              <span class="name">{member.name}</span>
              {#if member.hp}
                <span class="hpbar" role="presentation">
                  <span
                    class="hpfill tone-{hpTone(member.hpFraction)}"
                    style="width: {member.hpFraction * 100}%"
                  ></span>
                </span>
              {/if}
            </span>
            <span class="vitals">
              {#if member.hp}
                <span class="hpnum">
                  {member.hp.value}<span class="hpmax">/{member.hp.max}</span>
                  {#if member.hp.temp > 0}<span class="hptemp">+{member.hp.temp}</span>{/if}
                </span>
              {:else}
                <span class="hpnum hpnone">—</span>
              {/if}
            </span>
          </button>

          {#if member.conditions.length > 0}
            <div class="chips">
              {#each member.conditions as condition (condition.key)}
                <span class="chip">
                  {condition.label}{#if condition.value !== undefined}&nbsp;{condition.value}{/if}
                </span>
              {/each}
            </div>
          {/if}

          {#if expandedId === member.id}
            <dl class="detail">
              <div class="fact">
                <dt>Pontos de vida</dt>
                <dd>
                  {#if member.hp}
                    {member.hp.value} de {member.hp.max}
                    {#if member.hp.temp > 0}(+{member.hp.temp} temporários){/if}
                  {:else}
                    sem dados
                  {/if}
                </dd>
              </div>
              {#if member.heroPoints}
                <div class="fact">
                  <dt>Pontos de herói</dt>
                  <dd>{member.heroPoints.value} de {member.heroPoints.max}</dd>
                </div>
              {/if}
              <div class="fact">
                <dt>Condições</dt>
                <dd>
                  {#if member.conditions.length === 0}
                    nenhuma
                  {:else}
                    {member.conditions
                      .map((c) => (c.value !== undefined ? `${c.label} ${c.value}` : c.label))
                      .join(", ")}
                  {/if}
                </dd>
              </div>
            </dl>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .party {
    display: block;
  }

  .empty {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--fusion-sw-dim);
  }

  .roster {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .member {
    border: 1px solid var(--fusion-sw-line);
    background: var(--fusion-sw-fill);
    padding: 8px 10px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row:focus-visible {
    outline: 2px solid var(--fusion-sw-blue);
    outline-offset: 2px;
  }

  .who {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .name {
    font: 600 13px var(--fusion-sw-font);
    color: var(--fusion-sw-ink);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hpbar {
    display: block;
    height: 4px;
    background: var(--fusion-sw-line);
    overflow: hidden;
  }

  .hpfill {
    display: block;
    height: 100%;
  }
  .hpfill.tone-ok {
    background: var(--fusion-sw-ok);
  }
  .hpfill.tone-warn {
    background: var(--fusion-sw-gold);
  }
  .hpfill.tone-bad {
    background: var(--fusion-sw-bad);
  }

  .vitals {
    flex-shrink: 0;
  }

  .hpnum {
    font: 700 13px var(--fusion-sw-font-mono);
    color: var(--fusion-sw-ink);
  }
  .hpmax {
    font-weight: 400;
    color: var(--fusion-sw-dim);
  }
  .hptemp {
    margin-left: 4px;
    font-size: 11px;
    color: var(--fusion-sw-blue);
  }
  .hpnone {
    color: var(--fusion-sw-dim);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }

  .chip {
    font: 600 10px var(--fusion-sw-font);
    letter-spacing: var(--fusion-sw-track-label);
    text-transform: uppercase;
    color: var(--fusion-sw-gold);
    border: 1px solid var(--fusion-sw-gold);
    padding: 2px 6px;
  }

  .detail {
    margin: 8px 0 0;
    padding-top: 8px;
    border-top: 1px dashed var(--fusion-sw-line);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .fact {
    display: flex;
    gap: 8px;
    font-size: 12px;
    line-height: 1.5;
  }
  .fact dt {
    flex-shrink: 0;
    width: 120px;
    margin: 0;
    color: var(--fusion-sw-dim);
    text-transform: uppercase;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: var(--fusion-sw-track-label);
    padding-top: 2px;
  }
  .fact dd {
    margin: 0;
    color: var(--fusion-sw-ink);
  }
</style>
