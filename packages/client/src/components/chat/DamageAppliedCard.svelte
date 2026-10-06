<script lang="ts">
  /**
   * DamageAppliedCard.svelte — the `actor:applyDamage` summary card
   * (ALQ-F1-10, plan §2.1, REQ-CHT-053, D-04).
   *
   * Mounted by `chatCardExtensionRegistry.svelte.ts` (via
   * `registerCoreChatCardExtensions.ts`, CORE-registered — DF-02:
   * `flags.fusion.damageApplied` is a core-level shape, not a system one,
   * unlike PF2e's `flags.pf2e.abilityCard`) whenever
   * `damageAppliedDisplay.ts::recognizeDamageApplied` matches a message.
   *
   * ONE row per target, in ONE of two mutually-exclusive shapes, decided
   * purely by which fields are PRESENT on that target — never by `isGm`:
   * the SERVER already redacted `hpBefore`/`hpAfter`/`tempHpAfter`/
   * `deathCondition` away for a non-privileged viewer
   * (`net/redaction.ts::redactChatDamageAppliedForNonPrivileged`). This
   * component renders what it was handed; it never re-decides who may see
   * hp (that would be the "second predicate" CLAUDE.md forbids).
   */

  import type { ActorDamageAppliedPayload, DamageAppliedTarget } from "@fusion/shared";
  import type { Socket } from "socket.io-client";
  import { t } from "$lib/i18n/i18n.js";
  import {
    formatDamageAppliedPlayerLine,
    formatDamageAppliedGmSummary,
  } from "../../lib/chat/damageAppliedDisplay.js";

  interface Props {
    card: ActorDamageAppliedPayload;
    messageId?: string;
    worldId?: string;
    socket?: Socket | undefined;
    isGm?: boolean;
    userId?: string;
  }

  const { card }: Props = $props();

  /** Whether the server included the privileged-only fields on THIS target —
   * presence, not a role re-check (see file header). */
  function hasHpFields(target: DamageAppliedTarget): boolean {
    return target.hpBefore !== undefined && target.hpAfter !== undefined;
  }
</script>

<div class="damage-applied-card" role="group" aria-label={t("FUSION.Chat.DamageApplied.Title")}>
  {#each card.targets as target (target.tokenId)}
    <div class="damage-applied-card__row">
      {#if hasHpFields(target)}
        {@const summary = formatDamageAppliedGmSummary(target)}
        <div class="damage-applied-card__name">{target.name}</div>
        {#if summary.hpLine}
          <div class="damage-applied-card__hp">{summary.hpLine}</div>
        {/if}
        <div class="damage-applied-card__amount">{summary.amountLine}</div>
        {#if summary.tempHpNote}
          <div class="damage-applied-card__note">{summary.tempHpNote}</div>
        {/if}
        {#if summary.deathNote}
          <div class="damage-applied-card__death">{summary.deathNote}</div>
        {/if}
      {:else}
        <div class="damage-applied-card__player-line">{formatDamageAppliedPlayerLine(target)}</div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .damage-applied-card {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    max-width: 340px;
    margin-top: 0.35rem;
    padding: 0.5rem 0.7rem;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .damage-applied-card__row {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .damage-applied-card__row + .damage-applied-card__row {
    padding-top: 6px;
    border-top: 1px solid var(--fusion-border);
  }

  .damage-applied-card__name {
    font-weight: 600;
    font-size: 0.8125rem;
    color: var(--fusion-text);
  }

  .damage-applied-card__hp {
    font-family: var(--fusion-font-mono);
    font-size: 0.85rem;
    color: var(--fusion-warn);
  }

  .damage-applied-card__amount {
    font-size: 0.78rem;
    color: var(--fusion-text);
  }

  .damage-applied-card__player-line {
    font-size: 0.8125rem;
    color: var(--fusion-text);
  }

  .damage-applied-card__note {
    font-size: 0.72rem;
    color: var(--fusion-text-muted);
  }

  .damage-applied-card__death {
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--fusion-danger);
  }
</style>
