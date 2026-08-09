<script lang="ts">
  /**
   * DicePoolTracker.svelte — the Sortudo's Dados do Destino.
   *
   * The d20s are REAL rolls that get banked and spent later, so they are
   * resolved SERVER-SIDE like every other roll in Fusion (anti-cheat: the RNG
   * never runs in the browser). "Rolar o dia" sends `/r Nd20` over the socket,
   * waits for the ack, and banks the faces the server returned. If the socket
   * is down the pool is left untouched and an error line appears — a silently
   * empty pool would read as "the roll came up with nothing".
   */

  import type {
    IsekaiArchetype,
    IsekaiDicePoolTracker,
  } from "../../../../../lib/sheets/pf2e/isekai/types.js";
  import { isekaiDestinyDicePlan } from "../../../../../lib/sheets/pf2e/isekai/index.js";
  import { d20ResultsFrom } from "../../../../../lib/sheets/pf2e/isekai/tabVM.js";
  import type { ChatMessage } from "@fusion/shared";
  import { sendOp } from "../../../../../lib/docs/sendOp.js";
  import { getSocket } from "../../../../../lib/session.svelte.js";
  import { t } from "../../../../../lib/i18n/i18n.js";
  import TrackerFrame from "./TrackerFrame.svelte";

  interface Props {
    archetype: IsekaiArchetype;
    def: IsekaiDicePoolTracker;
    level: number;
    trackerState: unknown;
    editable: boolean;
    onChange: (next: number[]) => void;
  }

  let { archetype, def, level, trackerState, editable, onChange }: Props = $props();

  const dice = $derived(
    Array.isArray(trackerState) ? trackerState.filter((d): d is number => typeof d === "number") : [],
  );
  const plan = $derived(isekaiDestinyDicePlan(archetype, level));

  let rolling = $state(false);
  let error = $state<string | null>(null);

  /** Roll `count` d20 on the SERVER and return the faces it produced. */
  async function rollOnServer(count: number): Promise<number[]> {
    const socket = getSocket();
    if (!socket) throw new Error("socket unavailable");
    const result = await sendOp<{ message?: ChatMessage }>(socket, {
      type: "chat:send",
      payload: { content: `/r ${String(count)}d20 # ${def.title}` },
    });
    return d20ResultsFrom(result.message?.rolls?.[0]);
  }

  async function rollDay(): Promise<void> {
    if (rolling) return;
    rolling = true;
    error = null;
    try {
      const rolled = await rollOnServer(plan.count);
      // The fixed dice (A Casa Sempre Vence) are GRANTED at known values, not
      // rolled — appended rather than requested from the server.
      onChange([...rolled, ...plan.fixed]);
    } catch {
      error = t("FUSION.Sheet.Isekai.Tracker.RollFailed");
    } finally {
      rolling = false;
    }
  }

  async function addOne(): Promise<void> {
    if (rolling) return;
    rolling = true;
    error = null;
    try {
      onChange([...dice, ...(await rollOnServer(1))]);
    } catch {
      error = t("FUSION.Sheet.Isekai.Tracker.RollFailed");
    } finally {
      rolling = false;
    }
  }

  /** Spend one banked die — by INDEX, since two dice can show the same face. */
  function spend(index: number): void {
    onChange(dice.filter((_, i) => i !== index));
  }

  const meta = $derived(
    `${String(dice.length)} ${
      dice.length === 1
        ? t("FUSION.Sheet.Isekai.Tracker.Die")
        : t("FUSION.Sheet.Isekai.Tracker.Dice")
    }`,
  );
</script>

<TrackerFrame title={def.title} accent={archetype.color} {meta} note={def.note}>
  <div class="dice">
    {#if dice.length === 0}
      <span class="empty">{t("FUSION.Sheet.Isekai.Tracker.EmptyPool")}</span>
    {/if}
    {#each dice as value, i (`${String(i)}:${String(value)}`)}
      <button
        type="button"
        class="die"
        class:die--max={value === 20}
        class:die--min={value === 1}
        disabled={!editable}
        title={t("FUSION.Sheet.Isekai.Tracker.SpendDie")}
        onclick={() => spend(i)}
      >
        {value}
      </button>
    {/each}
  </div>
  {#if error}
    <p class="error" role="status">{error}</p>
  {/if}

  {#snippet controls()}
    {#if editable}
      <button type="button" disabled={rolling} onclick={rollDay}>
        {t("FUSION.Sheet.Isekai.Tracker.RollDay", {
          n: String(plan.count),
          extra: plan.fixed.length > 0 ? ` + ${plan.fixed.join("/")}` : "",
        })}
      </button>
      <button type="button" disabled={rolling} onclick={addOne}>
        {t("FUSION.Sheet.Isekai.Tracker.AddDie")}
      </button>
      {#if dice.length > 0}
        <button type="button" onclick={() => onChange([])}>
          {t("FUSION.Sheet.Isekai.Tracker.Clear")}
        </button>
      {/if}
    {/if}
  {/snippet}
</TrackerFrame>

<style>
  .dice {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }

  .die {
    min-width: 32px;
    height: 30px;
    font-size: 13px;
    font-weight: 700;
    border-color: var(--fusion-border);
  }

  .die--max {
    border-color: #4ac07a;
    color: #4ac07a;
  }

  .die--min {
    border-color: #c04a4a;
    color: #c04a4a;
  }

  .empty {
    font-size: 10.5px;
    font-style: italic;
    color: var(--fusion-text-subtle);
  }

  .error {
    margin: 0;
    font-size: 10.5px;
    color: #e08a8a;
  }
</style>
