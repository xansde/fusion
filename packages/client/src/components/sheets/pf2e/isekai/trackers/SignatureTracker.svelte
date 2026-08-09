<script lang="ts">
  /**
   * SignatureTracker.svelte — the Especialista's Assinaturas.
   *
   * The cap walks a staircase (1 → 2 at level 6 → 3 at level 12) and the input
   * disables once it is reached: the rule is "mantém N", so the sheet should
   * not let a fourth one be typed and then silently ignored.
   *
   * ★ marks a Signature taught to an ally, which locks 1 point of the Focus
   * maximum for as long as they know it.
   */

  import type {
    IsekaiArchetype,
    IsekaiListTracker,
  } from "../../../../../lib/sheets/pf2e/isekai/types.js";
  import type { IsekaiSignatureState } from "../../../../../lib/sheets/pf2e/isekai/index.js";
  import { isekaiListCapAtLevel } from "../../../../../lib/sheets/pf2e/isekai/index.js";
  import { t } from "../../../../../lib/i18n/i18n.js";
  import TrackerFrame from "./TrackerFrame.svelte";

  interface Props {
    archetype: IsekaiArchetype;
    def: IsekaiListTracker;
    level: number;
    trackerState: unknown;
    editable: boolean;
    onChange: (next: IsekaiSignatureState[]) => void;
  }

  let { archetype, def, level, trackerState, editable, onChange }: Props = $props();

  function isSignature(value: unknown): value is IsekaiSignatureState {
    if (value === null || typeof value !== "object") return false;
    const s = value as Record<string, unknown>;
    return typeof s["id"] === "string" && typeof s["name"] === "string";
  }

  const entries = $derived(
    (Array.isArray(trackerState) ? trackerState : []).filter(isSignature).map((s) => ({ ...s, flag: s.flag === true })),
  );
  const cap = $derived(isekaiListCapAtLevel(archetype, level));
  const full = $derived(cap !== null && entries.length >= cap);
  const taught = $derived(entries.filter((s) => s.flag).length);

  let draft = $state("");
  let seq = 0;

  function add(): void {
    const name = draft.trim();
    if (!name || full) return;
    onChange([...entries, { id: `s${Date.now().toString(36)}${String(seq++)}`, name, flag: false }]);
    draft = "";
  }

  function toggleFlag(id: string): void {
    onChange(entries.map((s) => (s.id === id ? { ...s, flag: !s.flag } : s)));
  }

  function remove(id: string): void {
    onChange(entries.filter((s) => s.id !== id));
  }

  const meta = $derived(
    cap === null
      ? undefined
      : `${String(entries.length)}/${String(cap)}${taught > 0 ? ` · ${String(taught)} ★` : ""}`,
  );
</script>

<TrackerFrame title={def.title} accent={archetype.color} {meta} note={def.note}>
  {#if editable}
    <div class="add">
      <input
        type="text"
        bind:value={draft}
        placeholder={def.placeholder}
        disabled={full}
        onkeydown={(e) => {
          if (e.key === "Enter") add();
        }}
      />
      <button type="button" disabled={full} onclick={add}>
        {t("FUSION.Sheet.Isekai.Tracker.Add")}
      </button>
    </div>
  {/if}

  {#if entries.length === 0}
    <span class="empty">{t("FUSION.Sheet.Isekai.Tracker.EmptyList")}</span>
  {/if}

  {#each entries as entry (entry.id)}
    <div class="row" class:row--flagged={entry.flag}>
      <button
        type="button"
        class="star"
        disabled={!editable}
        title={def.flagLabel}
        onclick={() => toggleFlag(entry.id)}
      >
        {entry.flag ? "★" : "☆"}
      </button>
      <span class="row__name">{entry.name}</span>
      {#if editable}
        <button
          type="button"
          title={t("FUSION.Sheet.Isekai.Tracker.Remove")}
          onclick={() => remove(entry.id)}
        >✕</button>
      {/if}
    </div>
  {/each}

  <p class="legend">
    <b>★</b> = {def.flagLabel}{def.flagLocksFocus
      ? ` · ${t("FUSION.Sheet.Isekai.Tracker.LocksFocus")}`
      : ""}
  </p>
</TrackerFrame>

<style>
  .add {
    display: flex;
    gap: 6px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
  }

  .row--flagged {
    border-color: color-mix(in srgb, var(--accent, currentColor) 60%, var(--fusion-border));
  }

  .row__name {
    flex: 1;
    font-size: 11.5px;
    color: var(--fusion-text);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .star {
    padding: 1px 4px !important;
    font-size: 12px !important;
    border: none !important;
    background: none !important;
  }

  .empty {
    font-size: 10.5px;
    font-style: italic;
    color: var(--fusion-text-subtle);
  }

  .legend {
    margin: 0;
    font-size: 10px;
    color: var(--fusion-text-subtle);
  }
</style>
