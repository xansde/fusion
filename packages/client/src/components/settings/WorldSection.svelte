<script lang="ts">
  /**
   * WorldSection.svelte — "Mundo" (spec 37 §5.4, G102).
   *
   * A PURE renderer of what the active system declared with escopo `world`
   * (REQ-CFG-030): every row comes from `settings:declarations`
   * (`worldSettingsRegistry.svelte.ts`), and the ONLY thing this markup
   * branches on is `controlForRow(row).kind` — boolean → alternador, enum →
   * seleção, número → campo numérico. There is NO branch anywhere in this
   * file keyed on a setting's key or on a system id (REQ-CFG-031): the
   * `{#each}` below is the entire contract, and it is what makes a system's
   * brand-new declared setting show up with zero lines changed here
   * (RNF-CFG-02).
   *
   * Writes go through the generic `doc:create`/`doc:update` of `Setting`
   * (`buildSettingWriteOp`, REQ-CFG-071) — never a bespoke setting-write op.
   * No optimistic update: the control only reflects a NEW value once the ack
   * confirms it (`applyWorldSettingWrite`), never before — a refusal simply
   * leaves the control showing the last value the server actually accepted.
   */

  import type { Socket } from "socket.io-client";
  import { t } from "../../lib/i18n/i18n.js";
  import { sendOp } from "../../lib/docs/sendOp.js";
  import {
    applyWorldSettingWrite,
    ensureWorldSettingsRegistry,
    worldSettingsRegistry,
  } from "../../lib/settings/worldSettingsRegistry.svelte.js";
  import {
    buildSettingWriteOp,
    controlForRow,
    type WorldSettingRow,
  } from "../../lib/settings/worldSettingsSection.js";

  interface Props {
    socket: Socket;
  }

  const { socket }: Props = $props();

  // The drawer mounts a fresh panel on every switch (REQ-GAV-017), so there is
  // nothing to keep reactive to a socket reconnect here.
  // svelte-ignore state_referenced_locally
  void ensureWorldSettingsRegistry(socket);

  const rows = $derived(worldSettingsRegistry.rows);

  async function commit(row: WorldSettingRow, nextValue: unknown): Promise<void> {
    const op = buildSettingWriteOp(row, nextValue);
    try {
      const result = await sendOp<{ documents?: Array<{ _id: string }> }>(socket, op);
      const id = row.id ?? result.documents?.[0]?._id;
      if (id !== undefined) applyWorldSettingWrite(row.key, id, nextValue);
    } catch (err) {
      // REQ-CFG-073's spirit: nothing above assumed success, so a refusal
      // simply leaves the control at the last server-confirmed value.
      console.error(`[WorldSection] setting write failed for "${row.key}":`, err);
    }
  }
</script>

<div class="world-section">
  {#if rows.length === 0}
    <p class="world-section__empty">{t("FUSION.Settings.World.Empty")}</p>
  {:else}
    <ul class="world-section__list">
      {#each rows as row (row.key)}
        {@const control = controlForRow(row)}
        <li class="world-section__row">
          <div class="world-section__meta">
            <span class="world-section__label">{row.label}</span>
            {#if row.hint}
              <span class="world-section__hint">{row.hint}</span>
            {/if}
          </div>

          {#if control.kind === "boolean"}
            <label class="world-section__toggle">
              <input
                type="checkbox"
                checked={control.checked}
                onchange={(event) => {
                  void commit(row, (event.currentTarget as HTMLInputElement).checked);
                }}
              />
            </label>
          {:else if control.kind === "enum"}
            <select
              class="world-section__select"
              value={control.value}
              onchange={(event) => {
                void commit(row, (event.currentTarget as HTMLSelectElement).value);
              }}
            >
              {#each control.options as option (option)}
                <option value={option}>{option}</option>
              {/each}
            </select>
          {:else if control.kind === "number"}
            <input
              class="world-section__number"
              type="number"
              value={control.value}
              onchange={(event) => {
                void commit(row, Number((event.currentTarget as HTMLInputElement).value));
              }}
            />
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .world-section {
    padding: 0.5rem 0.75rem;
  }

  .world-section__empty {
    color: var(--fusion-text-subtle);
    font-size: 0.8125rem;
    padding: 1.5rem 0;
    text-align: center;
  }

  .world-section__list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .world-section__row {
    align-items: center;
    display: flex;
    gap: 0.75rem;
    justify-content: space-between;
  }

  .world-section__meta {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .world-section__label {
    color: var(--fusion-text);
    font-size: 0.8125rem;
  }

  .world-section__hint {
    color: var(--fusion-text-subtle);
    font-size: 0.75rem;
  }

  .world-section__select,
  .world-section__number {
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    flex-shrink: 0;
    font: inherit;
    padding: 0.25rem 0.4rem;
  }

  .world-section__number {
    width: 5rem;
  }
</style>
