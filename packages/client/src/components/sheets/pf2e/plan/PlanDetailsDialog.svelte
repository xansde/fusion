<script lang="ts">
  /**
   * PlanDetailsDialog.svelte — read-only details modal for the Plan column's
   * INLINE items (R12 feedback, print 2: the locked auto-feature chips —
   * "Arcane Spellcasting (Magus)", "Arcane Cascade", "Spellstrike", "Conflux
   * Spells" — and already-filled feat/hybrid-study slots need to explain what
   * they mean when clicked).
   *
   * Unlike CompendiumPickerDialog this dialog makes NO choice — it only shows
   * the ORC/OGL description/mechanics of ONE named compendium document. The
   * caller (PlanColumn) passes a { packSlug, name, level? } request; this
   * dialog resolves it to a compendium uuid by searching the pack's index for
   * a matching name (findEntryUuidByName — accent/case-insensitive), then
   * fetches the full document via getDocument(uuid) and renders it in the
   * shared DocumentDetailsPanel. `request.level` — the plan's own grant level
   * for this item, when the caller knows it — is forwarded as `contextLevel`
   * so a shared class-features-core document's divergent static level
   * (issue #58) doesn't leak into the panel.
   *
   * Why resolve by NAME and not uuid: the chips come from the class item's
   * `featuresByLevel[].uuid`, which is a bare Foundry id (e.g.
   * "xvC1jNDkNdNtZQiF"), NOT a "Compendium.<pack>.Item.<id>" uuid, so it
   * cannot feed compendium:get. Filled slots only know the embedded item's
   * name, and that item's own description may be empty (pre-r11 imports).
   * Name resolution against the pack (which always has the r11 ORC/OGL
   * description) is the one path that works for every case.
   *
   * SOCKET: resolved LIVE via getSocket() per operation — never held as a
   * prop (frozen-socket rationale — see SpellPickerDialog.svelte docstring).
   */

  import type { PackIndexEntry } from "@fusion/shared";
  import {
    listPacks,
    searchPack,
    getDocument,
    requireConnectedSocket,
  } from "../../../../lib/compendium/compendiumApi.js";
  import { DocumentDetailsCache } from "../../../../lib/compendium/documentDetails.js";
  import { findEntryUuidByName, type PlanDetailsRequest } from "../../../../lib/sheets/pf2e/planVM.js";
  import DocumentDetailsPanel from "../DocumentDetailsPanel.svelte";
  import { session, getSocket } from "../../../../lib/session.svelte.js";
  import { t, i18n } from "../../../../lib/i18n/i18n.js";

  interface Props {
    /** Which pack to search + the item name to resolve. */
    request: PlanDetailsRequest;
    onClose: () => void;
  }

  let { request, onClose }: Props = $props();

  let detailsDoc = $state<Record<string, unknown> | null>(null);
  let loading = $state(true);
  // "not-found" = pack loaded but no entry matched the name; "load" = socket/
  // fetch failure. Both surface a retry; "not-found" gets its own copy.
  let errorKind = $state<"not-found" | "load" | null>(null);
  // The matched pack entry's pt-BR name (r14 #3) — used as the dialog title so
  // the header matches the pt-BR body/description, with the EN name (request.
  // name) as the always-shown subtitle. null until resolved / when untranslated.
  let resolvedNamePt = $state<string | null>(null);

  const systemId = $derived(session.worldInfo?.systemId ?? "pf2e");
  const detailsCache = new DocumentDetailsCache();

  // Title parts (r14 #3): pt-BR main + EN subtitle on pt-BR locale. r15 A2: the
  // EN subtitle is SUPPRESSED when it's identical to the pt-BR name (case/trim-
  // insensitive) — no redundant "Bon Mot / Bon Mot" (matches the Plan slots'
  // and Actions tab's behavior). Falls back to the EN request name alone before
  // resolution / on the en locale.
  const titleMain = $derived(
    i18n.locale === "pt-BR" && resolvedNamePt ? resolvedNamePt : request.name,
  );
  const titleSubEn = $derived(
    i18n.locale === "pt-BR" &&
      resolvedNamePt &&
      resolvedNamePt.trim().toLowerCase() !== request.name.trim().toLowerCase()
      ? request.name
      : null,
  );

  $effect(() => {
    void resolveAndLoad();
  });

  async function resolveAndLoad(): Promise<void> {
    loading = true;
    errorKind = null;
    detailsDoc = null;
    resolvedNamePt = null;
    try {
      const sock = requireConnectedSocket(getSocket());
      const { packs } = await listPacks(sock, { systemId, documentType: "Item" });
      const pack = packs.find((p) => p.id.endsWith(`.${request.packSlug}`));
      if (!pack) {
        errorKind = "not-found";
        return;
      }
      const { entries } = await searchPack(sock, { packId: pack.id });
      const uuid = findEntryUuidByName(entries as PackIndexEntry[], request.name);
      if (!uuid) {
        errorKind = "not-found";
        return;
      }
      // Capture the matched entry's pt-BR name for the header (r14 #3).
      const matched = (entries as PackIndexEntry[]).find((e) => e.uuid === uuid);
      const pt = matched?.namePt ?? matched?.i18n?.ptBR?.name;
      resolvedNamePt = typeof pt === "string" && pt.trim() ? pt.trim() : null;
      const cached = detailsCache.get(uuid);
      if (cached) {
        detailsDoc = cached;
        return;
      }
      const { document } = await getDocument(sock, uuid);
      detailsCache.set(uuid, document);
      detailsDoc = document;
    } catch {
      // Socket-unavailable and generic fetch failures both surface the same
      // load error + retry — a disconnected socket is just as recoverable as
      // a transient failure here, and this dialog has no separate "not
      // connected" copy of its own.
      errorKind = "load";
    } finally {
      loading = false;
    }
  }
