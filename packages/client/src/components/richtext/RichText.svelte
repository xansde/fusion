<script lang="ts">
  /**
   * RichText.svelte — TipTap rich-text editor component (shell).
   *
   * REQ-UIF-047..051: TipTap with bold/italic/headings/lists/links,
   * @doc-link extension, secret blocks, inline rolls.
   *
   * The actual TipTap Editor instance is created inside onMount (browser only).
   * The DOM-independent logic (parser/serialiser/sanitiser) lives in
   * packages/client/src/lib/richtext/richtext.ts.
   *
   * Props:
   *   content   — HTML string (current value)
   *   editable  — whether the editor is in edit mode
   *   isGm      — controls visibility of secret blocks
   *   onUpdate  — callback when content changes (debounced by the parent)
   *
   * Usage:
   *   <RichText {content} {editable} {isGm} onUpdate={handleUpdate} />
   */

  import { onMount, onDestroy } from "svelte";

  const {
    content = "",
    editable = false,
    isGm = false,
    onUpdate,
  }: {
    content?: string;
    editable?: boolean;
    isGm?: boolean;
    onUpdate?: (html: string) => void;
  } = $props();

  let editorEl: HTMLDivElement | null = $state(null);
  let toolbarEl: HTMLDivElement | null = $state(null);

  // Editor instance — typed loosely since TipTap types require browser context
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let editor: any = null;

  // Track active marks for toolbar state
  let activeMarks = $state(new Set<string>());

  onMount(async () => {
    if (!editorEl) return;

    try {
      // Lazy-import TipTap modules to avoid SSR/Vitest issues.
      // These are browser-only APIs.
      const [
        { Editor },
        { StarterKit },
        { Underline },
        { Link },
        { TextStyle },
      ] = await Promise.all([
        import("@tiptap/core"),
        import("@tiptap/starter-kit"),
        import("@tiptap/extension-underline"),
        import("@tiptap/extension-link"),
        import("@tiptap/extension-text-style"),
      ]);

      editor = new Editor({
        element: editorEl,
        extensions: [
          StarterKit.configure({
            heading: { levels: [1, 2, 3] },
          }),
          Underline,
          Link.configure({
            openOnClick: false,
            HTMLAttributes: { rel: "noopener noreferrer" },
          }),
          TextStyle,
        ],
        content,
        editable,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onUpdate({ editor: ed }: { editor: any }) {
          const html = (ed as import("@tiptap/core").Editor).getHTML();
          onUpdate?.(html);
          _syncActiveMarks(ed);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onSelectionUpdate({ editor: ed }: { editor: any }) {
          _syncActiveMarks(ed);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onTransaction({ editor: ed }: { editor: any }) {
          _syncActiveMarks(ed);
        },
      });
    } catch (err) {
      console.warn("[RichText] TipTap not available:", err);
      // Graceful degradation: render as plain contenteditable
      if (editorEl) {
        editorEl.contentEditable = editable ? "true" : "false";
        editorEl.innerHTML = content;
      }
    }
  });

  onDestroy(() => {
    editor?.destroy();
    editor = null;
  });

  // Sync activeMarks state for toolbar highlighting
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function _syncActiveMarks(ed: any): void {
    const marks = new Set<string>();
    if (ed.isActive("bold")) marks.add("bold");
    if (ed.isActive("italic")) marks.add("italic");
    if (ed.isActive("underline")) marks.add("underline");
    if (ed.isActive("strike")) marks.add("strike");
    if (ed.isActive("heading", { level: 1 })) marks.add("h1");
    if (ed.isActive("heading", { level: 2 })) marks.add("h2");
    if (ed.isActive("heading", { level: 3 })) marks.add("h3");
    if (ed.isActive("bulletList")) marks.add("bulletList");
    if (ed.isActive("orderedList")) marks.add("orderedList");
    activeMarks = marks;
  }

  // ---- Toolbar actions ----
  function toggleBold() { editor?.chain().focus().toggleBold().run(); }
  function toggleItalic() { editor?.chain().focus().toggleItalic().run(); }
  function toggleUnderline() { editor?.chain().focus().toggleUnderline().run(); }
  function toggleStrike() { editor?.chain().focus().toggleStrike().run(); }
  function setH1() { editor?.chain().focus().toggleHeading({ level: 1 }).run(); }
  function setH2() { editor?.chain().focus().toggleHeading({ level: 2 }).run(); }
  function setH3() { editor?.chain().focus().toggleHeading({ level: 3 }).run(); }
  function toggleBulletList() { editor?.chain().focus().toggleBulletList().run(); }
  function toggleOrderedList() { editor?.chain().focus().toggleOrderedList().run(); }

  function insertLink() {
    const url = prompt("URL:");
    if (!url) return;
    editor?.chain().focus().setLink({ href: url }).run();
  }

  function insertSecret() {
    // Insert a paragraph wrapped in a data-fusion-secret section.
    // In a full TipTap integration this would be a custom Node extension;
    // for now we insert raw HTML.
    editor?.chain().focus().insertContent(
      `<section data-fusion-secret="1" class="secret-block"><p>Segredo do GM</p></section>`
    ).run();
  }

  function insertInlineRoll() {
    const formula = prompt("Fórmula de rolagem (ex: 1d20+5):");
    if (!formula) return;
    editor?.chain().focus().insertContent(
      `<span data-fusion-roll="${formula}" class="inline-roll">[[${formula}]]</span>`
    ).run();
  }
</script>

<div class="richtext-wrapper" class:richtext-wrapper--editable={editable}>
  {#if editable}
    <!-- Toolbar (visible only in edit mode) -->
    <div class="richtext-toolbar" role="toolbar" aria-label="Formatação de texto" bind:this={toolbarEl}>
      <button
        type="button"
        class="rt-btn"
        class:rt-btn--active={activeMarks.has("bold")}
        onclick={toggleBold}
        title="Negrito"
        aria-label="Negrito"
        aria-pressed={activeMarks.has("bold")}
      ><strong>B</strong></button>

      <button
        type="button"
        class="rt-btn"
        class:rt-btn--active={activeMarks.has("italic")}
        onclick={toggleItalic}
        title="Itálico"
        aria-label="Itálico"
        aria-pressed={activeMarks.has("italic")}
      ><em>I</em></button>

      <button
        type="button"
        class="rt-btn"
        class:rt-btn--active={activeMarks.has("underline")}
        onclick={toggleUnderline}
        title="Sublinhado"
        aria-label="Sublinhado"
        aria-pressed={activeMarks.has("underline")}
      ><u>U</u></button>

      <button
        type="button"
        class="rt-btn"
        class:rt-btn--active={activeMarks.has("strike")}
        onclick={toggleStrike}
        title="Tachado"
        aria-label="Tachado"
        aria-pressed={activeMarks.has("strike")}
      ><s>S</s></button>

      <span class="rt-divider" aria-hidden="true"></span>

      <button
        type="button"
        class="rt-btn"
        class:rt-btn--active={activeMarks.has("h1")}
        onclick={setH1}
        title="Título 1"
        aria-label="Título 1"
        aria-pressed={activeMarks.has("h1")}
      >H1</button>

      <button
        type="button"
        class="rt-btn"
        class:rt-btn--active={activeMarks.has("h2")}
        onclick={setH2}
        title="Título 2"
        aria-label="Título 2"
        aria-pressed={activeMarks.has("h2")}
      >H2</button>

      <button
        type="button"
        class="rt-btn"
        class:rt-btn--active={activeMarks.has("h3")}
        onclick={setH3}
        title="Título 3"
        aria-label="Título 3"
        aria-pressed={activeMarks.has("h3")}
      >H3</button>

      <span class="rt-divider" aria-hidden="true"></span>

      <button
        type="button"
        class="rt-btn"
        class:rt-btn--active={activeMarks.has("bulletList")}
        onclick={toggleBulletList}
        title="Lista"
        aria-label="Lista com marcadores"
        aria-pressed={activeMarks.has("bulletList")}
      >&#8226;&#8212;</button>

      <button
        type="button"
        class="rt-btn"
        class:rt-btn--active={activeMarks.has("orderedList")}
        onclick={toggleOrderedList}
        title="Lista numerada"
        aria-label="Lista numerada"
        aria-pressed={activeMarks.has("orderedList")}
      >1&#8212;</button>

      <span class="rt-divider" aria-hidden="true"></span>

      <button
        type="button"
        class="rt-btn"
        onclick={insertLink}
        title="Inserir link"
        aria-label="Inserir link"
      >&#128279;</button>

      <button
        type="button"
        class="rt-btn rt-btn--secret"
        onclick={insertSecret}
        title="Bloco secreto (somente GM)"
        aria-label="Inserir bloco secreto"
      >&#128274;</button>

      <button
        type="button"
        class="rt-btn rt-btn--roll"
        onclick={insertInlineRoll}
        title="Rolagem inline [[fórmula]]"
        aria-label="Inserir rolagem inline"
      >&#127922;</button>
    </div>
  {/if}

  <!-- TipTap editor mount target -->
  <div
    class="richtext-editor"
    bind:this={editorEl}
    aria-label="Editor de texto"
    aria-multiline="true"
    role={editable ? "textbox" : "article"}
  ></div>
</div>

<style>
  .richtext-wrapper {
    display: flex;
    flex-direction: column;
    gap: 0;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface);
    overflow: hidden;
  }

  /* Toolbar */
  .richtext-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.15rem;
    padding: 0.25rem 0.4rem;
    border-bottom: 1px solid var(--fusion-border);
    background: var(--fusion-surface-alt);
  }

  .rt-btn {
    background: none;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: 0.8rem;
    line-height: 1;
    min-width: 1.75rem;
    padding: 0.2rem 0.35rem;
    transition: background-color var(--fusion-transition), color var(--fusion-transition);
  }

  .rt-btn:hover {
    background: var(--fusion-border);
    color: var(--fusion-text);
  }

  .rt-btn--active {
    background: rgba(124, 92, 252, 0.12);
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .rt-btn--secret {
    color: var(--fusion-warning, #f59e0b);
  }

  .rt-btn--roll {
    color: var(--fusion-success, #3ddc84);
  }

  .rt-divider {
    width: 1px;
    height: 1.2rem;
    background: var(--fusion-border);
    margin: 0 0.15rem;
  }

  /* Editor area */
  .richtext-editor {
    padding: 0.5rem 0.75rem;
    min-height: 6rem;
    color: var(--fusion-text);
    font-size: 0.875rem;
    line-height: 1.6;
    outline: none;
    overflow-y: auto;
  }

  /* TipTap ProseMirror focus ring */
  .richtext-wrapper--editable .richtext-editor:focus-within {
    outline: 2px solid var(--fusion-accent);
    outline-offset: -2px;
  }

  /* Content styles inside the editor */
  .richtext-editor :global(p) { margin: 0 0 0.5em; }
  .richtext-editor :global(h1) { font-size: 1.4em; font-weight: 700; margin: 0.5em 0 0.25em; }
  .richtext-editor :global(h2) { font-size: 1.2em; font-weight: 700; margin: 0.5em 0 0.25em; }
  .richtext-editor :global(h3) { font-size: 1.05em; font-weight: 600; margin: 0.5em 0 0.25em; }
  .richtext-editor :global(ul), .richtext-editor :global(ol) { padding-left: 1.5em; margin: 0.25em 0; }
  .richtext-editor :global(a) { color: var(--fusion-accent); text-decoration: underline; }
  .richtext-editor :global(blockquote) {
    border-left: 3px solid var(--fusion-border);
    padding-left: 0.75em;
    color: var(--fusion-text-muted);
    margin: 0.25em 0;
  }
  .richtext-editor :global(code) {
    background: var(--fusion-surface-alt);
    border-radius: 3px;
    font-family: var(--fusion-font-mono);
    font-size: 0.85em;
    padding: 0.1em 0.3em;
  }

  /* Doc-link chips */
  .richtext-editor :global(.doc-link) {
    background: rgba(124, 92, 252, 0.1);
    border: 1px solid rgba(124, 92, 252, 0.3);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-accent);
    cursor: pointer;
    font-size: 0.85em;
    padding: 0.05em 0.4em;
    text-decoration: none;
  }

  .richtext-editor :global(.doc-link--missing) {
    background: rgba(255, 92, 92, 0.08);
    border-color: rgba(255, 92, 92, 0.3);
    color: var(--fusion-danger);
    cursor: default;
  }

  /* Inline rolls */
  .richtext-editor :global(.inline-roll) {
    background: rgba(61, 220, 132, 0.1);
    border: 1px solid rgba(61, 220, 132, 0.3);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-success, #3ddc84);
    cursor: pointer;
    font-family: var(--fusion-font-mono);
    font-size: 0.85em;
    padding: 0.05em 0.4em;
  }

  /* Secret blocks */
  .richtext-editor :global(.secret-block) {
    background: rgba(245, 158, 11, 0.07);
    border: 1px dashed rgba(245, 158, 11, 0.4);
    border-radius: var(--fusion-radius-sm);
    margin: 0.5em 0;
    padding: 0.5em 0.75em;
    position: relative;
  }

  .richtext-editor :global(.secret-block::before) {
    content: "Secreto";
    color: var(--fusion-warning, #f59e0b);
    font-size: 0.7em;
    font-weight: 700;
    letter-spacing: 0.06em;
    position: absolute;
    right: 0.5em;
    top: 0.3em;
    text-transform: uppercase;
  }
</style>
