<script lang="ts">
  /**
   * ContactsPanel.svelte — the Contatos tab of the side drawer (spec 39, id "contacts").
   *
   * This file draws the section **Na mesa** (spec 39 §5.3) and the header the whole
   * tab shares (§5.2): a search bar and nothing else — no tab title, no ✕, because
   * collapsing is the rail's gesture (REQ-CTT-010, DEC-GAV-03).
   *
   * Every rule lives in `lib/contacts/contactsVM.ts`; this component is the shell
   * that binds it to the mirror, the socket and the keyboard. Three of those rules
   * are visible in the markup and are worth naming:
   *
   *  - **No hit points, for any role** (REQ-CTT-021, DEC-CTT-02). The card shape the
   *    view model produces cannot carry them, and nothing here reaches into the raw
   *    document to fetch them.
   *  - **Never by colour alone** (REQ-CTT-094): "you", presence and the fallback
   *    title all carry text as well as a shape.
   *  - **Dragging to the map** (REQ-CTT-028, DEC-CTT-12): the Master drags any card; a
   *    player drags the card of an actor he owns, and each sub-character drags itself
   *    (REQ-TOK-030a). The drop path is the one the canvas already understands
   *    (`application/fusion-actor`, REQ-UIF-044).
   *
   * It also draws the section **Conhecidos** (§5.5) and the user's own categories
   * (§5.6). Two rules of that half are worth naming here as well:
   *
   *  - **A glimpsed contact has no identity to draw** (REQ-CTT-041/042): the view
   *    model hands over an empty name, no portrait and both affordances off, so the
   *    markup has nothing to leak and no control to hide.
   *  - **Categories never leave the device** (REQ-CTT-055/056): they are read and
   *    written through `lib/contacts/categories.ts`, keyed by world + user, and no
   *    socket call in this file carries one.
   *
   * The tab's foot belongs to the Mestre alone: a fixed footer that opens the
   * "Quem conhece quem" window (REQ-CTT-060). It is a FOOTER, not a header,
   * because the header is the search field and that serves both roles; and no
   * card above it carries a knowledge control of any kind (REQ-CTT-067) — the
   * editing lives in that window and nowhere else.
   *
   * Two more rules of the tab close here (G066):
   *
   *  - **the empty states** (REQ-CTT-090/091), one per role for the table and one of
   *    its own for the Conhecidos, and **none of them offers to create an actor**
   *    (REQ-CTT-092, DEC-CTT-01) — this file has no `doc:create` at all;
   *  - **the state dot of the tab** (REQ-CTT-002/003): mounting this panel IS the
   *    tab being open, so mount and unmount are what `setContactsTabVisible` reports.
   *    The rule that lights it lives in `lib/contacts/knowledgeBadge.ts`, and it has
   *    to keep working with the tab closed — which is why it follows the mirror from
   *    the session, not from here (REQ-GAV-017).
   */

  import { onDestroy, onMount, untrack } from "svelte";
  import type { SidebarPanelProps } from "../../lib/sidebar/registry.js";
  import { worldMirror } from "../../lib/docs/worldSync.js";
  import { presenceState } from "../../lib/presence/presenceStore.svelte.js";
  import { buildActorDragPayload } from "../../lib/actors/actorDirectory.js";
  import type { ActorDocument } from "../../lib/actors/actorDirectory.js";
  import {
    buildKnownSection,
    buildTableSection,
    contactTitleDiff,
    isKnownContact,
    isPlayerCharacter,
    type ContactActorDoc,
    type ContactCard,
    type KnownContactCard,
    type SubContactCard,
  } from "../../lib/contacts/contactsVM.js";
  import { setContactsTabVisible } from "../../lib/contacts/knowledgeBadge.js";
  import {
    conditionRegistry,
    ensureConditionRegistry,
  } from "../../lib/conditions/conditionRegistry.svelte.js";
  import {
    assignContactToCategory,
    createCategory,
    deleteCategory,
    loadContactCategories,
    moveCategory,
    renameCategory,
    saveContactCategories,
    type ContactCategories,
  } from "../../lib/contacts/categories.js";
  import { openActorSheet } from "../../lib/sheets/openActorSheet.js";
  import { sendOp, toEnvelope, OpError, makeSendOpFn } from "../../lib/docs/sendOp.js";
  import { getSocket } from "../../lib/session.svelte.js";
  import { t } from "../../lib/i18n/i18n.js";
  import Icon from "../common/Icon.svelte";
  import ActorPortrait from "$lib/components/common/ActorPortrait.svelte";
  import ConditionChips from "../common/ConditionChips.svelte";
  import { openKnowledgeWindow } from "../../lib/contacts/knowledgeWindow.js";

  const { socket, worldId, userId, isGm }: SidebarPanelProps = $props();

  let query = $state("");
  // Seeded from the mirror at construction, not inside the effect: the panel is
  // mounted only while its tab is open (REQ-GAV-017), so it must draw the table the
  // client already has on its very first frame (RNF-CTT-01 — no fetch, no sheet).
  let actors = $state<ContactActorDoc[]>(worldMirror.getByType<ContactActorDoc>("Actor"));
  /** Id of the card whose title is being rewritten, or null (REQ-CTT-024). */
  let editingTitleOf = $state<string | null>(null);
  let titleDraft = $state("");
  let titleError = $state<string | null>(null);

  $effect(() => {
    const unsubscribe = worldMirror.subscribe<ContactActorDoc>("Actor", (docs) => {
      actors = docs;
    });
    actors = worldMirror.getByType<ContactActorDoc>("Actor");
    return unsubscribe;
  });

  /**
   * Who is connected right now (REQ-CTT-015). The local user is always in the set:
   * he is looking at the panel, so his own character is never drawn as away.
   */
  const onlineUserIds = $derived(
    new Set<string>([
      userId,
      ...presenceState.onlineUsers.filter((user) => user.online).map((user) => user.userId),
    ]),
  );

  /**
   * The chips are painted from what the SYSTEM declared (REQ-CTT-031/032/034,
   * DEC-CTT-11): tone gives the colour, `critical` the emphasis, `help` the
   * tooltip. The client cannot import a game system, so the dictionary is
   * fetched once per seat and read reactively from here — empty until it lands,
   * which degrades the chip instead of hiding the condition (REQ-CTT-035).
   */
  const conditionDeclarations = $derived(conditionRegistry.declarations);

  const section = $derived(
    buildTableSection({
      actors,
      userId,
      isPrivileged: isGm,
      query,
      onlineUserIds,
      conditionDeclarations,
    }),
  );

  const cards = $derived([...section.mine, ...section.others]);

  /**
   * Whether the table has anyone at all, and whether the story has introduced
   * anyone at all. Both are read from the payload rather than from the filtered
   * sections on purpose: the empty states of REQ-CTT-090/091 speak about the
   * table, not about a search that happens to match nothing.
   */
  const hasCharacters = $derived(actors.some(isPlayerCharacter));
  const hasKnownContacts = $derived(actors.some(isKnownContact));

  /**
   * The tab is open exactly while this panel is mounted: the drawer keeps only the
   * active tab's panel alive and drops it on switch or collapse (REQ-GAV-017), so
   * mount and unmount ARE the signal. Opening puts the state dot out and writes the
   * mark of what was seen (REQ-CTT-003); the rail never touches a badge
   * (REQ-GAV-022). Same pairing the chat uses for its unread counter.
   */
  onMount(() => {
    setContactsTabVisible(true);
    // Fire and forget: the panel never waits on the dictionary (RNF-CTT-01), and
    // the call is single-flight, so re-opening the tab does not ask again.
    void ensureConditionRegistry(socket);
  });

  onDestroy(() => {
    setContactsTabVisible(false);
  });

  // -------------------------------------------------------------------------
  // The Conhecidos section and the user's own categories (spec 39 §5.5/§5.6)
  // -------------------------------------------------------------------------

  /**
   * The viewer's categories, read from this device for this world and user
   * (REQ-CTT-055). Seeded at construction for the same reason `actors` is: the panel
   * mounts only while its tab is open and must draw its blocks on the first frame.
   */
  let categories = $state<ContactCategories>(
    // Read once, on purpose (hence `untrack`): the seat does not change identity
    // while the panel is mounted, and re-reading storage would undo a live edit.
    untrack(() => loadContactCategories(worldId, userId)),
  );
  /** Whether the "new category" field is open (REQ-CTT-050). */
  let creatingCategory = $state(false);
  let categoryDraft = $state("");
  /** Name of the category being renamed, or null (REQ-CTT-050). */
  let renamingCategory = $state<string | null>(null);
  let renameDraft = $state("");

  const known = $derived(
    buildKnownSection({
      actors,
      isPrivileged: isGm,
      query,
      categories,
      conditionDeclarations,
    }),
  );

  /** Every mutation goes through here, so nothing changes without being persisted. */
  function commitCategories(next: ContactCategories): void {
    if (next === categories) return;
    categories = next;
    saveContactCategories(worldId, userId, next);
  }

  function confirmNewCategory(): void {
    commitCategories(createCategory(categories, categoryDraft));
    categoryDraft = "";
    creatingCategory = false;
  }

  function onNewCategoryKeydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmNewCategory();
    } else if (event.key === "Escape") {
      event.preventDefault();
      categoryDraft = "";
      creatingCategory = false;
    }
  }

  function startRenaming(name: string): void {
    renamingCategory = name;
    renameDraft = name;
  }

  function confirmRename(name: string): void {
    commitCategories(renameCategory(categories, name, renameDraft));
    renamingCategory = null;
    renameDraft = "";
  }

  function onRenameKeydown(event: KeyboardEvent, name: string): void {
    if (event.key === "Enter") {
      event.preventDefault();
      confirmRename(name);
    } else if (event.key === "Escape") {
      event.preventDefault();
      renamingCategory = null;
      renameDraft = "";
    }
  }

  /**
   * Drop a category (REQ-CTT-052). Its contacts return to "Sem categoria" and no
   * actor is touched — this panel has no path that deletes a document at all
   * (DEC-CTT-01).
   */
  function removeCategory(name: string): void {
    commitCategories(deleteCategory(categories, name));
    if (renamingCategory === name) renamingCategory = null;
  }

  /** Move a category one place up or down in the user's own order (REQ-CTT-054). */
  function nudgeCategory(name: string, delta: number): void {
    const index = categories.order.indexOf(name);
    if (index === -1) return;
    commitCategories(moveCategory(categories, name, index + delta));
  }

  /** File a contact under one category, or none (REQ-CTT-051). */
  function fileContact(contactId: string, category: string): void {
    commitCategories(
      assignContactToCategory(categories, contactId, category.length > 0 ? category : null),
    );
  }

  function onDragStartKnown(event: DragEvent, card: KnownContactCard): void {
    if (!card.draggable || !event.dataTransfer) return;
    const doc = docOf(card.id);
    if (!doc) return;
    const payload = buildActorDragPayload({
      ...(doc as unknown as ActorDocument),
      name: card.name,
      type: doc.type ?? "npc",
    });
    event.dataTransfer.setData("application/fusion-actor", JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "copy";
  }

  /** The raw document behind a card — needed by the sheet opener and by the drag. */
  function docOf(id: string): ContactActorDoc | undefined {
    return actors.find((doc) => doc._id === id);
  }

  // -------------------------------------------------------------------------
  // The sheet (REQ-CTT-027)
  // -------------------------------------------------------------------------

  function openSheet(id: string): void {
    const doc = docOf(id);
    if (!doc) return;
    const ownership = (doc.ownership ?? {}) as Record<string, number>;
    const level = isGm ? 3 : (ownership[userId] ?? ownership["default"] ?? 0);
    const opts = {
      userId,
      ownership: level,
      isGm,
      worldId,
      socket,
      // Lazy socket accessor: a captured socket goes stale across a reconnect.
      sendOpFn: makeSendOpFn(() => getSocket() ?? socket),
    };
    const raw = doc as unknown as Record<string, unknown>;
    openActorSheet(doc._id, raw, opts);
  }

  // -------------------------------------------------------------------------
  // The title (REQ-CTT-024) — the server has the last word (REQ-CTT-085)
  // -------------------------------------------------------------------------

  function startEditingTitle(card: ContactCard): void {
    if (!card.canEditTitle) return;
    editingTitleOf = card.id;
    titleDraft = card.title.kind === "title" ? card.title.text : "";
    titleError = null;
  }

  function cancelEditingTitle(): void {
    editingTitleOf = null;
    titleDraft = "";
  }

  async function commitTitle(card: ContactCard): Promise<void> {
    const next = titleDraft.trim();
    editingTitleOf = null;
    if (card.title.kind === "title" && next === card.title.text) return;
    if (card.title.kind !== "title" && next.length === 0) return;
    try {
      // A001: goes through the same funnel every other call site in the repo
      // uses — toEnvelope() fills `expectedVersion` from the DocumentMirror
      // (sendOp.ts's fillExpectedVersion), which the server requires on the
      // primary doc:update path for a non-privileged writer (doc-handlers.ts).
      // Calling sendOp() with a hand-built wire envelope, as this used to,
      // skips that fill entirely and the server refuses with
      // "expectedVersion is required for Actor/<id> — reload the document
      // and retry" (REQ-CTT-024, REQ-CTT-085).
      // Built as a plain (un-annotated) const, then passed by reference:
      // toEnvelope's `op` parameter only requires `{ readonly type: string }`,
      // and TS's excess-property check applies to a FRESH object literal, not
      // to a variable reference — so `documentType`/`id`/`diff` are accepted
      // without widening the parameter type or duplicating the "doc:update"
      // literal a second time.
      const op = {
        type: "doc:update",
        documentType: "Actor",
        id: card.id,
        diff: contactTitleDiff(next),
      };
      await sendOp(socket, toEnvelope(op));
      titleError = null;
    } catch (err) {
      // REQ-CTT-080: hiding the control is not the protection — the server refuses,
      // and the refusal is shown instead of being swallowed.
      titleError = err instanceof OpError ? err.message : String(err);
    }
  }

  function onTitleKeydown(event: KeyboardEvent, card: ContactCard): void {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitTitle(card);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelEditingTitle();
    }
  }

  // -------------------------------------------------------------------------
  // Drag to the canvas (REQ-CTT-028)
  // -------------------------------------------------------------------------

  /** Put the actor behind a card on the drag, in the payload the canvas already reads. */
  function startActorDrag(event: DragEvent, id: string, name: string): void {
    const doc = docOf(id);
    if (!doc || !event.dataTransfer) return;
    const payload = buildActorDragPayload({
      ...(doc as unknown as ActorDocument),
      name,
      type: doc.type ?? "character",
    });
    event.dataTransfer.setData("application/fusion-actor", JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "copy";
  }

  function onDragStart(event: DragEvent, card: ContactCard): void {
    if (!card.draggable) return;
    startActorDrag(event, card.id, card.name);
  }

  /**
   * A sub-character drags ITSELF, never the card it sits in (REQ-TOK-030a): the sub-row
   * is its own drag source, and the event is stopped here so the master's handler —
   * which would put the master's actor on the drag — does not run after it.
   */
  function onDragStartSub(event: DragEvent, sub: SubContactCard): void {
    event.stopPropagation();
    if (!sub.draggable) return;
    startActorDrag(event, sub.id, sub.name);
  }

  /** pt-BR name of a companion kind, degrading to the raw kind when undeclared. */
  function companionKindLabel(kind: string): string {
    const key = `FUSION.Contacts.CompanionKind.${kind}`;
    const label = t(key);
    return label === key ? kind : label;
  }

  function subCharactersOf(card: ContactCard): readonly SubContactCard[] {
    return card.subCharacters;
  }

  // -------------------------------------------------------------------------
  // The Mestre's footer (REQ-CTT-060) — the one door to the knowledge grid
  // -------------------------------------------------------------------------

  /**
   * Open "Quem conhece quem" outside the drawer (REQ-CTT-061). The open call lives
   * in `lib/contacts/knowledgeWindow.ts` because the NPCs tab's footer opens the
   * very same window (REQ-NPC-072): one function, one singleton key, one grid —
   * a second click from either tab focuses the window already open (REQ-UIF-014).
   */
  function openKnowledgeGrid(): void {
    openKnowledgeWindow(socket);
  }
</script>

<div class="contacts-panel">
  <!-- REQ-CTT-010: a fixed bar with the search field taking the available width,
       no textual title of the tab and no ✕. -->
  <header class="contacts-panel__search">
    <input
      type="search"
      class="contacts-panel__search-input"
      placeholder={t("FUSION.Contacts.Search")}
      aria-label={t("FUSION.Contacts.Search")}
      bind:value={query}
    />
  </header>

  <div class="contacts-panel__body">
    {#if titleError}
      <p class="contacts-panel__error" role="alert">
        {t("FUSION.Contacts.Title.Failed", { message: titleError })}
      </p>
    {/if}

    <section class="contacts-panel__section" aria-label={t("FUSION.Contacts.Section.Table")}>
      <h2 class="contacts-panel__section-head">
        <span class="contacts-panel__section-name">{t("FUSION.Contacts.Section.Table")}</span>
        <span class="contacts-panel__section-count">{section.total}</span>
      </h2>

      {#if !hasCharacters}
        <!-- REQ-CTT-090: one empty state per role — the player is told he has no
             character at this table, the Mestre that no player character exists yet.
             REQ-CTT-092: neither offers to create an actor, and there is no control
             of any kind in here to do it (DEC-CTT-01). -->
        <p class="contacts-panel__empty" data-empty="table" data-empty-role={isGm ? "gm" : "player"}>
          {isGm ? t("FUSION.Contacts.Empty.Gm") : t("FUSION.Contacts.Empty.Player")}
        </p>
      {:else if cards.length > 0}
        <div class="contacts-panel__list" role="list">
          {#each cards as card (card.id)}
            <!-- REQ-CTT-027: double-click opens the sheet, and the button below is the
                 keyboard-reachable path to the same thing (DEC-CTT-13). -->
            <div
              class="contact-card"
              class:contact-card--mine={card.isMine}
              class:contact-card--away={!card.present}
              role="listitem"
              data-contact-id={card.id}
              data-mine={card.isMine}
              data-present={card.present}
              draggable={card.draggable}
              ondragstart={(event) => onDragStart(event, card)}
              ondblclick={() => openSheet(card.id)}
            >
              <div class="contact-card__head">
                <ActorPortrait
                  img={card.img}
                  docRef={{ table: "actors", id: card.id }}
                  name={card.name}
                  size={34}
                />

                <div class="contact-card__identity">
                  <span class="contact-card__name-line">
                    <span class="contact-card__name">{card.name}</span>
                    {#if card.isMine}
                      <!-- REQ-CTT-022 / REQ-CTT-094: a word, not only a colour. -->
                      <span class="contact-card__tag contact-card__tag--mine"
                        >{t("FUSION.Contacts.You")}</span
                      >
                    {/if}
                    <span class="contact-card__presence">
                      <span class="contact-card__presence-dot" aria-hidden="true"></span>
                      <span class="contact-card__presence-text">
                        {card.present
                          ? t("FUSION.Contacts.Presence.Online")
                          : t("FUSION.Contacts.Presence.Offline")}
                      </span>
                    </span>
                  </span>

                  {#if editingTitleOf === card.id}
                    <!-- REQ-CTT-024: Enter confirms, Esc cancels, in the card itself. -->
                    <input
                      class="contact-card__title-input"
                      value={titleDraft}
                      aria-label={t("FUSION.Contacts.Title.Label", { name: card.name })}
                      placeholder={t("FUSION.Contacts.Title.Placeholder")}
                      oninput={(event) => {
                        titleDraft = event.currentTarget.value;
                      }}
                      onkeydown={(event) => onTitleKeydown(event, card)}
                      onblur={() => cancelEditingTitle()}
                    />
                  {:else}
                    <span class="contact-card__title-line">
                      <span
                        class="contact-card__title"
                        class:contact-card__title--fallback={card.title.kind === "fallback"}
                        data-title-kind={card.title.kind}>{card.title.text}</span
                      >
                      {#if card.canEditTitle}
                        <button
                          class="contact-card__icon-btn"
                          type="button"
                          aria-label={t("FUSION.Contacts.Title.Edit", { name: card.name })}
                          onclick={() => startEditingTitle(card)}
                        >
                          
                          <Icon name="pencil" size={16} />
                        </button>
                      {/if}
                    </span>
                  {/if}
                </div>

                <button
                  class="contact-card__icon-btn contact-card__sheet-btn"
                  type="button"
                  aria-label={t("FUSION.Contacts.OpenSheet", { name: card.name })}
                  onclick={() => openSheet(card.id)}
                >
                  <Icon name="file-text" size={18} />
                </button>
              </div>

              {#if card.conditions.length > 0}
                <ConditionChips conditions={card.conditions} idPrefix={`contact-${card.id}`} />
              {/if}

              <!-- REQ-CTT-025: the sub-character lives inside this card, never loose. -->
              {#each subCharactersOf(card) as sub (sub.id)}
                <!-- svelte-ignore a11y_no_static_element_interactions -- a drag source, like the card around it; the keyboard path is the sheet button -->
                <div
                  class="contact-card__sub"
                  data-sub-of={card.id}
                  data-sub-id={sub.id}
                  draggable={sub.draggable}
                  ondragstart={(event) => onDragStartSub(event, sub)}
                >
                  <ActorPortrait
                    img={sub.img}
                    docRef={{ table: "actors", id: sub.id }}
                    name={sub.name}
                    size={22}
                  />
                  <span class="contact-card__sub-name">{sub.name}</span>
                  <span class="contact-card__sub-kind">{companionKindLabel(sub.kind)}</span>
                  {#if sub.canOpenSheet}
                    <button
                      class="contact-card__icon-btn contact-card__sheet-btn"
                      type="button"
                      aria-label={t("FUSION.Contacts.OpenSheet", { name: sub.name })}
                      onclick={() => openSheet(sub.id)}
                    >
                      <Icon name="file-text" size={16} />
                    </button>
                  {/if}
                  {#if sub.conditions.length > 0}
                    <ConditionChips conditions={sub.conditions} idPrefix={`sub-${sub.id}`} />
                  {/if}
                </div>
              {/each}
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <!-- Conhecidos (spec 39 §5.5): whoever the story has already introduced. A
         contact at `oculto` is not filtered out here — it never arrived
         (REQ-CTT-043, REQ-CTT-082), so there is nothing to count or to hide. -->
    <section class="contacts-panel__section" aria-label={t("FUSION.Contacts.Section.Known")}>
      <h2 class="contacts-panel__section-head">
        <span class="contacts-panel__section-name">{t("FUSION.Contacts.Section.Known")}</span>
        <span class="contacts-panel__section-count">{known.total}</span>
        <!-- REQ-CTT-050: categories are created from the section header. -->
        <button
          class="contacts-panel__add-category"
          type="button"
          aria-label={t("FUSION.Contacts.Category.Add")}
          onclick={() => {
            creatingCategory = true;
          }}
        >
          <Icon name="plus" size={16} />
        </button>
      </h2>

      {#if creatingCategory}
        <input
          class="contacts-panel__category-input"
          value={categoryDraft}
          aria-label={t("FUSION.Contacts.Category.Name")}
          placeholder={t("FUSION.Contacts.Category.Name")}
          oninput={(event) => {
            categoryDraft = event.currentTarget.value;
          }}
          onkeydown={onNewCategoryKeydown}
          onblur={() => confirmNewCategory()}
        />
      {/if}

      {#if !hasKnownContacts}
        <!-- REQ-CTT-091: nobody has been introduced yet — said as the promise it is,
             not as an error. REQ-CTT-092: no offer to create an actor here either. -->
        <p class="contacts-panel__empty" data-empty="known">{t("FUSION.Contacts.Empty.Known")}</p>
      {/if}

      {#each known.groups as group (group.name ?? "__uncategorized__")}
        <div class="known-group" data-category={group.name ?? ""}>
          <div class="known-group__head">
            {#if group.name !== null && renamingCategory === group.name}
              <input
                class="contacts-panel__category-input"
                value={renameDraft}
                aria-label={t("FUSION.Contacts.Category.Rename", { name: group.name })}
                oninput={(event) => {
                  renameDraft = event.currentTarget.value;
                }}
                onkeydown={(event) => onRenameKeydown(event, group.name ?? "")}
                onblur={() => confirmRename(group.name ?? "")}
              />
            {:else}
              <span class="known-group__name"
                >{group.name ?? t("FUSION.Contacts.Uncategorized")}</span
              >
              <span class="known-group__count">{group.contacts.length}</span>
            {/if}

            <!-- REQ-CTT-053: the "Sem categoria" bucket has no controls at all — it
                 is the absence of a category, not one that could be renamed. -->
            {#if group.name !== null}
              {@const name = group.name}
              <span class="known-group__tools">
                <button
                  class="contact-card__icon-btn"
                  type="button"
                  aria-label={t("FUSION.Contacts.Category.MoveUp", { name })}
                  onclick={() => nudgeCategory(name, -1)}
                >
                  <Icon name="chevron-up" size={16} />
                </button>
                <button
                  class="contact-card__icon-btn"
                  type="button"
                  aria-label={t("FUSION.Contacts.Category.MoveDown", { name })}
                  onclick={() => nudgeCategory(name, 1)}
                >
                  <Icon name="chevron-down" size={16} />
                </button>
                <button
                  class="contact-card__icon-btn"
                  type="button"
                  aria-label={t("FUSION.Contacts.Category.Rename", { name })}
                  onclick={() => startRenaming(name)}
                >
                  <Icon name="pencil" size={16} />
                </button>
                <button
                  class="contact-card__icon-btn"
                  type="button"
                  aria-label={t("FUSION.Contacts.Category.Delete", { name })}
                  onclick={() => removeCategory(name)}
                >
                  <Icon name="trash" size={16} />
                </button>
              </span>
            {/if}
          </div>

          <div class="contacts-panel__list" role="list">
            {#each group.contacts as card (card.id)}
              <div
                class="contact-card known-card"
                class:known-card--unidentified={!card.identified}
                role="listitem"
                data-known-id={card.id}
                data-identified={card.identified}
                draggable={card.draggable}
                ondragstart={(event) => onDragStartKnown(event, card)}
                ondblclick={() => {
                  if (card.canOpenSheet) openSheet(card.id);
                }}
              >
                <div class="contact-card__head">
                  {#if card.identified}
                    <ActorPortrait
                      img={card.img}
                      docRef={{ table: "actors", id: card.id }}
                      name={card.name}
                      size={30}
                    />
                  {:else}
                    <!-- REQ-CTT-041: no portrait to show, so a drawn silhouette
                         stands in — it identifies nobody. -->
                    <span class="known-card__mask" aria-hidden="true">
                      <Icon name="user" size={16} />
                    </span>
                  {/if}

                  <div class="contact-card__identity">
                    {#if card.identified}
                      <span class="contact-card__name-line">
                        <span class="contact-card__name">{card.name}</span>
                      </span>
                      {#if card.title}
                        <span class="contact-card__title-line">
                          <span
                            class="contact-card__title"
                            class:contact-card__title--fallback={card.title.kind === "fallback"}
                            data-title-kind={card.title.kind}>{card.title.text}</span
                          >
                        </span>
                      {/if}
                    {:else}
                      <!-- REQ-CTT-041: explicit words, never only a shape. -->
                      <span class="known-card__unidentified"
                        >{t("FUSION.Contacts.Unidentified")}</span
                      >
                    {/if}

                    <!-- REQ-CTT-044: discreet, and only for a privileged role — the
                         counts exist only where the knowledge map does. -->
                    {#if card.knowledge}
                      <span
                        class="known-card__counts"
                        aria-label={t("FUSION.Contacts.Knowledge.Label", {
                          known: card.knowledge.known,
                          glimpsed: card.knowledge.glimpsed,
                        })}
                      >
                        {t("FUSION.Contacts.Knowledge.Counts", {
                          known: card.knowledge.known,
                          glimpsed: card.knowledge.glimpsed,
                        })}
                      </span>
                    {/if}
                  </div>

                  <!-- REQ-CTT-042: a glimpsed contact offers no sheet at all. -->
                  {#if card.canOpenSheet}
                    <button
                      class="contact-card__icon-btn contact-card__sheet-btn"
                      type="button"
                      aria-label={t("FUSION.Contacts.OpenSheet", { name: card.name })}
                      onclick={() => openSheet(card.id)}
                    >
                      <Icon name="file-text" size={18} />
                    </button>
                  {/if}
                </div>

                {#if card.conditions.length > 0}
                  <ConditionChips conditions={card.conditions} idPrefix={`known-${card.id}`} />
                {/if}

                <!-- REQ-CTT-051: one category, so moving is the only operation there
                     is; REQ-CTT-042 keeps it away from a glimpsed contact. -->
                {#if card.canCategorize}
                  <select
                    class="known-card__category"
                    aria-label={t("FUSION.Contacts.Category.Of", { name: card.name })}
                    value={card.category ?? ""}
                    onchange={(event) => fileContact(card.id, event.currentTarget.value)}
                  >
                    <option value="">{t("FUSION.Contacts.Uncategorized")}</option>
                    {#each categories.order as name (name)}
                      <option value={name}>{name}</option>
                    {/each}
                  </select>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </section>
  </div>

  <!-- REQ-CTT-060: a fixed footer, only for a privileged role. It sits OUTSIDE
       `.contacts-panel__body`, so it never scrolls with the list, and it is the
       only knowledge control in the whole tab (REQ-CTT-067). -->
  {#if isGm}
    <footer class="contacts-panel__footer">
      <button
        class="contacts-panel__footer-btn"
        type="button"
        onclick={openKnowledgeGrid}
        aria-label={t("FUSION.Contacts.Knowledge.Open")}
      >
        
        <Icon name="grid-3x3" size={16} />
        {t("FUSION.Contacts.Knowledge.Open")}
      </button>
    </footer>
  {/if}
</div>

<style>
  .contacts-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    overflow: hidden;
    font-family: var(--fusion-font);
    color: var(--fusion-text);
  }

  /* REQ-CTT-093 (REQ-UIF-064): every control the tab draws says where the focus is.
     Written on the elements themselves rather than on a modifier class, so a control
     added later cannot be born without it. */
  .contacts-panel button:focus-visible,
  .contacts-panel input:focus-visible,
  .contacts-panel select:focus-visible {
    outline: 2px solid var(--fusion-focus);
    outline-offset: 1px;
  }

  /* REQ-CTT-010: the header is the search field, full width, and nothing else. */
  .contacts-panel__search {
    flex: 0 0 auto;
    display: flex;
    padding: 0.5rem;
    border-bottom: 1px solid var(--fusion-border);
  }

  .contacts-panel__search-input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0.35rem 0.5rem;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font: inherit;
    font-size: var(--fusion-text-sm);
    min-height: var(--fusion-target);
  }

  .contacts-panel__body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 0.35rem;
  }

  /* REQ-CTT-060: pinned to the foot of the panel — `flex: 0 0 auto` beside the
     scrolling body is what keeps it from riding along with the list. */
  .contacts-panel__footer {
    flex: 0 0 auto;
    display: flex;
    padding: 0.35rem;
    border-top: 1px solid var(--fusion-border);
    background: var(--fusion-surface);
  }

  .contacts-panel__footer-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--fusion-space-2);
    width: 100%;
    min-height: var(--fusion-target);
    padding: 0.3rem 0.6rem;
    background: var(--fusion-surface-alt);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    font: inherit;
    font-size: var(--fusion-text-sm);
    cursor: pointer;
  }

  .contacts-panel__footer-btn:hover,
  .contacts-panel__footer-btn:focus-visible {
    color: var(--fusion-accent);
    border-color: var(--fusion-accent);
  }

  .contacts-panel__error {
    margin: 0 0 0.4rem;
    color: var(--fusion-danger);
    font-size: var(--fusion-text-xs);
  }

  .contacts-panel__section-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: var(--fusion-space-2) 0;
    font-size: var(--fusion-text-sm);
    font-weight: 500;
    color: var(--fusion-text);
  }

  .contacts-panel__section-count {
    font-variant-numeric: tabular-nums;
    font-weight: 400;
    color: var(--fusion-text-subtle);
  }

  .contacts-panel__empty {
    margin: 0.6rem 0.2rem;
    font-size: var(--fusion-text-sm);
    line-height: var(--fusion-leading);
    color: var(--fusion-text-muted);
  }

  .contacts-panel__list {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .contact-card {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.4rem;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface-alt);
    min-width: 0;
  }

  /* REQ-CTT-022: the viewer's own card gets a shape of its own (a left edge), and
     the word "você" beside the name — never colour on its own (REQ-CTT-094). */
  .contact-card--mine {
    border-left: 3px solid var(--fusion-accent);
  }

  /* REQ-CTT-015: presence dims the card; it never moves it. */
  .contact-card--away .contact-card__name {
    color: var(--fusion-text-muted);
  }

  .contact-card__head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }

  .contact-card__identity {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
    flex: 1 1 auto;
  }

  /* The name keeps its own line when it is long; the tags wrap below it instead of
     squeezing it into a column of word pieces ("Raiz- / funda"). */
  .contact-card__name-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: var(--fusion-space-2);
    row-gap: var(--fusion-space-1);
    min-width: 0;
  }

  .contact-card__name {
    min-width: 0;
    font-size: var(--fusion-text-base);
    font-weight: 600;
    overflow-wrap: break-word;
  }

  .contact-card__tag {
    flex: 0 0 auto;
    padding: 0 var(--fusion-space-2);
    border-radius: var(--fusion-radius-sm);
    font-size: var(--fusion-text-xs);
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    color: var(--fusion-text-muted);
  }

  .contact-card__tag--mine {
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  .contact-card__presence {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    margin-left: auto;
    flex: 0 0 auto;
  }

  .contact-card__presence-dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    border: 1px solid var(--fusion-text-subtle);
    background: transparent;
  }

  .contact-card--away .contact-card__presence-dot {
    border-style: dashed;
  }

  .contact-card:not(.contact-card--away) .contact-card__presence-dot {
    background: var(--fusion-success);
    border-color: var(--fusion-success);
  }

  .contact-card__presence-text {
    font-size: var(--fusion-text-xs);
    color: var(--fusion-text-subtle);
  }

  .contact-card__title-line {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    min-width: 0;
  }

  .contact-card__title {
    min-width: 0;
    font-size: var(--fusion-text-sm);
    color: var(--fusion-text-muted);
    overflow-wrap: anywhere;
  }

  /* REQ-CTT-023: the system's own line is visibly not a written title. */
  .contact-card__title--fallback {
    color: var(--fusion-text-subtle);
  }

  .contact-card__title-input {
    width: 100%;
    min-width: 0;
    padding: 0.1rem 0.25rem;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-accent);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font: inherit;
    font-size: var(--fusion-text-sm);
  }

  .contact-card__icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--fusion-target);
    min-height: var(--fusion-target);
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-subtle);
    cursor: pointer;
  }

  .contact-card__icon-btn:hover,
  .contact-card__icon-btn:focus-visible {
    color: var(--fusion-accent);
  }

  /* Compact lines (title, category tools, companions) keep their height: the
     40px hit area overflows the line with a negative margin instead of growing it. */
  .contact-card__title-line .contact-card__icon-btn,
  .known-group__tools .contact-card__icon-btn,
  .contact-card__sub .contact-card__icon-btn {
    margin-block: calc((var(--fusion-target) - 1.5rem) / -2);
  }

  .contact-card__sheet-btn {
    flex: 0 0 auto;
  }

  .contact-card__sub {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    flex-wrap: wrap;
    padding: var(--fusion-space-2) 0 var(--fusion-space-1);
    margin-left: var(--fusion-space-5);
    border-top: 1px solid var(--fusion-border);
    min-width: 0;
  }

  .contact-card__sub-name {
    min-width: 0;
    font-size: var(--fusion-text-sm);
    overflow-wrap: anywhere;
  }

  .contact-card__sub .contact-card__sheet-btn {
    margin-left: auto;
  }

  /* Takes the slack of the line, so the sheet button stays on it instead of dropping. */
  .contact-card__sub-kind {
    flex: 1 1 0;
    min-width: 0;
    font-size: var(--fusion-text-xs);
    color: var(--fusion-text-subtle);
  }

  /* ----------------------------------------------------------------------
     Conhecidos — spec 39 §5.5 and §5.6
     ---------------------------------------------------------------------- */

  .contacts-panel__add-category {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-left: auto;
    min-width: var(--fusion-target);
    min-height: var(--fusion-target);
    margin-block: calc((var(--fusion-target) - 1.5rem) / -2);
    padding: 0;
    background: none;
    border: none;
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-subtle);
    cursor: pointer;
  }

  .contacts-panel__add-category:hover,
  .contacts-panel__add-category:focus-visible {
    color: var(--fusion-accent);
  }

  .contacts-panel__category-input {
    width: 100%;
    min-width: 0;
    margin-bottom: var(--fusion-space-2);
    min-height: var(--fusion-target);
    padding: 0.15rem 0.4rem;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-accent);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text);
    font: inherit;
    font-size: var(--fusion-text-xs);
  }

  .known-group {
    margin-bottom: 0.4rem;
    min-width: 0;
  }

  .known-group__head {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
    margin: var(--fusion-space-2) 0;
    font-size: var(--fusion-text-sm);
    font-weight: 500;
    color: var(--fusion-text);
  }

  .known-group__name {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .known-group__count {
    font-variant-numeric: tabular-nums;
    font-weight: 400;
    color: var(--fusion-text-subtle);
  }

  .known-group__tools {
    display: inline-flex;
    align-items: center;
    gap: 0.05rem;
    margin-left: auto;
    flex: 0 0 auto;
  }

  /* REQ-CTT-041: the unidentified row is a shape and a word, never a colour alone. */
  .known-card--unidentified {
    border-style: dashed;
  }

  .known-card__mask {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    flex: 0 0 auto;
    border: 1px dashed var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-subtle);
  }

  .known-card__unidentified {
    font-size: var(--fusion-text-sm);
    color: var(--fusion-text-muted);
  }

  .known-card__counts {
    font-size: var(--fusion-text-xs);
    font-variant-numeric: tabular-nums;
    color: var(--fusion-text-subtle);
  }

  .known-card__category {
    width: 100%;
    min-width: 0;
    min-height: var(--fusion-target);
    padding: 0.12rem 0.4rem;
    background: var(--fusion-surface);
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    color: var(--fusion-text-muted);
    font: inherit;
    font-size: var(--fusion-text-sm);
  }
</style>
