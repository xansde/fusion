<script lang="ts">
  /**
   * ChatCard.svelte — renders a declarative chat card (CardData).
   *
   * REQ-CHT-024..028: schema JSON declarativo renderizado pelo componente,
   * nunca innerHTML. Botões emitem CardActionRequest ao handler.
   *
   * M3 note: system card actions arrive here but the handler is not yet
   * registered — log to console and show a toast informing the user.
   * REQ-CHT-026: actionType + actionPayload serialized.
   */

  import { isIconName, type CardData } from "@fusion/shared";
  import Icon from "../common/Icon.svelte";

  const {
    card,
    messageId,
  }: {
    card: CardData;
    messageId: string;
  } = $props();

  let toast = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  function handleButtonClick(buttonId: string, actionType: string, actionPayload: Record<string, unknown>): void {
    // M3: system action handlers not yet registered
    console.info("[ChatCard] card action clicked", {
      messageId,
      buttonId,
      actionType,
      actionPayload,
    });

    showToast("System actions arrive in M3");
  }

  function showToast(msg: string): void {
    toast = msg;
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast = null;
    }, 2500);
  }
</script>

<div class="chat-card" role="group" aria-label={card.title}>
  <!-- Header. ui-chat: an icon is drawn only when it names a glyph of the shared set — an emoji or a
       symbol character is never an icon (docs/design/ui/README.md); the system id is not for the reader. -->
  <div class="chat-card__header">
    {#if card.icon && isIconName(card.icon)}
      <span class="chat-card__icon"><Icon name={card.icon} size={20} /></span>
    {/if}
    <div class="chat-card__title-group">
      <span class="chat-card__title">{card.title}</span>
      {#if card.subtitle}
        <span class="chat-card__subtitle">{card.subtitle}</span>
      {/if}
    </div>
  </div>

  <!-- Fields -->
  {#if card.fields && card.fields.length > 0}
    <dl class="chat-card__fields">
      {#each card.fields as field}
        <div class="chat-card__field" class:chat-card__field--highlight={field.highlight}>
          <dt class="chat-card__field-label">{field.label}</dt>
          <dd class="chat-card__field-value">{field.value}</dd>
        </div>
      {/each}
    </dl>
  {/if}

  <!-- Description -->
  {#if card.description}
    <p class="chat-card__desc">{card.description}</p>
  {/if}

  <!-- Buttons -->
  {#if card.buttons && card.buttons.length > 0}
    <div class="chat-card__buttons">
      {#each card.buttons as btn (btn.id)}
        <button
          class="chat-card__btn chat-card__btn--{btn.variant ?? 'secondary'}"
          disabled={btn.disabled ?? false}
          onclick={() => handleButtonClick(btn.id, btn.actionType, btn.actionPayload)}
          aria-label={btn.label}
        >
          {#if btn.icon && isIconName(btn.icon)}
            <Icon name={btn.icon} size={18} />
          {/if}
          {btn.label}
        </button>
      {/each}
    </div>
  {/if}

  <!-- M3 toast -->
  {#if toast}
    <p class="chat-card__toast" role="status">{toast}</p>
  {/if}
</div>

<style>
  /* ui-chat: same box as the roll card (one box, left rule in the card color), no box inside it. */
  .chat-card {
    margin-top: var(--fusion-space-2);
    padding: var(--fusion-space-2) var(--fusion-space-3);
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-left: 4px solid var(--fusion-chat-sys);
    border-radius: var(--fusion-radius);
    max-width: 360px;
    display: flex;
    flex-direction: column;
    gap: var(--fusion-space-2);
  }

  .chat-card__header {
    display: flex;
    align-items: center;
    gap: var(--fusion-space-2);
  }

  .chat-card__icon {
    display: inline-flex;
    color: var(--fusion-text-muted);
    flex-shrink: 0;
  }

  .chat-card__title-group {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .chat-card__title {
    font-weight: var(--fusion-weight-bold);
    font-size: var(--fusion-text-md);
    color: var(--fusion-text);
    overflow-wrap: anywhere;
  }

  .chat-card__subtitle {
    font-size: var(--fusion-text-sm);
    color: var(--fusion-text-muted);
  }

  /* Fields: label left, value right, one line each, divided by a hairline */
  .chat-card__fields {
    margin: 0;
  }

  .chat-card__field {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--fusion-space-3);
    padding: var(--fusion-space-1) 0;
    border-top: 1px solid var(--fusion-border);
  }

  .chat-card__field-label {
    font-size: var(--fusion-text-sm);
    color: var(--fusion-text-muted);
  }

  .chat-card__field-value {
    font-size: var(--fusion-text-base);
    color: var(--fusion-text);
    font-weight: var(--fusion-weight-medium);
    margin: 0;
    text-align: right;
  }

  .chat-card__field--highlight .chat-card__field-value {
    font-size: var(--fusion-text-lg);
    font-weight: var(--fusion-weight-bold);
  }

  .chat-card__desc {
    font-size: var(--fusion-text-base);
    color: var(--fusion-text-muted);
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* Buttons */
  .chat-card__buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--fusion-space-2);
    padding-top: var(--fusion-space-2);
    border-top: 1px solid var(--fusion-border);
  }

  .chat-card__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--fusion-space-1);
    min-height: var(--fusion-target);
    padding: 0 var(--fusion-space-3);
    border: 1px solid var(--fusion-border-strong);
    border-radius: var(--fusion-radius);
    background: var(--fusion-surface);
    color: var(--fusion-text);
    cursor: pointer;
    font-family: var(--fusion-font);
    font-size: var(--fusion-text-sm);
    font-weight: var(--fusion-weight-medium);
    transition:
      background-color var(--fusion-transition),
      border-color var(--fusion-transition);
  }

  .chat-card__btn:not(:disabled):hover {
    border-color: var(--fusion-accent);
  }

  .chat-card__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .chat-card__btn--primary {
    background: var(--fusion-accent);
    border-color: var(--fusion-accent);
    color: var(--fusion-on-accent);
  }

  .chat-card__btn--primary:not(:disabled):hover {
    background: var(--fusion-accent-hover);
  }

  .chat-card__btn--danger {
    border-color: var(--fusion-danger);
  }

  .chat-card__btn--danger:not(:disabled):hover {
    background: var(--fusion-danger-dim);
    border-color: var(--fusion-danger);
  }

  .chat-card__toast {
    font-size: var(--fusion-text-sm);
    color: var(--fusion-text);
    padding: var(--fusion-space-1) var(--fusion-space-2);
    margin: 0;
    border-left: 3px solid var(--fusion-warning);
    background: var(--fusion-warning-dim);
  }
</style>
