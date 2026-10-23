<script lang="ts">
  /**
   * TemplateMenu — the small menu that opens on right-click over a pinned area:
   * colour, border, opacity and remove. Delete over the area still removes it.
   */
  import { normalizeAreaStyle, DEFAULT_AREA_STYLE, type AreaStyle } from "@fusion/shared";
  import { templateMenu, closeTemplateMenu } from "../lib/presence/rulerToolStore.svelte.js";
  import { presenceState } from "../lib/presence/presenceStore.svelte.js";
  import { emitTemplateStyle, emitTemplateUnpin } from "../lib/presence/attachPresenceSync.js";
  import { getSocket } from "../lib/session.svelte.js";
  import AreaStyleControls from "./AreaStyleControls.svelte";

  const open = $derived(templateMenu.open);
  const pin = $derived(open ? presenceState.pinnedTemplates.get(open.id) : undefined);
  // Patches made faster than the server echo build on each other instead of on a stale style.
  let draft = $state<AreaStyle | null>(null);
  const style = $derived(draft ?? normalizeAreaStyle(pin?.template.style ?? DEFAULT_AREA_STYLE));

  // The area vanished (removed by someone, token gone): close the menu.
  $effect(() => {
    if (open && !pin) closeTemplateMenu();
  });
  $effect(() => {
    void open?.id;
    draft = null;
  });

  function change(patch: Partial<AreaStyle>): void {
    if (!open || !pin) return;
    draft = normalizeAreaStyle({ ...style, ...patch });
    emitTemplateStyle(getSocket() ?? null, open.id, pin.sceneId, draft);
  }

  function remove(): void {
    if (!open || !pin) return;
    emitTemplateUnpin(getSocket() ?? null, open.id, pin.sceneId);
    closeTemplateMenu();
  }

  // Keep the menu inside the window.
  const left = $derived(open ? Math.max(4, Math.min(open.x, window.innerWidth - 190)) : 0);
  const top = $derived(open ? Math.max(4, Math.min(open.y, window.innerHeight - 190)) : 0);
</script>

<svelte:window
  onpointerdown={(e) => {
    if (open && !(e.target as Element | null)?.closest(".template-menu")) closeTemplateMenu();
  }}
/>

{#if open && pin}
  <div class="template-menu" role="dialog" aria-label="Estilo da área" style:left="{left}px" style:top="{top}px">
    <AreaStyleControls {style} onchange={change} />
    <button type="button" class="template-menu__remove" onclick={remove}>Remover</button>
  </div>
{/if}

<style>
  .template-menu {
    background: var(--fusion-bg);
    backdrop-filter: blur(6px);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    min-width: 11rem;
    padding: 0.35rem;
    position: fixed;
    z-index: 200;
  }
  .template-menu__remove {
    background: transparent;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: var(--fusion-text-sm);
    padding: 0.25rem;
  }
  .template-menu__remove:hover {
    border-color: var(--fusion-danger);
    color: var(--fusion-danger);
  }
</style>
