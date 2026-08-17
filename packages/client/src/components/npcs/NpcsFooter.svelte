<script lang="ts">
  /**
   * NpcsFooter.svelte — the fixed footer of the NPCs tab (spec 42 §5.8, G076).
   *
   * It holds exactly the two controls REQ-NPC-062 names, and nothing else:
   *
   *  - **The chest** (REQ-NPC-060), which lands on the scene on air: clicking it
   *    runs `npcsFooter.ts`'s `placeChest` — a `doc:create` of the actor, then a
   *    `doc:update` that pushes a token for it onto the active scene. The chest
   *    is an actor (DEC-ATR-09), but never one this tab lists — no folder, no
   *    attitude, no row (REQ-NPC-061, DEC-NPC-08): the actor `placeChest`
   *    creates carries none of those fields, and this tab's own predicates do
   *    not admit its subtype.
   *  - **"Quem conhece quem"** (REQ-NPC-072), which is the SAME window the Contatos
   *    tab opens — same component, same singleton key, same op — because the open
   *    call lives once, in `lib/contacts/knowledgeWindow.ts`. A second door, not a
   *    second window and not a second model of knowledge (REQ-NPC-073).
   *
   * **Fixed** (REQ-NPC-062) means it never scrolls with the list: the element is
   * `flex: 0 0 auto`, so the panel that mounts it must place it as a sibling of the
   * scrolling `.npcs-panel__body`, never inside it.
   *
   * Split out of `NpcsPanel.svelte` on purpose: the panel is the tree and the row,
   * and the footer is neither.
   *
   * No control here alters knowledge (REQ-NPC-071) — the footer opens the window
   * where editing lives, and that is the whole of its knowledge affordance.
   */

  import type { Socket } from "socket.io-client";

  import { t } from "../../lib/i18n/i18n.js";
  import { OpError } from "../../lib/docs/sendOp.js";
  import { openKnowledgeWindow } from "../../lib/contacts/knowledgeWindow.js";
  import { chestControlState, placeChest as sendPlaceChest } from "../../lib/npcs/npcsFooter.js";

  const { socket, activeSceneId }: { socket: Socket; activeSceneId: string | null } = $props();

  const chest = $derived(chestControlState(activeSceneId));

  let error = $state<string | null>(null);

  async function placeChest(): Promise<void> {
    const sceneId = chest.sceneId;
    if (sceneId === null) return;
    error = null;
    try {
      await sendPlaceChest(socket, sceneId);
    } catch (err) {
      error = err instanceof OpError ? err.message : String(err);
    }
  }
</script>

<footer class="npcs-footer" data-npcs-footer>
  <div class="npcs-footer__row">
    <button
      class="npcs-footer__btn npcs-footer__btn--chest"
      type="button"
      data-action="place-chest"
      disabled={!chest.enabled}
      title={t(chest.labelKey)}
      aria-label={t(chest.labelKey)}
      onclick={placeChest}
    >
      <!-- Drawn glyph, never an emoji (REQ-NPC-094): a chest with a lid and a lock. -->
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
        <path
          d="M2.2 6.4h11.6v6.8H2.2zM2.2 6.4l1.6-3.4h8.4l1.6 3.4M2.2 9h11.6M7.2 9h1.6v2.1H7.2z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.2"
          stroke-linejoin="round"
        />
      </svg>
      {t("FUSION.Npcs.Footer.Chest")}
    </button>

    <button
      class="npcs-footer__btn npcs-footer__btn--wide"
      type="button"
      data-action="open-knowledge"
      title={t("FUSION.Contacts.Knowledge.Open")}
      aria-label={t("FUSION.Contacts.Knowledge.Open")}
      onclick={() => openKnowledgeWindow(socket)}
    >
      <!-- The same drawn grid the Contatos footer uses, for the same window. -->
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">
        <path
          d="M2.4 2.4h11.2v11.2H2.4zM2.4 6.1h11.2M2.4 9.9h11.2M6.1 2.4v11.2M9.9 2.4v11.2"
          fill="none"
          stroke="currentColor"
          stroke-width="1.2"
        />
      </svg>
      {t("FUSION.Npcs.Footer.Knowledge")}
    </button>
  </div>

  <!-- REQ-NPC-093: why the chest is off is said in words, not only in shade. -->
  {#if !chest.enabled}
    <p class="npcs-footer__hint" data-chest-hint>{t("FUSION.Npcs.Chest.NoScene")}</p>
  {/if}
  {#if error !== null}
    <p class="npcs-footer__hint npcs-footer__hint--error" data-chest-error>{error}</p>
  {/if}
</footer>

<style>
  /* REQ-NPC-062: the footer is fixed — it does not shrink and it does not scroll,
     so the panel mounts it beside the scrolling body, never inside it. */
  .npcs-footer {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.35rem;
    border-top: 1px solid var(--fusion-border);
    background: var(--fusion-surface);
    font-family: var(--fusion-font);
  }

  .npcs-footer__row {
    display: flex;
    gap: 0.35rem;
  }

  .npcs-footer__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    height: 1.625rem;
    min-width: 1.625rem;
    padding: 0 0.45rem;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    font: inherit;
    font-size: 0.72rem;
    cursor: pointer;
    transition: var(--fusion-transition);
  }

  .npcs-footer__btn:hover:not(:disabled),
  .npcs-footer__btn:focus-visible {
    color: var(--fusion-accent);
    border-color: var(--fusion-accent);
  }

  .npcs-footer__btn:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  /* The chest sizes to its own content — only "Quem conhece" stretches
     (prototype `.hbtn.chestb` / `.hbtn.wide`, npcs-tab.prototype.html:2467-2468). */
  .npcs-footer__btn--chest {
    flex: 0 0 auto;
    border-color: rgba(245, 166, 35, 0.5);
    color: var(--fusion-warning);
  }

  .npcs-footer__btn--chest:hover:not(:disabled),
  .npcs-footer__btn--chest:focus-visible {
    background: rgba(245, 166, 35, 0.1);
    border-color: var(--fusion-warning);
    color: var(--fusion-warning);
  }

  .npcs-footer__btn--wide {
    flex: 1 1 0;
    min-width: 0;
  }

  /* REQ-NPC-092 (REQ-UIF-064): every control says where the focus is. */
  .npcs-footer button:focus-visible {
    outline: 2px solid var(--fusion-accent);
    outline-offset: 1px;
  }

  .npcs-footer__hint {
    margin: 0;
    font-size: 0.7rem;
    color: var(--fusion-text-subtle);
  }

  .npcs-footer__hint--error {
    color: var(--fusion-danger);
  }
</style>