</script>

<div class="details-backdrop" role="presentation" onclick={onClose} onkeydown={(e) => { if (e.key === "Escape") onClose(); }}>
  <div
    class="details-modal"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    aria-label={request.name}
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => { if (e.key === "Escape") onClose(); }}
  >
    <div class="details-modal__header">
      <h2 class="details-modal__title">
        {titleMain}
        {#if titleSubEn}<span class="details-modal__title-en">{titleSubEn}</span>{/if}
      </h2>
      <button type="button" class="details-modal__close" onclick={onClose} aria-label={t("FUSION.Dialog.Close")}>
        &times;
      </button>
    </div>

    <div class="details-modal__body">
      {#if errorKind === "not-found"}
        <div class="details-modal__state">
          <span>{t("FUSION.Sheet.Plan.Details.NotFound")}</span>
        </div>
      {:else}
        <DocumentDetailsPanel
          document={detailsDoc}
          {loading}
          error={errorKind === "load"}
          onRetry={() => void resolveAndLoad()}
          contextLevel={request.level ?? null}
          loadingKey="FUSION.Sheet.Plan.Picker.Details.Loading"
          loadErrorKey="FUSION.Sheet.Plan.Picker.Details.LoadError"
          retryKey="FUSION.Sheet.Plan.Picker.Details.Retry"
          selectHintKey="FUSION.Sheet.Plan.Picker.Details.SelectHint"
          noDescriptionKey="FUSION.Sheet.Plan.Picker.Details.NoDescription"
        />
      {/if}
    </div>

    <div class="details-modal__footer">
      <span class="details-modal__note">{t("FUSION.Sheet.Plan.Picker.CleanRoomNote")}</span>
    </div>
  </div>
</div>

<style>
  .details-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    z-index: 100;
  }

  .details-modal {
    width: 480px;
    max-width: 100%;
    max-height: 640px;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-lg);
    box-shadow: var(--fusion-shadow-modal);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .details-modal__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--fusion-border);
    flex-shrink: 0;
  }

  .details-modal__title {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    color: var(--fusion-text);
  }

  /* EN subtitle beside the pt-BR dialog title (r14 #3). */
  .details-modal__title-en {
    margin-left: 8px;
    font-size: 11.5px;
    font-weight: 400;
    color: var(--fusion-text-subtle);
  }

  .details-modal__close {
    width: 24px;
    height: 24px;
    border-radius: var(--fusion-radius-sm);
    border: 1px solid var(--fusion-border);
    background: transparent;
    color: var(--fusion-text-muted);
    cursor: pointer;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--fusion-font);
  }

  .details-modal__close:hover {
    border-color: var(--fusion-danger);
    color: var(--fusion-danger);
  }

  .details-modal__body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }

  .details-modal__state {
    padding: 32px 16px;
    text-align: center;
    font-size: 12.5px;
    color: var(--fusion-text-muted);
  }

  .details-modal__footer {
    padding: 12px 18px;
    border-top: 1px solid var(--fusion-border);
    flex-shrink: 0;
  }

  .details-modal__note {
    font-size: 10.5px;
    color: var(--fusion-text-subtle);
  }
</style>
