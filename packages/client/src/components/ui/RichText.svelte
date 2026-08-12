<script lang="ts">
  /**
   * RichText.svelte — reusable TipTap rich-text editor.
   *
   * The document is handed around as a serialised TipTap/ProseMirror JSON
   * string (see `$lib/ui/richText.ts` for the parse/serialise helpers) rather
   * than HTML, so a consumer can store it, diff it, and hand it back without
   * ever touching the DOM. This is the base the Journal (spec 12) and the
   * quest board (spec 28, REQ-HUB-032b) build their editors on.
   *
   * `onChange` is debounced: the consumer sends the new value over the
   * network on every call, and firing on every keystroke would flood it.
   */

  import { onDestroy, onMount, untrack } from "svelte";
  import { Editor, type Content } from "@tiptap/core";
  import { StarterKit } from "@tiptap/starter-kit";
  import { Underline } from "@tiptap/extension-underline";
  import { Link } from "@tiptap/extension-link";
  import { isEmptyDoc, parseDoc, serialiseDoc } from "$lib/ui/richText.js";

  interface Props {
    value: string;
    onChange: (value: string) => void;
    readonly?: boolean;
    placeholder?: string;
    ariaLabel?: string;
  }

  const { value, onChange, readonly = false, placeholder = "", ariaLabel }: Props = $props();

  /** The consumer sends the value over the network on every call — one op per keystroke would flood it. */
  const CHANGE_DEBOUNCE_MS = 400;

  let editorEl = $state<HTMLDivElement | null>(null);
  let editor = $state<Editor | null>(null);
  // Read untracked: this seeds the initial placeholder state only. Every
  // later change comes from the editor's own onUpdate/sync handlers below,
  // not from re-reading `value` here — an actual $derived would fight those.
  let isEmpty = $state(untrack(() => isEmptyDoc(value)));
  let linkInputOpen = $state(false);
  let linkUrl = $state("");
  let active = $state({
    bold: false,
    italic: false,
    underline: false,
    bulletList: false,
    orderedList: false,
    link: false,
  });

  let changeTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleChange(next: string): void {
    if (changeTimer !== null) clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      changeTimer = null;
      onChange(next);
    }, CHANGE_DEBOUNCE_MS);
  }

  function syncActive(instance: Editor): void {
    active = {
      bold: instance.isActive("bold"),
      italic: instance.isActive("italic"),
      underline: instance.isActive("underline"),
      bulletList: instance.isActive("bulletList"),
      orderedList: instance.isActive("orderedList"),
      link: instance.isActive("link"),
    };
  }

  onMount(() => {
    if (editorEl === null) return;
    editor = new Editor({
      element: editorEl,
      // StarterKit v3 already bundles `link`/`underline`; disabled here so the
      // extensions imported explicitly below are the only ones registered —
      // otherwise TipTap warns about duplicate extension names at startup.
      extensions: [
        StarterKit.configure({ link: false, underline: false }),
        Underline,
        Link.configure({ openOnClick: false }),
      ],
      content: parseDoc(value) as Content,
      editable: !readonly,
      onUpdate: ({ editor: instance }) => {
        const json = serialiseDoc(instance.getJSON());
        isEmpty = isEmptyDoc(json);
        syncActive(instance);
        scheduleChange(json);
      },
      onSelectionUpdate: ({ editor: instance }) => syncActive(instance),
      onTransaction: ({ editor: instance }) => syncActive(instance),
    });
  });

  onDestroy(() => {
    // A pending debounce timer at unmount would otherwise silently drop the
    // last keystroke instead of ever reaching the consumer — flush it.
    if (changeTimer !== null) {
      clearTimeout(changeTimer);
      changeTimer = null;
      if (editor !== null) onChange(serialiseDoc(editor.getJSON()));
    }
    editor?.destroy();
    editor = null;
  });

  // Keep the editor's editable state in step with the `readonly` prop.
  $effect(() => {
    editor?.setEditable(!readonly);
  });

  /**
   * Mirror an externally-changed `value` into the editor — but only when it
   * actually differs from what the editor already holds. Comparing raw
   * strings would resync on every keystroke this same editor just produced
   * (the consumer typically echoes `onChange` straight back as a new
   * `value`), throwing the cursor to the start of the document on every
   * character typed. Both sides are normalised through parse+serialise so an
   * incoming "" compares equal to the editor's own canonical empty document.
   */
  $effect(() => {
    if (editor === null) return;
    const incoming = serialiseDoc(parseDoc(value));
    const current = serialiseDoc(editor.getJSON());
    if (incoming !== current) {
      editor.commands.setContent(parseDoc(value) as Content, { emitUpdate: false });
      isEmpty = isEmptyDoc(value);
    }
  });

  function toggleBold(): void {
    editor?.chain().focus().toggleBold().run();
  }
  function toggleItalic(): void {
    editor?.chain().focus().toggleItalic().run();
  }
  function toggleUnderline(): void {
    editor?.chain().focus().toggleUnderline().run();
  }
  function toggleBulletList(): void {
    editor?.chain().focus().toggleBulletList().run();
  }
  function toggleOrderedList(): void {
    editor?.chain().focus().toggleOrderedList().run();
  }

  /** The href of the link mark under the cursor, or "" when there is none. */
  function linkHref(instance: Editor): string {
    const attrs = instance.getAttributes("link");
    const href: unknown = attrs["href"];
    return typeof href === "string" ? href : "";
  }

  function toggleLinkInput(): void {
    if (editor === null) return;
    if (linkInputOpen) {
      linkInputOpen = false;
      return;
    }
    linkUrl = linkHref(editor);
    linkInputOpen = true;
  }

  function applyLink(): void {
    if (editor === null) return;
    const url = linkUrl.trim();
    const chain = editor.chain().focus().extendMarkRange("link");
    if (url === "") {
      chain.unsetLink().run();
    } else {
      chain.setLink({ href: url }).run();
    }
    linkInputOpen = false;
    linkUrl = "";
  }

  function cancelLink(): void {
    linkInputOpen = false;
    linkUrl = "";
  }

  function onLinkInputKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      applyLink();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelLink();
    }
  }
