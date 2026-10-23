<script lang="ts">
  /**
   * PopoutBody.svelte — what a detached window shows in its own browser window.
   *
   * Mounted by PopoutWindow.svelte with Svelte's `mount()` into the child
   * document, but running in the main JS realm: it reads the entry straight from
   * the shared `windowManager` (a SvelteMap), so title, header actions and the
   * content component's props stay live exactly as in the floating window.
   */

  import { windowManager, type WindowId } from "$lib/windows/window-manager.js";
  import { isIconName } from "@fusion/shared";
  import { t } from "$lib/i18n/i18n.js";
  import Icon from "../common/Icon.svelte";

  interface Props {
    id: WindowId;
  }

  let { id }: Props = $props();

  const entry = $derived(windowManager.windows.get(id));
</script>

{#if entry}
  <div class="fusion-popout" data-testid="popout-body">
    <div class="fusion-popout__bar">
      {#if entry.icon !== undefined && isIconName(entry.icon)}
        <span class="fusion-popout__icon" aria-hidden="true"><Icon name={entry.icon} size={18} /></span>
      {/if}
      <span class="fusion-popout__title">{entry.title}</span>

      {#each entry.headerActions ?? [] as action (action.id)}
        <button
          type="button"
          class="fusion-popout__action"
          title={action.title ?? action.label}
          onclick={action.onclick}
        >
          {#if action.icon !== undefined && isIconName(action.icon)}<Icon name={action.icon} size={18} />{/if}
          <span>{action.label}</span>
        </button>
      {/each}

      <button
        type="button"
        class="fusion-popout__action"
        data-testid="popout-return"
        title={t("FUSION.Window.PopIn")}
        onclick={() => windowManager.popIn(id)}
      >
        <Icon name="minimize-2" size={18} />
        <span>{t("FUSION.Window.PopIn")}</span>
      </button>
    </div>

    <div class="fusion-popout__content">
      {#if entry.component}
        {@const Content = entry.component}
        <Content {...(entry.componentProps ?? {})} />
      {/if}
    </div>
  </div>
{/if}

<style>
  :global(html),
  :global(body) {
    height: 100%;
  }

  :global(body:has(.fusion-popout)) {
    margin: 0;
    background: var(--fusion-surface);
    color: var(--fusion-text);
  }

  :global(.fusion-popout-root) {
    height: 100%;
  }

  .fusion-popout {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--fusion-surface);
    color: var(--fusion-text);
  }

  .fusion-popout__bar {
    display: flex;
    align-items: center;
    gap: var(--fusion-space-2);
    padding: var(--fusion-space-1) var(--fusion-space-2) var(--fusion-space-1) var(--fusion-space-3);
    background: var(--fusion-surface-alt);
    border-bottom: 1px solid var(--fusion-border);
    min-height: 48px;
    flex-shrink: 0;
  }

  .fusion-popout__icon {
    display: inline-flex;
    color: var(--fusion-text-muted);
  }

  .fusion-popout__title {
    flex: 1;
    min-width: 0;
    font-size: var(--fusion-text-md);
    font-weight: var(--fusion-weight-bold);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .fusion-popout__action {
    display: inline-flex;
    align-items: center;
    gap: var(--fusion-space-1);
    min-height: 32px;
    padding: 0 var(--fusion-space-2);
    background: transparent;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    color: var(--fusion-text);
    cursor: pointer;
    font-size: var(--fusion-text-sm);
  }

  .fusion-popout__action:hover {
    background: var(--fusion-surface);
    border-color: var(--fusion-border-strong);
  }

  .fusion-popout__content {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
</style>
