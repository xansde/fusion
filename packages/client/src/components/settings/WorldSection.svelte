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
   * (`buildSettingWriteOp`, REQ-CFG-071) — never a bespoke setting-write op —
   * and are serialized per key by `createSettingWriter` (HJ-RH, M2).
   * No optimistic update: the control only reflects a NEW value once the ack
   * confirms it (`applyWorldSettingWrite`), never before. On a refusal
   * (REQ-CFG-073/042) `commit` does two things `worldSettingsRegistry` alone
   * cannot: records the server's reason in `state` (rendered under the row,
   * `FUSION.Settings.World.WriteFailed`) and forces the control's DOM value
   * back to what `controlForRow(row)` still says — a plain checkbox/select's
   * `checked`/`value` is native browser state the moment the user acts on
   * it, and since the row itself never changed on a refusal, Svelte's own
   * `checked={control.checked}` binding has nothing to re-run (the
   * expression's value is unchanged), so nobody else undoes the browser's
   * own edit.
   *
   * Turning a boolean row OFF goes through one more generic gate first
   * (REQ-CFG-082, DEC-CFG-09): `resolveBooleanWrite` (worldSettingsSection.ts)
   * decides — from `row.requiresConfirmOnDisable`/`row.value` alone, never a
   * key — whether this is the ONE gesture the tab confirms; if so, it asks
   * the server how many actors are affected and gates on a native
   * `confirm()` (same precedent as ActorDirectory's delete, not a floating
   * window) showing the count before commit ever runs. Turning ON always
   * skips straight to commit. A cancelled confirm reverts the checkbox the
   * same way a refusal does — nothing was ever applied, but the browser
   * still flipped it natively before this handler ran.
   *
   * `state` (`WorldSectionState`) is an injectable prop, same pattern as
   * `UsersSection.svelte`'s `flow` — defaults to a fresh instance per mount
   * (the drawer remounts the panel on every switch, REQ-GAV-017), and lets
   * tests pre-seed a refusal before a `svelte/server` render.
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
    controlForRow,
    createSettingWriter,
    resolveBooleanWrite,
    toggleListOption,
    type WorldSettingRow,
  } from "../../lib/settings/worldSettingsSection.js";
  import { querySettingDisableImpact } from "../../lib/settings/worldSettingsImpact.js";
  import { WorldSectionState } from "../../lib/settings/worldSectionState.svelte.js";

  interface Props {
    socket: Socket;
    state?: WorldSectionState;
  }

  const { socket, state = new WorldSectionState() }: Props = $props();

  // The drawer mounts a fresh panel on every switch (REQ-GAV-017), so there is
  // nothing to keep reactive to a socket reconnect here.
  // svelte-ignore state_referenced_locally
  void ensureWorldSettingsRegistry(socket);

  const rows = $derived(worldSettingsRegistry.rows);

  function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  /** REQ-CFG-073/042: put a control's DOM value back to what the row still holds. */
  function revertControl(row: WorldSettingRow, target: HTMLInputElement | HTMLSelectElement): void {
    const control = controlForRow(row);
    if (control.kind === "boolean") {
      (target as HTMLInputElement).checked = control.checked;
    } else if (control.kind === "enumList") {
      // `target` is the one checkbox the user flipped: put it back to whether
      // the row still lists its option.
      const input = target as HTMLInputElement;
      input.checked = control.selected.includes(input.value);
    } else if (control.kind === "number") {
      (target as HTMLInputElement).value = String(control.value);
    } else {
      (target as HTMLSelectElement).value = control.value;
    }
  }

  // HJ-RH (M2): every write to a key goes through one queue, so a second tick
  // before the first ack builds on the first's accepted value, and the first
  // write of a key is the only `doc:create`.
  const writer = createSettingWriter({
    send: (op) => sendOp<{ documents?: Array<{ _id: string }> }>(socket, op),
    getRow: (key) => worldSettingsRegistry.rows.find((r) => r.key === key),
    apply: applyWorldSettingWrite,
  });

  async function commit(
    row: WorldSettingRow,
    nextFor: (current: WorldSettingRow) => unknown,
    target: HTMLInputElement | HTMLSelectElement,
  ): Promise<void> {
    const outcome = await writer.write(row.key, nextFor);
    if (outcome.ok) {
      state.clearError(row.key);
      return;
    }
    // REQ-CFG-073: a refusal reverts the control to the value the server
    // last actually accepted, and shows why.
    state.setError(row.key, errorMessage(outcome.error));
    revertControl(worldSettingsRegistry.rows.find((r) => r.key === row.key) ?? row, target);
  }

  /**
   * The gate every boolean row's checkbox goes through (REQ-CFG-082,
   * DEC-CFG-09) — see module docstring.
   */
  async function handleBooleanChange(
    row: WorldSettingRow,
    nextValue: boolean,
    target: HTMLInputElement,
  ): Promise<void> {
    const shouldCommit = await resolveBooleanWrite(row, nextValue, {
      confirmDisable: (message) => confirm(message),
      queryImpact: (key) => querySettingDisableImpact(socket, key),
      formatConfirmMessage: (count) => t("FUSION.Settings.World.ConfirmDisable", { count }),
    });
    if (shouldCommit) {
      await commit(row, () => nextValue, target);
    } else {
      // Cancelled: nothing was ever applied, but the browser already
      // flipped the checkbox natively before this handler ran.
      revertControl(row, target);
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
        {@const rowError = state.errorFor(row.key)}
        <li class="world-section__row">
          <div class="world-section__meta">
            <span class="world-section__label">{row.label}</span>
            {#if row.hint}
              <span class="world-section__hint">{row.hint}</span>
            {/if}
            {#if rowError}
              <span class="world-section__error"
                >{t("FUSION.Settings.World.WriteFailed", { message: rowError })}</span
              >
            {/if}
          </div>

          {#if control.kind === "boolean"}
            <label class="world-section__toggle">
              <input
                type="checkbox"
                checked={control.checked}
                onchange={(event) => {
                  const target = event.currentTarget as HTMLInputElement;
                  void handleBooleanChange(row, target.checked, target);
                }}
              />
            </label>
          {:else if control.kind === "enum"}
            <select
              class="world-section__select"
              value={control.value}
              onchange={(event) => {
                const target = event.currentTarget as HTMLSelectElement;
                const value = target.value;
                void commit(row, () => value, target);
              }}
            >
              {#each control.options as option (option)}
                <option value={option}>{option}</option>
              {/each}
            </select>
          {:else if control.kind === "enumList"}
            <!-- HJ-09: a list drawn from a closed set, one checkbox per option.
                 Every tick writes the WHOLE list (declared order) — see
                 `toggleListOption`. -->
            <div class="world-section__checklist" role="group" aria-label={row.label}>
              {#each control.options as option (option.value)}
                <label class="world-section__check">
                  <input
                    type="checkbox"
                    value={option.value}
                    checked={control.selected.includes(option.value)}
                    onchange={(event) => {
                      const target = event.currentTarget as HTMLInputElement;
                      // Computed when this write's turn comes (HJ-RH, M2), from the
                      // list the previous write left — not from this render's.
                      const on = target.checked;
                      void commit(
                        row,
                        (current: WorldSettingRow) => {
                          const now = controlForRow(current);
                          return toggleListOption(
                            current,
                            now.kind === "enumList" ? now.selected : [],
                            option.value,
                            on,
                          );
                        },
                        target,
                      );
                    }}
                  />
                  <span>{option.label}</span>
                </label>
              {/each}
            </div>
          {:else if control.kind === "number"}
            <input
              class="world-section__number"
              type="number"
              value={control.value}
              onchange={(event) => {
                const target = event.currentTarget as HTMLInputElement;
                const value = Number(target.value);
                void commit(row, () => value, target);
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

  .world-section__error {
    color: var(--fusion-danger);
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

  .world-section__checklist {
    display: grid;
    flex-shrink: 0;
    gap: 0.15rem 0.75rem;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    max-width: 22rem;
  }

  .world-section__check {
    align-items: center;
    color: var(--fusion-text);
    display: flex;
    font-size: 0.75rem;
    gap: 0.35rem;
  }

  .world-section__row:has(.world-section__checklist) {
    align-items: flex-start;
    flex-direction: column;
  }
</style>
