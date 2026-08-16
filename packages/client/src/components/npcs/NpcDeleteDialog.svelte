<script lang="ts">
  /**
   * NpcDeleteDialog.svelte — the confirmation of the delete (spec 42 §5.7, G075).
   *
   * REQ-NPC-051: this window SHOWS what falls before anything falls — how many
   * presences the actor has and in which scenes (REQ-NPC-053), the knowledge the
   * world holds about it (REQ-NPC-054), and the sheet with its embedded items.
   * All three numbers come from the server's own reading (`actor:deletePreview`),
   * never from a count made here: a scene this seat never received is not in the
   * mirror, and a locally-derived number could disagree with the rule the server
   * applies a second later — which is the one thing a confirmation must not do.
   *
   * REQ-NPC-052: while an unfinished encounter names the actor, the delete is not
   * offered at all, and the refusal SAYS what to do about it — end the encounter,
   * or take the actor out of it. The refusal can also arrive at confirm time (an
   * encounter started between reading and confirming): the error is shown and the
   * reading is redone, so the list of encounters that block appears then too.
   *
   * REQ-NPC-055: a player's character is not deleted here, in any role. The window
   * asks `isDeletableNpcSubtype` rather than trusting its caller, so even a wrong
   * call site cannot turn this into the screen that deletes a character.
   */

  import type { Socket } from "socket.io-client";
  import type { ActorDeletePreviewResult } from "@fusion/shared";
  import { KnowledgeState } from "@fusion/shared";

  import { t } from "../../lib/i18n/i18n.js";
  import { OpError } from "../../lib/docs/sendOp.js";
  import {
    deleteNpc,
    isDeletableNpcSubtype,
    isDeleteBlocked,
    knowledgeFalls,
    loadActorDeletePreview,
  } from "../../lib/npcs/deleteNpc.js";

  const {
    socket,
    actorId,
    name,
    subtype,
    initialPreview = null,
    onClose,
  }: {
    socket: Socket;
    actorId: string;
    name: string;
    subtype: string;
    /**
     * A reading already in hand. The window passes none — the dialog asks for its
     * own — and a caller that has one seeds it here instead of causing a second
     * round trip for numbers it already holds.
     */
    initialPreview?: ActorDeletePreviewResult | null;
    onClose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let preview = $state<ActorDeletePreviewResult | null>(initialPreview);
  // svelte-ignore state_referenced_locally
  let loading = $state(initialPreview === null);
  let busy = $state(false);
  let error = $state<string | null>(null);

  /** REQ-NPC-055: asked here, not assumed of the caller. */
  const deletableSubtype = $derived(isDeletableNpcSubtype(subtype));

  const blocked = $derived(isDeleteBlocked(preview));

  $effect(() => {
    if (initialPreview !== null) return;
    void refresh();
  });

  async function refresh(): Promise<void> {
    loading = true;
    try {
      preview = await loadActorDeletePreview(socket, actorId);
    } catch (err) {
      report(err);
    } finally {
      loading = false;
    }
  }

  function report(err: unknown): void {
    error = err instanceof OpError ? err.message : String(err);
  }

  /** REQ-NPC-050: the delete itself, and the refusal shown rather than swallowed. */
  async function onConfirm(): Promise<void> {
    if (busy || blocked || !deletableSubtype) return;
    busy = true;
    error = null;
    try {
      const done = await deleteNpc(socket, actorId, subtype);
      if (done) {
        onClose();
        return;
      }
    } catch (err) {
      report(err);
      // REQ-NPC-052: an encounter may have started while this window was open.
      // Re-reading turns the server's sentence into the list of encounters that
      // block, so the reader gets the path out and not only the complaint.
      await refresh();
    } finally {
      busy = false;
    }
  }

  /** The pt-BR name of a knowledge state, for the general rule of REQ-CTT-072. */
  function knowledgeStateLabel(state: KnowledgeState): string {
    if (state === KnowledgeState.Known) return t("FUSION.Contacts.Knowledge.State.Known");
    if (state === KnowledgeState.Glimpsed) return t("FUSION.Contacts.Knowledge.State.Glimpsed");
    return t("FUSION.Contacts.Knowledge.State.Hidden");
  }
</script>

<div class="npc-delete" data-npc-delete data-npc-delete-id={actorId}>
  <p class="npc-delete__question">{t("FUSION.Npcs.Delete.Question", { name })}</p>

  {#if !deletableSubtype}
    <!-- REQ-NPC-055: this tab does not delete a player's character, in any role. -->
    <p class="npc-delete__blocked" role="alert" data-delete-not-here>
      {t("FUSION.Npcs.Delete.NotHere")}
    </p>
  {:else if loading && preview === null}
    <p class="npc-delete__hint" data-delete-loading>{t("FUSION.Npcs.Delete.Loading")}</p>
  {:else if preview !== null}
    <!-- REQ-NPC-051: what will be removed along with the actor, in three parts. -->
    <section class="npc-delete__falls" data-delete-falls>
      <h3 class="npc-delete__heading">{t("FUSION.Npcs.Delete.Falls")}</h3>

      <!-- REQ-NPC-053: how many presences, and in which scenes — nothing of any
           single one of them, exactly as the row itself shows them. -->
      {#if preview.presenceCount > 0}
        <p class="npc-delete__line" data-delete-presence={preview.presenceCount}>
          {t("FUSION.Npcs.Delete.Presence", { count: preview.presenceCount })}
        </p>
        <ul class="npc-delete__scenes">
          {#each preview.presences as presence (presence.sceneId)}
            <li class="npc-delete__scene" data-delete-scene={presence.sceneId}>
              {t("FUSION.Npcs.Presence.InScene", {
                count: presence.presenceCount,
                scene: presence.sceneName,
              })}
            </li>
          {/each}
        </ul>
      {:else}
        <p class="npc-delete__line" data-delete-presence="0">
          {t("FUSION.Npcs.Delete.NoPresence")}
        </p>
      {/if}

      <!-- REQ-NPC-054: the knowledge recorded about the actor — the general rule
           and the exceptions — stops existing with it. -->
      {#if knowledgeFalls(preview.knowledge)}
        <p class="npc-delete__line" data-delete-knowledge={preview.knowledge.exceptionCount}>
          {t("FUSION.Npcs.Delete.Knowledge", {
            known: preview.knowledge.knownBy,
            glimpsed: preview.knowledge.glimpsedBy,
            exceptions: preview.knowledge.exceptionCount,
            general: knowledgeStateLabel(preview.knowledge.general),
          })}
        </p>
      {:else}
        <p class="npc-delete__line" data-delete-knowledge="0">
          {t("FUSION.Npcs.Delete.NoKnowledge")}
        </p>
      {/if}

      <!-- REQ-NPC-051: the sheet and its embedded items go with the actor. -->
      <p class="npc-delete__line" data-delete-items={preview.itemCount}>
        {t("FUSION.Npcs.Delete.Items", { count: preview.itemCount })}
      </p>
    </section>

    {#if blocked}
      <!-- REQ-NPC-052: refused, with the encounters named and the way out spelled
           out — a refusal that does not say how to proceed is just a wall. -->
      <section class="npc-delete__blocked" role="alert" data-delete-blocked="true">
        <p class="npc-delete__line">{t("FUSION.Npcs.Delete.Blocked", { name })}</p>
        <ul class="npc-delete__combats">
          {#each preview.blockingCombats as combat (combat.combatId)}
            <li data-delete-combat={combat.combatId}>
              {t("FUSION.Npcs.Delete.BlockedIn", {
                scene: combat.sceneName,
                count: combat.combatantCount,
              })}
            </li>
          {/each}
        </ul>
        <p class="npc-delete__line" data-delete-unblock>{t("FUSION.Npcs.Delete.Unblock")}</p>
      </section>
    {/if}
  {/if}

  {#if error !== null}
    <p class="npc-delete__error" role="alert" data-delete-error>
      {t("FUSION.Npcs.Delete.Failed", { message: error })}
    </p>
  {/if}

  <div class="npc-delete__actions">
    <button class="npc-delete__btn" type="button" data-action="cancel-delete" onclick={onClose}>
      {t("FUSION.Npcs.Delete.Cancel")}
    </button>
    <button
      class="npc-delete__btn npc-delete__btn--danger"
      type="button"
      data-action="confirm-delete"
      disabled={busy || blocked || !deletableSubtype || preview === null}
      onclick={() => void onConfirm()}
    >
      {t("FUSION.Npcs.Delete.Confirm")}
    </button>
  </div>
</div>

<style>
  .npc-delete {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    font-family: var(--fusion-font);
    font-size: 0.8125rem;
    color: var(--fusion-text);
  }

  .npc-delete__question {
    margin: 0;
    font-weight: 600;
  }

  .npc-delete__heading {
    margin: 0 0 0.25rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--fusion-text-muted);
  }

  .npc-delete__falls {
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    padding: 0.5rem;
    background: var(--fusion-surface-alt);
  }

  .npc-delete__line {
    margin: 0.125rem 0;
  }

  .npc-delete__scenes,
  .npc-delete__combats {
    list-style: none;
    margin: 0.125rem 0 0;
    padding: 0 0 0 0.75rem;
    color: var(--fusion-text-muted);
    font-size: 0.75rem;
  }

  .npc-delete__blocked {
    border: 1px solid var(--fusion-danger);
    border-radius: var(--fusion-radius-sm);
    padding: 0.5rem;
    color: var(--fusion-danger);
  }

  .npc-delete__hint {
    margin: 0;
    color: var(--fusion-text-muted);
  }

  .npc-delete__error {
    margin: 0;
    color: var(--fusion-danger);
  }

  .npc-delete__actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.375rem;
    margin-top: auto;
  }

  .npc-delete__btn {
    font: inherit;
    font-size: 0.8125rem;
    padding: 0.25rem 0.75rem;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
    cursor: pointer;
    transition: var(--fusion-transition);
  }

  .npc-delete__btn:hover:not(:disabled),
  .npc-delete__btn:focus-visible {
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .npc-delete__btn--danger:hover:not(:disabled),
  .npc-delete__btn--danger:focus-visible {
    border-color: var(--fusion-danger);
    color: var(--fusion-danger);
  }

  .npc-delete__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
