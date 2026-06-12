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

  import type { CardData } from "@fusion/shared";

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

<div class="chat-card" aria-label="Chat card: {card.title}">
  <!-- Header -->
  <div class="chat-card__header">
    {#if card.icon}
      <span class="chat-card__icon" aria-hidden="true">{card.icon}</span>
    {/if}
    <div class="chat-card__title-group">
      <span class="chat-card__title">{card.title}</span>
      {#if card.subtitle}
        <span class="chat-card__subtitle">{card.subtitle}</span>
      {/if}
    </div>
    <span class="chat-card__system">{card.systemId}</span>
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
          {#if btn.icon}
            <span class="chat-card__btn-icon" aria-hidden="true">{btn.icon}</span>
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
  .chat-card {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    overflow: hidden;
    max-width: 340px;
    margin-top: 0.35rem;
  }

  .chat-card__header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.7rem;
    background: rgba(124, 92, 252, 0.07);
    border-bottom: 1px solid var(--fusion-border);
  }

  .chat-card__icon {
    font-size: 1.1rem;
    flex-shrink: 0;
  }

  .chat-card__title-group {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .chat-card__title {
    font-weight: 600;
    font-size: 0.875rem;
    color: var(--fusion-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chat-card__subtitle {
    font-size: 0.75rem;
    color: var(--fusion-text-muted);
  }

  .chat-card__system {
    font-size: 0.65rem;
    color: var(--fusion-text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    flex-shrink: 0;
  }

  /* Fields */
  .chat-card__fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.1rem;
    padding: 0.4rem 0.7rem;
    margin: 0;
  }

  .chat-card__field {
    display: contents;
  }

  .chat-card__field-label {
    font-size: 0.7rem;
    color: var(--fusion-text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding-right: 0.3rem;
  }

  .chat-card__field-value {
    font-size: 0.8125rem;
    color: var(--fusion-text);
    font-weight: 500;
    margin: 0;
  }

  .chat-card__field--highlight .chat-card__field-value {
    color: var(--fusion-accent);
    font-size: 1rem;
    font-weight: 700;
  }

  /* Description */
  .chat-card__desc {
    font-size: 0.8125rem;
    color: var(--fusion-text-muted);
    padding: 0.4rem 0.7rem;
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* Buttons */
  .chat-card__buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    padding: 0.4rem 0.7rem;
    border-top: 1px solid var(--fusion-border);
  }

  .chat-card__btn {
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-family: var(--fusion-font);
    font-size: 0.75rem;
    font-weight: 500;
    padding: 0.3rem 0.65rem;
    transition: background-color var(--fusion-transition), opacity var(--fusion-transition);
  }

  .chat-card__btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .chat-card__btn--primary {
    background: var(--fusion-accent);
    color: #fff;
  }

  .chat-card__btn--primary:not(:disabled):hover {
    background: var(--fusion-accent-hover);
  }

  .chat-card__btn--secondary {
    background: var(--fusion-surface);
    border-color: var(--fusion-border);
    color: var(--fusion-text-muted);
  }

  .chat-card__btn--secondary:not(:disabled):hover {
    border-color: var(--fusion-text-muted);
    color: var(--fusion-text);
  }

  .chat-card__btn--danger {
    background: rgba(255, 92, 92, 0.12);
    border-color: var(--fusion-danger);
    color: var(--fusion-danger);
  }

  .chat-card__btn--danger:not(:disabled):hover {
    background: rgba(255, 92, 92, 0.22);
  }

  .chat-card__btn-icon {
    font-size: 0.8rem;
    line-height: 1;
  }

  /* Toast */
  .chat-card__toast {
    font-size: 0.7rem;
    color: var(--fusion-warning);
    padding: 0.25rem 0.7rem;
    margin: 0;
    border-top: 1px solid var(--fusion-border);
    background: rgba(255, 200, 87, 0.05);
  }
</style>
