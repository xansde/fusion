<script lang="ts">
  /**
   * MapNotePopup - the window of a map pin: reads it for everyone, edits it for the GM
   * (and, for title/text, for a player when the GM allowed that pin), and writes a new
   * pin where the GM clicked while placing.
   */
  import { onMount } from "svelte";
  import Icon from "./common/Icon.svelte";
  import type { MapNote } from "@fusion/shared";
  import { worldMirror } from "../lib/docs/worldSync.js";
  import { activeSceneState } from "../lib/docs/activeScene.svelte.js";
  import { sendOp } from "../lib/docs/sendOp.js";
  import { getSocket, session } from "../lib/session.svelte.js";
  import { noteUi, closeNoteWindow } from "../lib/notes/noteUi.svelte.js";
  import {
    visibleNotes,
    noteAbilities,
    draftIsValid,
    createPayload,
    updatePayload,
    EMPTY_DRAFT,
    type NoteDraft,
  } from "../lib/notes/noteModel.js";

  const isGm = $derived((session.user?.role ?? 0) >= 3);
  const sceneId = $derived(activeSceneState.id);

  // The mirror is not reactive: bump a counter on every Scene change.
  let tick = $state(0);
  onMount(() => {
    return worldMirror.subscribe("Scene", () => {
      tick++;
    });
  });

  const notes = $derived.by(() => {
    void tick;
    if (!sceneId) return [] as MapNote[];
    const scene = worldMirror.getDoc<Record<string, unknown>>("Scene", sceneId);
    return visibleNotes(scene?.["notes"], isGm);
  });

  const open = $derived(notes.find((n) => n.id === noteUi.openId) ?? null);
  const abilities = $derived(open ? noteAbilities(open, isGm) : null);
  const creating = $derived(noteUi.draftAt !== null);

  let draft = $state<NoteDraft>({ ...EMPTY_DRAFT });
  let editing = $state(false);
  let error = $state<string | null>(null);
  let busy = $state(false);

  // Seed the form whenever a different pin (or a new draft) opens.
  let seededFor: string | null = null;
  $effect(() => {
    const key = noteUi.draftAt ? "draft" : (open?.id ?? null);
    if (key === seededFor) return;
    seededFor = key;
    error = null;
    if (noteUi.draftAt) {
      draft = { ...EMPTY_DRAFT };
      editing = true;
    } else if (open) {
      draft = {
        title: open.title,
        text: open.text,
        gmOnly: open.gmOnly,
        playersCanEdit: open.playersCanEdit,
      };
      editing = false;
    }
  });

  async function run(type: string, payload: unknown): Promise<boolean> {
    const sock = getSocket();
    if (!sock) {
      error = "Sem conexão com o servidor.";
      return false;
    }
    busy = true;
    error = null;
    try {
      await sendOp(sock, { type, payload } as never);
      return true;
    } catch (e) {
      error = e instanceof Error ? e.message : "Não foi possível salvar.";
      return false;
    } finally {
      busy = false;
    }
  }

  async function save(): Promise<void> {
    if (!sceneId || !draftIsValid(draft)) return;
    if (noteUi.draftAt) {
      if (await run("scene:noteCreate", createPayload(sceneId, noteUi.draftAt, draft))) {
        closeNoteWindow();
      }
    } else if (open) {
      if (await run("scene:noteUpdate", updatePayload(sceneId, open, draft, isGm))) {
        editing = false;
      }
    }
  }

  async function remove(): Promise<void> {
    if (!sceneId || !open) return;
    if (await run("scene:noteDelete", { sceneId, noteId: open.id })) closeNoteWindow();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape" && (open || creating)) closeNoteWindow();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if open || creating}
  <aside class="note-win" aria-label={creating ? "Novo pino" : open?.title}>
    <header class="note-win__head">
      <h2 class="note-win__title">
        {creating ? "Novo pino" : (open?.title ?? "")}
        {#if open?.gmOnly}<span class="note-win__tag">só o Mestre</span>{/if}
      </h2>
      <button type="button" class="note-win__x" aria-label="Fechar" onclick={closeNoteWindow}>
        <Icon name="x" size={20} />
      </button>
    </header>

    {#if editing}
      <form
        class="note-win__form"
        onsubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          <span>Título</span>
          <input type="text" maxlength="80" bind:value={draft.title} />
        </label>
        <label>
          <span>Texto</span>
          <textarea rows="5" maxlength="1000" bind:value={draft.text}></textarea>
        </label>
        {#if isGm}
          <label class="note-win__check">
            <input type="checkbox" bind:checked={draft.gmOnly} />
            <span>Só o Mestre vê</span>
          </label>
          <label class="note-win__check">
            <input type="checkbox" bind:checked={draft.playersCanEdit} />
            <span>Jogadores podem editar o texto</span>
          </label>
        {/if}
        <div class="note-win__row">
          <button type="submit" class="note-win__btn note-win__btn--primary" disabled={busy || !draftIsValid(draft)}>
            Salvar
          </button>
          <button
            type="button"
            class="note-win__btn"
            onclick={() => {
              if (creating) closeNoteWindow();
              else editing = false;
            }}>Cancelar</button
          >
        </div>
      </form>
    {:else if open}
      <p class="note-win__text">{open.text || "(sem texto)"}</p>
      <div class="note-win__row">
        {#if abilities?.editText}
          <button
            type="button"
            class="note-win__btn"
            onclick={() => {
              editing = true;
            }}>Editar</button
          >
        {/if}
        {#if abilities?.manage}
          <button type="button" class="note-win__btn" disabled={busy} onclick={() => void remove()}>
            Excluir
          </button>
        {/if}
      </div>
    {/if}
    {#if error}<p class="note-win__err" role="alert">{error}</p>{/if}
  </aside>
{/if}

<style>
  .note-win {
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    box-shadow: var(--fusion-shadow-popover);
    color: var(--fusion-text);
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: calc(100vw - 2rem);
    padding: 0.6rem 0.8rem 0.8rem;
    position: fixed;
    right: 1rem;
    top: calc(var(--fusion-header-height) + 0.75rem);
    width: 21rem;
    z-index: 150;
  }

  .note-win__head {
    align-items: center;
    display: flex;
    gap: 0.5rem;
    justify-content: space-between;
  }

  .note-win__title {
    font-size: var(--fusion-text-md);
    margin: 0;
    overflow-wrap: anywhere;
  }

  .note-win__tag {
    background: var(--fusion-magic-dim);
    border: 1px solid var(--fusion-magic);
    border-radius: var(--fusion-radius-pill);
    color: var(--fusion-magic);
    font-size: var(--fusion-text-xs);
    font-weight: 600;
    margin-left: 0.4rem;
    padding: 0.05rem 0.4rem;
    vertical-align: middle;
  }

  .note-win__x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: var(--fusion-target);
    height: var(--fusion-target);
    padding: 0;
    border: 0;
    border-radius: var(--fusion-radius);
    background: transparent;
    color: var(--fusion-text-muted);
    cursor: pointer;
  }

  .note-win__text {
    margin: 0;
    max-height: 40vh;
    overflow-y: auto;
    white-space: pre-wrap;
  }

  .note-win__form {
    display: flex;
    flex-direction: column;
    font-size: var(--fusion-text-sm);
    gap: 0.45rem;
  }

  .note-win__form label {
    color: var(--fusion-text-muted);
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .note-win__form input[type="text"],
  .note-win__form textarea {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font-family: var(--fusion-font);
    padding: 0.25rem 0.4rem;
    resize: vertical;
  }

  .note-win__check {
    align-items: center;
    flex-direction: row !important;
    gap: 0.4rem !important;
  }

  .note-win__row {
    display: flex;
    gap: 0.4rem;
  }

  .note-win__btn {
    background: transparent;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: var(--fusion-text-sm);
    padding: 0.25rem 0.6rem;
  }

  .note-win__btn--primary {
    background: var(--fusion-accent);
    border-color: var(--fusion-accent);
    color: var(--fusion-bg);
  }

  .note-win__btn:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .note-win__err {
    color: var(--fusion-danger);
    font-size: var(--fusion-text-sm);
    margin: 0;
  }
</style>