</script>

<div class="rich-text">
  {#if !readonly}
    <div class="toolbar" role="toolbar" aria-label="Formatação de texto">
      <button
        type="button"
        class="control"
        class:on={active.bold}
        onclick={toggleBold}
        aria-label="Negrito"
        aria-pressed={active.bold}
      ><strong>B</strong></button>
      <button
        type="button"
        class="control"
        class:on={active.italic}
        onclick={toggleItalic}
        aria-label="Itálico"
        aria-pressed={active.italic}
      ><em>I</em></button>
      <button
        type="button"
        class="control"
        class:on={active.underline}
        onclick={toggleUnderline}
        aria-label="Sublinhado"
        aria-pressed={active.underline}
      ><u>U</u></button>

      <span class="divider" aria-hidden="true"></span>

      <button
        type="button"
        class="control"
        class:on={active.bulletList}
        onclick={toggleBulletList}
        aria-label="Lista com marcadores"
        aria-pressed={active.bulletList}
      >&bull;&mdash;</button>
      <button
        type="button"
        class="control"
        class:on={active.orderedList}
        onclick={toggleOrderedList}
        aria-label="Lista numerada"
        aria-pressed={active.orderedList}
      >1.&mdash;</button>

      <span class="divider" aria-hidden="true"></span>

      <button
        type="button"
        class="control"
        class:on={active.link || linkInputOpen}
        onclick={toggleLinkInput}
        aria-label="Link"
        aria-pressed={active.link}
      >link</button>

      {#if linkInputOpen}
        <span class="link-bar">
          <input
            class="link-input"
            type="url"
            bind:value={linkUrl}
            placeholder="https://…"
            aria-label="URL do link"
            onkeydown={onLinkInputKeydown}
          />
          <button type="button" class="control" onclick={applyLink}>aplicar</button>
          <button type="button" class="control" onclick={cancelLink}>cancelar</button>
        </span>
      {/if}
    </div>
  {/if}

  <div class="body">
    <div
      class="content"
      bind:this={editorEl}
      aria-label={ariaLabel}
      aria-multiline={readonly ? undefined : true}
      role={readonly ? "article" : "textbox"}
    ></div>
    {#if !readonly && placeholder !== "" && isEmpty}
      <div class="placeholder" aria-hidden="true">{placeholder}</div>
    {/if}
  </div>
</div>

<style>
  .rich-text {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
  }

  .divider {
    width: 1px;
    height: 16px;
    background: var(--fusion-sw-line);
    margin: 0 2px;
  }

  .control {
    padding: 4px 9px;
    border: 1px solid var(--fusion-sw-line);
    background: var(--fusion-sw-fill);
    color: var(--fusion-sw-ink);
    font: 600 10px var(--fusion-sw-font);
    letter-spacing: var(--fusion-sw-track-label);
    text-transform: uppercase;
    cursor: pointer;
    transition: var(--fusion-sw-transition);
  }
  .control:hover {
    background: var(--fusion-sw-fill-active);
  }
  .control.on {
    border-color: var(--fusion-sw-gold);
    color: var(--fusion-sw-gold);
    background: var(--fusion-sw-fill-active);
  }

  .link-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1 1 200px;
    min-width: 200px;
  }

  .link-input {
    flex: 1;
    min-width: 0;
    padding: 4px 6px;
    border: 1px solid var(--fusion-sw-line);
    background: rgba(0, 0, 0, 0.25);
    color: var(--fusion-sw-ink);
    font-family: var(--fusion-sw-font);
    font-size: 11px;
  }

  .body {
    position: relative;
    min-height: 0;
  }

  .content {
    padding: 6px 8px;
    border: 1px solid var(--fusion-sw-line);
    background: var(--fusion-sw-fill);
    color: var(--fusion-sw-ink);
    font-family: var(--fusion-sw-font);
    font-size: 12px;
    line-height: 1.6;
    min-height: 3.2em;
    outline: none;
  }
  .content:focus-within {
    border-color: var(--fusion-sw-gold);
  }

  .content :global(p) {
    margin: 0 0 0.5em;
  }
  .content :global(p:last-child) {
    margin-bottom: 0;
  }
  .content :global(ul),
  .content :global(ol) {
    margin: 0 0 0.5em;
    padding-left: 1.4em;
  }
  .content :global(a) {
    color: var(--fusion-sw-gold);
  }

  .placeholder {
    position: absolute;
    top: 6px;
    left: 8px;
    color: var(--fusion-sw-dim);
    font-family: var(--fusion-sw-font);
    font-size: 12px;
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .control {
      transition: none;
    }
  }
</style>
