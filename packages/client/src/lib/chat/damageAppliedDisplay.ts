/**
 * damageAppliedDisplay.ts — recognizer + display formatters for the
 * `actor:applyDamage` summary card (ALQ-F1-10, plan §2.1, REQ-CHT-053, D-04).
 *
 * `flags.fusion.damageApplied` (`ActorDamageAppliedPayload`, @fusion/shared)
 * is CORE-level (DF-02: ApplyDamage is a core op, not a system one) — it
 * rides the same "fusion" namespace as `flags.fusion.targetSnapshot`, unlike
 * PF2e's own `flags.pf2e.abilityCard`. `recognizeDamageApplied` is therefore
 * this module's counterpart of `registerPf2eSheets.ts`'s
 * `abilityCardExtension.recognize` — registered directly by CORE
 * (`registerCoreChatCardExtensions.ts`), not by a system.
 *
 * D-04 / REQ-CHT-053: a non-privileged viewer's target line carries only
 * `byType`/`total` — `hpBefore`/`hpAfter`/`tempHpAfter`/`deathCondition` are
 * stripped BEFORE this ever reaches the client
 * (`packages/server/src/net/redaction.ts::redactChatDamageAppliedForNonPrivileged`).
 * These formatters never re-derive who may see what: they render whichever
 * fields are PRESENT on the payload they are handed, exactly once, in one
 * place — duplicating that predicate here would be the "second strip" the
 * repo's CLAUDE.md explicitly forbids.
 */

import type { ChatMessage, ActorDamageAppliedPayload, DamageAppliedTarget } from "@fusion/shared";
import { ActorDamageAppliedPayloadSchema } from "@fusion/shared";

/**
 * Recognize a `ChatMessage` carrying `flags.fusion.damageApplied` and return
 * its parsed payload, or `null` when the message doesn't match (falls
 * through to the next chat-card extension, or to plain text) — same
 * recognize/null contract as `chatCardExtensionRegistry.svelte.ts` expects.
 */
export function recognizeDamageApplied(message: ChatMessage): ActorDamageAppliedPayload | null {
  const flags = message.flags as Record<string, Record<string, unknown>> | undefined;
  const raw = flags?.["fusion"]?.["damageApplied"];
  if (raw === undefined) return null;
  const parsed = ActorDamageAppliedPayloadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** "sofreu 7 de fire (resistência 5)" / "recuperou 12 de PV" / "ganhou 5 de
 * PV temporário" — the amount line shared by the player and GM renderings,
 * without the target's name (the two callers prefix it differently). Reads
 * only `byType`/`total`, so it renders identically whether or not the
 * privileged-only fields are present (REQ-CHT-053's own invariant). */
function formatAmountLine(target: DamageAppliedTarget): string {
  const primary = target.byType[0];
  if (!primary) return String(target.total);
  if (primary.type === "healing") return `recuperou ${String(target.total)} de PV`;
  if (primary.type === "temp-hp") return `ganhou ${String(target.total)} de PV temporário`;
  const resistance =
    primary.resistanceApplied !== undefined
      ? ` (resistência ${String(primary.resistanceApplied)})`
      : "";
  return `sofreu ${String(target.total)} de ${primary.type}${resistance}`;
}

/**
 * The line EVERY viewer may see (D-04: "o jogador vê só o dano causado, sem
 * PV restantes") — e.g. "Goblin sofreu 7 de fire (resistência 5)". Never
 * touches `hpBefore`/`hpAfter`/`tempHpAfter`/`deathCondition` — those are
 * either absent (redacted for this viewer) or, for the GM, rendered
 * separately by {@link formatDamageAppliedGmSummary}.
 */
export function formatDamageAppliedPlayerLine(target: DamageAppliedTarget): string {
  return `${target.name} ${formatAmountLine(target)}`;
}

function deathConditionLabel(condition: "dead" | "dying" | "unconscious"): string {
  if (condition === "dead") return "Morto";
  if (condition === "dying") return "Morrendo";
  return "Inconsciente";
}

export interface DamageAppliedGmSummary {
  /** "PV 18 → 11", or `null` when hp fields aren't on this payload (a
   * non-privileged payload never carries them — D-04). */
  hpLine: string | null;
  /** Same amount/resistance sentence fragment as the player line, without
   * the name prefix (the GM card prefixes it with the target's own row). */
  amountLine: string;
  /** "PV temp.: 5", or `null` when the target carries no `tempHpAfter`. */
  tempHpNote: string | null;
  /** A pt-BR label for `deathCondition`, or `null` when absent/uncleared. */
  deathNote: string | null;
}

/**
 * The privileged (GM / owner-on-the-sheet-elsewhere, never THIS card —
 * REQ-CHT-053's own text: "o resumo não é o lugar dela" for the owner too)
 * rendering: hp transition + the same amount/resistance breakdown + optional
 * temp-hp and death-condition notes. Every field is independently `null`
 * when its source field is absent, so a caller handed a REDACTED payload by
 * mistake degrades to the player-safe subset instead of showing "PV
 * undefined → undefined".
 */
export function formatDamageAppliedGmSummary(target: DamageAppliedTarget): DamageAppliedGmSummary {
  return {
    hpLine:
      target.hpBefore !== undefined && target.hpAfter !== undefined
        ? `PV ${String(target.hpBefore)} → ${String(target.hpAfter)}`
        : null,
    amountLine: formatAmountLine(target),
    tempHpNote: target.tempHpAfter !== undefined ? `PV temp.: ${String(target.tempHpAfter)}` : null,
    deathNote:
      target.deathCondition !== undefined && target.deathCondition !== null
        ? deathConditionLabel(target.deathCondition)
        : null,
  };
}
