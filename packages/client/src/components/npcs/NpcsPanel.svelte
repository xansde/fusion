<script lang="ts">
  /**
   * NpcsPanel.svelte — the NPCs tab of the side drawer (spec 42, id "npcs").
   *
   * This file draws the **folder tree** of §5.3 (G070). Every rule about the tree
   * lives in `lib/npcs/folderTree.ts` and `lib/npcs/folderPrefs.ts`; this component
   * is the shell that binds them to the mirror, the socket and the keyboard.
   *
   * Four rules are visible in the markup and worth naming:
   *
   *  - **Deleting a folder deletes no actor** (REQ-NPC-022). There is no
   *    `doc:delete` for a Folder anywhere in this file: removal goes through
   *    `folder:delete`, the composed server operation that lifts the subfolders
   *    and releases the actors to "Sem pasta" before the row goes.
   *  - **A pin is not a folder change** (REQ-NPC-025). Pinning writes to
   *    `localStorage`, keyed by world + user, and to nothing else — no socket call
   *    in this file carries a pin, so the `Folder` document a second GM reads is
   *    byte-identical before and after.
   *  - **Unpinning restores nothing** (REQ-NPC-024), because nothing was stored:
   *    the pinned set has no order and no index, so the folder simply reappears
   *    where the alphabetical tree puts it.
   *  - **"Sem pasta" is not a folder** (REQ-NPC-014). It is drawn last and carries
   *    no rename, no delete and no pin — it is the absence of a folder, not one.
   *
   * The row of the non-playable is spec 42 §5.4, and everything it decides lives in
   * `lib/npcs/npcRowVM.ts`: this file draws the portrait, the name, the title under
   * it, the condition chips, the scene presences and the sub-characters, and owns no
   * rule about any of them. Two of those rules are visible in the markup:
   *
   *  - **No hit points anywhere** (REQ-NPC-031, DEC-NPC-10). The row model has no
   *    field to draw one from, so there is nothing here to forget to hide.
   *  - **A presence is counted, never described** (REQ-NPC-036): how many, and in
   *    which scenes. No token id, coordinate or hidden flag reaches this file.
   *
   * **Moving has two paths and both are required** (REQ-NPC-028): the row is
   * draggable onto a folder, and the row also carries a `<select>` that a keyboard
   * reaches on its own (REQ-UIF-064). "Sem pasta" is a destination of both
   * (REQ-NPC-029). Where the destination comes from is all that differs — both end
   * in `buildMoveActorOp`, so the two gestures cannot drift apart.
   */

  import { untrack } from "svelte";
  import type { SidebarPanelProps } from "../../lib/sidebar/registry.js";
  import { worldMirror } from "../../lib/docs/worldSync.js";
  import { sendOp, OpError, makeSendOpFn } from "../../lib/docs/sendOp.js";
  import { getSocket } from "../../lib/session.svelte.js";
  import { Dialog } from "../../lib/windows/dialogs.svelte.js";
  import { t } from "../../lib/i18n/i18n.js";
  import ActorPortrait from "../common/ActorPortrait.svelte";
  import ConditionChips from "../common/ConditionChips.svelte";
  import NpcsFooter from "./NpcsFooter.svelte";
  import NpcKnowledgeCount from "./NpcKnowledgeCount.svelte";
  import {
    conditionRegistry,
    ensureConditionRegistry,
  } from "../../lib/conditions/conditionRegistry.svelte.js";
  import { openActorSheet } from "../../lib/sheets/openActorSheet.js";
  import {
    ACTOR_FOLDER_TYPE,
    type FolderDeleteResult,
    type FolderCreateInput,
  } from "@fusion/shared";
  import {
    UNFILED_FOLDER_ID,
    buildFolderTree,
    flattenTree,
    pinnedFolders,
    type FolderLike,
    type FolderedDoc,
  } from "../../lib/npcs/folderTree.js";
  import {
    buildNpcRows,
    foldersWithResults,
    isNpcRowActor,
    npcTitleDiff,
    rowsOfFolder,
    toFolderedDocs,
    type NpcActorDoc,
    type NpcRow,
    type NpcSceneDoc,
  } from "../../lib/npcs/npcRowVM.js";
  import {
    NPC_DRAG_MIME,
    buildMoveActorOp,
    buildNpcDragPayload,
    moveTargetOptions,
    normalizeFolderId,
    readNpcDragPayload,
    type MovableActor,
  } from "../../lib/npcs/moveActor.js";
  import {
    NPC_DRAG_EFFECT_ALLOWED,
    NPC_FOLDER_DROP_EFFECT,
  } from "../../lib/canvas/dragEffects.js";
  import { openNpcCreateWindow } from "../../lib/npcs/npcCreateWindow.js";
  import { openNpcDeleteWindow } from "../../lib/npcs/npcDeleteWindow.js";
  import { isDeletableNpcSubtype } from "../../lib/npcs/deleteNpc.js";
  import {
    attitudeCycleOp,
    attitudeLabelKey,
    nextAttitude,
    subtypeAcceptsAttitude,
  } from "../../lib/npcs/npcAttitude.js";
  import {
    emptyNpcFolderPrefs,
    loadNpcFolderPrefs,
    pruneNpcFolderPrefs,
    saveNpcFolderPrefs,
    toggleCollapsed,
    togglePinned,
    type NpcFolderPrefs,
  } from "../../lib/npcs/folderPrefs.js";

  const { socket, worldId, userId, isGm, activeSceneId }: SidebarPanelProps = $props();

  // Seeded from the mirror at construction, not inside the effect: the panel is
  // mounted only while its tab is open (REQ-GAV-017), so it has to draw the tree
  // the client already holds on its very first frame (RNF-NPC-01).
  let folders = $state<FolderLike[]>(worldMirror.getByType<FolderLike>("Folder"));
  let actors = $state<NpcActorDoc[]>(worldMirror.getByType<NpcActorDoc>("Actor"));
  // The scenes are read for one number only: how many presences an actor has, and
  // where (REQ-NPC-036). Nothing else of a scene is drawn by this panel.
  let scenes = $state<NpcSceneDoc[]>(worldMirror.getByType<NpcSceneDoc>("Scene"));
  /** REQ-NPC-011: filtering happens here, in the client, over name and title. */
  let query = $state("");
  // Read once, at construction: the seat does not change while the panel lives, and
  // reading it inside a derived would re-read storage on every keystroke.
  let prefs = $state<NpcFolderPrefs>(
    untrack(() =>
      worldId.length > 0 ? loadNpcFolderPrefs(worldId, userId) : emptyNpcFolderPrefs(),
    ),
  );
  let error = $state<string | null>(null);

  /** Folder whose name is being written, or null. `""` means a new root folder. */
  let creatingUnder = $state<string | null>(null);
  let renamingId = $state<string | null>(null);
  let nameDraft = $state("");

  $effect(() => {
    const stopFolders = worldMirror.subscribe<FolderLike>("Folder", (docs) => {
      folders = docs;
    });
    const stopActors = worldMirror.subscribe<NpcActorDoc>("Actor", (docs) => {
      actors = docs;
    });
    // RNF-NPC-03: a presence added or removed on the map changes the count in the
    // line without reopening the tab, because the count is derived from the mirror.
    const stopScenes = worldMirror.subscribe<NpcSceneDoc>("Scene", (docs) => {
      scenes = docs;
    });
    folders = worldMirror.getByType<FolderLike>("Folder");
    actors = worldMirror.getByType<NpcActorDoc>("Actor");
    scenes = worldMirror.getByType<NpcSceneDoc>("Scene");
    return () => {
      stopFolders();
      stopActors();
      stopScenes();
    };
  });

  $effect(() => {
    // Fire and forget: the panel never waits on the dictionary (RNF-NPC-01), and
    // the call is single-flight, so re-opening the tab does not ask again.
    void ensureConditionRegistry(socket);
  });

  /** Only `npc` and `hazard` are listed here (spec 42 §3). */
  const npcs = $derived(actors.filter(isNpcRowActor));

  /**
   * REQ-NPC-033: the chips are painted from what the SYSTEM declared, by the very
   * contract of spec 39 (REQ-CTT-030..038). This tab redefines none of it.
   */
  const conditionDeclarations = $derived(conditionRegistry.declarations);

  /** pt-BR name of a subtype, degrading to the raw subtype when undeclared. */
  function subtypeLabel(subtype: string): string {
    const key = `FUSION.Npcs.Subtype.${subtype}`;
    const label = t(key);
    return label === key ? subtype : label;
  }

  /**
   * pt-BR name of a companion kind, degrading to the raw kind when undeclared.
   * Reuses spec 39's vocabulary (`FUSION.Contacts.CompanionKind.*`) — the data is the
   * same `system.companionKind` field ContactsPanel already owns; no parallel
   * `FUSION.Npcs.CompanionKind.*` key is created for it.
   */
  function companionKindLabel(kind: string): string {
    const key = `FUSION.Contacts.CompanionKind.${kind}`;
    const label = t(key);
    return label === key ? kind : label;
  }

  const searching = $derived(query.trim().length > 0);

  /** Every line the panel draws, already filtered by the search (REQ-NPC-011). */
  const npcRows = $derived(
    buildNpcRows({
      actors,
      scenes,
      isPrivileged: isGm,
      query,
      conditionDeclarations,
      subtypeLabel,
    }),
  );

  // The tree is built out of exactly what survived the search, so a folder holding
  // no match counts zero and is dropped below (REQ-NPC-012).
  const tree = $derived(buildFolderTree(folders, toFolderedDocs(npcRows), ACTOR_FOLDER_TYPE));
  const unfiledRows = $derived(rowsOfFolder(npcRows, null));

  /**
   * Ids that no longer name a folder are dropped on read (REQ-NPC-025): a folder
   * another GM deleted must not keep a pin alive on this device.
   */
  const livePrefs = $derived(pruneNpcFolderPrefs(prefs, new Set(tree.byId.keys())));
  const pinnedSet = $derived(new Set(livePrefs.pinned));
  const collapsedSet = $derived(new Set(livePrefs.collapsed));

  const pinnedBlock = $derived(pinnedFolders(tree, pinnedSet));
  /**
   * REQ-NPC-012: while a search runs, nothing is collapsed (a folder holding a
   * result is shown expanded) and folders holding no result are dropped. The
   * collapsed set itself is never touched, which is what makes clearing the field
   * give the tree back exactly the shape the Mestre left it in.
   */
  const rows = $derived(
    foldersWithResults(
      flattenTree(tree, searching ? new Set<string>() : collapsedSet, pinnedSet),
      searching,
    ),
  );

  function persist(next: NpcFolderPrefs): void {
    prefs = next;
    saveNpcFolderPrefs(worldId, userId, next);
  }

  /** REQ-NPC-023/024/025: display state, written to this device and nowhere else. */
  function onTogglePin(folderId: string): void {
    persist(togglePinned(livePrefs, folderId));
  }

  /** REQ-NPC-027: collapse survives leaving and coming back to the tab. */
  function onToggleCollapse(folderId: string): void {
    persist(toggleCollapsed(livePrefs, folderId));
  }

  function report(err: unknown): void {
    error = err instanceof OpError ? err.message : String(err);
  }

  function startCreate(parentId: string): void {
    creatingUnder = parentId;
    renamingId = null;
    nameDraft = "";
    error = null;
  }

  function startRename(folderId: string, current: string): void {
    renamingId = folderId;
    creatingUnder = null;
    nameDraft = current;
    error = null;
  }

  function cancelEditing(): void {
    creatingUnder = null;
    renamingId = null;
    nameDraft = "";
  }

  /** REQ-NPC-021: create a folder, nested when a parent is given. */
  async function confirmCreate(): Promise<void> {
    const parentId = creatingUnder;
    const name = nameDraft.trim();
    cancelEditing();
    if (parentId === null || name.length === 0) return;

    const data: FolderCreateInput = {
      name,
      type: ACTOR_FOLDER_TYPE,
      parentId: parentId.length > 0 ? parentId : null,
    };
    try {
      await sendOp(socket, { type: "doc:create", payload: { documentType: "Folder", data: [data] } });
    } catch (err) {
      report(err);
    }
  }

  /** REQ-NPC-021: rename in place; the position in the tree follows the new name. */
  async function confirmRename(): Promise<void> {
    const folderId = renamingId;
    const name = nameDraft.trim();
    cancelEditing();
    if (folderId === null || name.length === 0) return;

    try {
      await sendOp(socket, {
        type: "doc:update",
        payload: { documentType: "Folder", updates: [{ _id: folderId, diff: { name } }] },
      });
    } catch (err) {
      report(err);
    }
  }

  function onNameKeydown(event: KeyboardEvent, mode: "create" | "rename"): void {
    if (event.key === "Enter") {
      event.preventDefault();
      void (mode === "create" ? confirmCreate() : confirmRename());
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
    }
  }

  // -------------------------------------------------------------------------
  // Creating a non-playable (spec 42 §5.6)
  //
  // The panel opens the window and hands it the folder the gesture came from
  // (REQ-NPC-047); everything the window then does — the two doors, the subtypes
  // it offers, the preset it forgets — lives in `lib/npcs/createNpc.ts`.
  // -------------------------------------------------------------------------

  /** REQ-NPC-040: from the head of the panel, and from the head of each folder. */
  function openCreate(folderId: string | null): void {
    error = null;
    openNpcCreateWindow({
      socket,
      folderId,
      // The same option list the move control walks, so "Sem pasta" is spelled
      // once and a folder cannot be a destination of one gesture and not the other.
      folderOptions: moveTargetOptions(tree, folderId),
    });
  }

  // -------------------------------------------------------------------------
  // Moving a non-playable between folders (REQ-NPC-028 / REQ-NPC-029)
  //
  // Two gestures, one operation. `moveNpc` is the only place that talks to the
  // socket about a folder change, so the drag and the keyboard control cannot
  // move an actor in two different ways.
  // -------------------------------------------------------------------------

  /** The folder currently under a drag, for the drop feedback of REQ-UIF-045. */
  let dragOverFolder = $state<string | null>(null);

  async function moveNpc(
    actorId: string,
    currentFolderId: string | null,
    target: string,
  ): Promise<void> {
    const op = buildMoveActorOp(actorId, currentFolderId, target);
    // Same folder, nothing to say: the list is not rebuilt and the scroll stays
    // where the Mestre left it (RNF-NPC-04).
    if (op === null) return;

    try {
      await sendOp(socket, op);
    } catch (err) {
      report(err);
    }
  }

  /** REQ-UIF-044: the row travels as the typed actor payload. */
  function onNpcDragStart(event: DragEvent, doc: MovableActor): void {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData(NPC_DRAG_MIME, JSON.stringify(buildNpcDragPayload(doc)));
    // The row travels to two destinations with opposite verbs — a folder (move,
    // REQ-NPC-028/029) and the map (copy, REQ-NPC-063) — so it has to allow both.
    // Allowing only "move" made the browser resolve the drop on the canvas to no
    // operation at all and never fire `drop`, with no error anywhere (TK042a).
    event.dataTransfer.effectAllowed = NPC_DRAG_EFFECT_ALLOWED;
  }

  /**
   * REQ-UIF-045: the zone declares what it accepts before the drop. During a drag
   * only the `types` of the transfer are readable — the payload itself is withheld
   * by the browser — so acceptance is decided on the MIME.
   */
  function onFolderDragOver(event: DragEvent, folderId: string): void {
    if (!event.dataTransfer?.types.includes(NPC_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = NPC_FOLDER_DROP_EFFECT;
    dragOverFolder = folderId;
  }

  function onFolderDragLeave(folderId: string): void {
    if (dragOverFolder === folderId) dragOverFolder = null;
  }

  /** REQ-NPC-028/029: the drop target may be a folder or the "Sem pasta" group. */
  function onFolderDrop(event: DragEvent, folderId: string): void {
    event.preventDefault();
    dragOverFolder = null;
    const payload = readNpcDragPayload(event.dataTransfer?.getData(NPC_DRAG_MIME));
    if (payload === null) return;
    const doc = npcs.find((candidate) => candidate._id === payload._id);
    if (doc === undefined) return;
    void moveNpc(doc._id, normalizeFolderId(doc.folder), folderId);
  }

  /**
   * REQ-NPC-022: the confirmation says what happens to the contents, because what
   * happens to them is the whole point — nothing is deleted with the folder.
   */
  async function onDeleteFolder(folderId: string, name: string, count: number): Promise<void> {
    const ok = await Dialog.confirm(t("FUSION.Npcs.Folder.DeleteConfirm", { name, count }), {
      confirmLabel: t("FUSION.Npcs.Folder.DeleteConfirmLabel"),
    });
    if (!ok) return;

    try {
      // NOT doc:delete: that path would leave the actors pointing at a folder that
      // no longer exists and the subfolders orphaned (REQ-NPC-022).
      await sendOp<FolderDeleteResult>(socket, {
        type: "folder:delete",
        payload: { folderId },
      });
      persist(
        pruneNpcFolderPrefs(
          livePrefs,
          new Set([...tree.byId.keys()].filter((id) => id !== folderId)),
        ),
      );
    } catch (err) {
      report(err);
    }
  }

  // -------------------------------------------------------------------------
  // The line of the non-playable (spec 42 §5.4)
  // -------------------------------------------------------------------------

  /**
   * REQ-NPC-035: the sheet opens in a floating window (REQ-UIF-009), from the
   * double-click on the row and from the button a keyboard can reach — the same
   * function, so the two gestures cannot open two different things.
   */
  function openSheet(row: NpcRow): void {
    const doc = actors.find((candidate) => candidate._id === row.id);
    if (doc === undefined) return;
    const opts = {
      userId,
      ownership: isGm ? 3 : 0,
      isGm,
      worldId,
      socket,
      // Lazy socket accessor: a captured socket goes stale across a reconnect.
      sendOpFn: makeSendOpFn(() => getSocket() ?? socket),
    };
    const raw = doc as unknown as Record<string, unknown>;
    openActorSheet(row.id, raw, opts);
  }

  /** Id of the row whose title is being rewritten, or null (REQ-NPC-032). */
  let editingTitleOf = $state<string | null>(null);
  let titleDraft = $state("");

  function startEditingTitle(row: NpcRow): void {
    if (!row.canEditTitle) return;
    editingTitleOf = row.id;
    titleDraft = row.title.kind === "title" ? row.title.text : "";
    error = null;
  }

  function cancelEditingTitle(): void {
    editingTitleOf = null;
    titleDraft = "";
  }

  async function commitTitle(row: NpcRow): Promise<void> {
    const next = titleDraft.trim();
    editingTitleOf = null;
    if (row.title.kind === "title" && next === row.title.text) return;
    if (row.title.kind !== "title" && next.length === 0) return;

    try {
      await sendOp(socket, {
        type: "doc:update",
        payload: {
          documentType: "Actor",
          updates: [{ _id: row.id, diff: npcTitleDiff(next) }],
        },
      });
      error = null;
    } catch (err) {
      // REQ-NPC-080: hiding the control is not the protection — the server
      // refuses, and the refusal is shown instead of being swallowed.
      report(err);
    }
  }

  /** REQ-NPC-032: `Enter` confirms, `Esc` cancels, in the row itself. */
  function onTitleKeydown(event: KeyboardEvent, row: NpcRow): void {
    if (event.key === "Enter") {
      event.preventDefault();
      void commitTitle(row);
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelEditingTitle();
    }
  }

  /**
   * REQ-NPC-038: one activation, one step of the cycle — `ally → neutral → enemy`,
   * the order the shared module owns so no second order can be invented here. The
   * write is the ordinary `doc:update` of `flags.fusion.attitude`; the server is
   * what refuses it to a non-privileged socket (REQ-NPC-080), not this button.
   */
  async function onCycleAttitude(row: NpcRow): Promise<void> {
    const op = attitudeCycleOp({ id: row.id, subtype: row.subtype, attitude: row.attitude });
    // A subtype that carries no attitude asks for nothing (REQ-NPC-037): the
    // hazard's row has no control, and this is the second lock behind it.
    if (op === null) return;
    try {
      await sendOp(socket, op);
      error = null;
    } catch (err) {
      report(err);
    }
  }

  // -------------------------------------------------------------------------
  // Deleting a non-playable (spec 42 §5.7)
  //
  // The panel only opens the confirmation and hands it the row it came from.
  // Everything the confirmation then shows — the presences, the knowledge, the
  // items, and the refusal while an encounter is live — is read from the server
  // by `lib/npcs/deleteNpc.ts`, because two of those three numbers are not in
  // this client's mirror to count.
  // -------------------------------------------------------------------------

  /** REQ-NPC-050/051: never a bare confirm — the window says what falls. */
  function openDelete(row: NpcRow): void {
    error = null;
    openNpcDeleteWindow({ socket, actorId: row.id, name: row.name, subtype: row.subtype });
  }

  /** The move control and the drag payload speak of documents, the row of a view. */
  function movableOf(row: NpcRow): MovableActor {
    return { _id: row.id, name: row.name, type: row.subtype, img: row.img, folder: row.folderId };
  }

  /** "2 em Clareira, 1 em Caverna" — how many, and where (REQ-NPC-036). */
  function presenceScenesLabel(row: NpcRow): string {
    return row.presence.scenes
      .map((scene) => t("FUSION.Npcs.Presence.InScene", { count: scene.count, scene: scene.sceneName }))
      .join(", ");
  }
</script>

<!--
  REQ-NPC-028: the second path, the one a keyboard can walk. A `<select>` is
  focusable and operable on its own — no custom key handling to get wrong — and it
  lists every folder of the tree plus "Sem pasta" (REQ-NPC-029), including folders
  that are collapsed right now.
-->
{#snippet moveControl(doc: FolderedDoc)}
  <select
    class="npcs-row__move"
    data-action="move-npc"
    data-npc-move={doc._id}
    aria-label={t("FUSION.Npcs.Move.Label", { name: doc.name ?? "" })}
    onchange={(event) =>
      void moveNpc(doc._id, normalizeFolderId(doc.folder), event.currentTarget.value)}
  >
    {#each moveTargetOptions(tree, doc.folder) as option (option.value)}
      <option value={option.value} selected={option.current}>
        {option.unfiled
          ? t("FUSION.Npcs.Folder.Unfiled")
          : "  ".repeat(option.depth) + option.name}
      </option>
    {/each}
  </select>
{/snippet}

<!--
  The line of one non-playable (spec 42 §5.4). Drawn in one place and rendered from
  both the folders and the "Sem pasta" group, so a rule cannot hold in one of the
  two and not in the other.

  What is NOT here is the point: no hit points, in any form, for any role
  (REQ-NPC-031, DEC-NPC-10) — the row model has no field to draw one from.
-->
{#snippet npcRowItem(row: NpcRow)}
  <li
    class="npcs-row"
    data-npc-id={row.id}
    data-in-folder={row.folderId ?? ""}
    draggable="true"
    ondragstart={(event) => onNpcDragStart(event, movableOf(row))}
    ondblclick={() => openSheet(row)}
  >
    <div class="npcs-row__head">
      <ActorPortrait
        img={row.img}
        docRef={{ table: "actors", id: row.id }}
        name={row.name}
        size={28}
      />

      <div class="npcs-row__identity">
        <span class="npcs-row__name-line">
          <span class="npcs-row__name">{row.name}</span>
          {#if row.level !== null}
            <!-- REQ-NPC-030: level, or the system's equivalent identification. -->
            <span class="npcs-row__level" data-npc-level={row.level}
              >{t("FUSION.Npcs.Level", { level: row.level })}</span
            >
          {/if}
          {#if row.attitude !== null}
            <!-- REQ-NPC-037: an attitude is shown only when there is one, and it is
                 a WORD as well as a colour (REQ-NPC-094). -->
            <span class="npcs-row__attitude" data-npc-attitude={row.attitude}
              >{t(attitudeLabelKey(row.attitude))}</span
            >
          {/if}
          {#if isGm && subtypeAcceptsAttitude(row.subtype)}
            <!-- REQ-NPC-038: the control that cycles, on the row itself and operable
                 by keyboard (it is a button, so Enter and Space already work). A
                 hazard has none, so it gets no control at all (CA-NPC-010). -->
            <button
              class="npcs-panel__icon-btn"
              type="button"
              data-action="cycle-attitude"
              data-npc-cycle={row.id}
              data-attitude-next={nextAttitude(row.attitude)}
              aria-label={t("FUSION.Npcs.Attitude.Cycle", {
                name: row.name,
                next: t(attitudeLabelKey(nextAttitude(row.attitude))),
              })}
              onclick={() => void onCycleAttitude(row)}
            >
              <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
                <path
                  d="M3.4 8a4.6 4.6 0 0 1 7.9-3.2M12.6 8a4.6 4.6 0 0 1-7.9 3.2M11.3 2.4v2.4H8.9M4.7 13.6v-2.4h2.4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.3"
                  stroke-linejoin="round"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          {/if}
        </span>

        {#if editingTitleOf === row.id}
          <!-- REQ-NPC-032: Enter confirms, Esc cancels, in the row itself. -->
          <input
            class="npcs-row__title-input"
            data-input="npc-title"
            value={titleDraft}
            aria-label={t("FUSION.Npcs.Title.Label", { name: row.name })}
            placeholder={t("FUSION.Npcs.Title.Placeholder")}
            oninput={(event) => {
              titleDraft = event.currentTarget.value;
            }}
            onkeydown={(event) => onTitleKeydown(event, row)}
            onblur={() => cancelEditingTitle()}
          />
        {:else}
          <span class="npcs-row__title-line">
            <!-- REQ-NPC-032: an empty title falls to subtype and level, and the two
                 are visibly different things. -->
            <span
              class="npcs-row__title"
              class:npcs-row__title--fallback={row.title.kind === "fallback"}
              data-title-kind={row.title.kind}>{row.title.text}</span
            >
            {#if row.canEditTitle}
              <button
                class="npcs-panel__icon-btn"
                type="button"
                data-action="edit-title"
                aria-label={t("FUSION.Npcs.Title.Edit", { name: row.name })}
                onclick={() => startEditingTitle(row)}
              >
                <!-- Drawn glyph, never an emoji (REQ-NPC-094): a slanted pen. -->
                <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
                  <path
                    d="M11.2 2.3 13.7 4.8 5.6 12.9 2.6 13.4 3.1 10.4z"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
            {/if}
          </span>
        {/if}

        <!-- REQ-NPC-033: the same chip the 39 and the 40 draw, by the same contract. -->
        <ConditionChips conditions={row.conditions} idPrefix={`npc-${row.id}`} />

        {#if row.presence.total > 0}
          <!-- REQ-NPC-036: how many presences, and in which scenes. Nothing of any
               single one of them — not a name, not a position, not a state. -->
          <span
            class="npcs-row__presence"
            data-npc-presence={row.presence.total}
            data-npc-presence-scenes={row.presence.scenes.length}
          >
            {t("FUSION.Npcs.Presence.Count", { count: row.presence.total })}
            <span class="npcs-row__presence-scenes">{presenceScenesLabel(row)}</span>
          </span>
        {/if}

        <!-- REQ-NPC-070/071: how many know and how many glimpsed, in READING. The
             component is a span with no control of any kind; knowledge is edited
             only in the window the footer opens (REQ-NPC-072). -->
        <NpcKnowledgeCount knowledge={row.knowledge} />
      </div>

      <!-- REQ-NPC-035: the keyboard path to the very sheet the double-click opens. -->
      <button
        class="npcs-panel__icon-btn"
        type="button"
        data-action="open-sheet"
        aria-label={t("FUSION.Npcs.Sheet.Open", { name: row.name })}
        onclick={() => openSheet(row)}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
          <path
            d="M4 2.4h5.2L12 5.2V13.6H4z M9.2 2.4V5.2H12"
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      {#if isGm && isDeletableNpcSubtype(row.subtype)}
        <!-- REQ-NPC-050: deleting is offered only to a privileged seat, and only
             for what this tab lists — a player's character has no row here and
             therefore no delete (REQ-NPC-055). The control opens the confirmation
             of REQ-NPC-051; it never deletes on the spot. -->
        <button
          class="npcs-panel__icon-btn npcs-panel__icon-btn--danger"
          type="button"
          data-action="delete-npc"
          data-npc-delete={row.id}
          aria-label={t("FUSION.Npcs.Delete.Open", { name: row.name })}
          onclick={() => openDelete(row)}
        >
          <!-- Drawn glyph, never an emoji (REQ-NPC-094): a lidded bin. -->
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
            <path
              d="M3.4 4.6h9.2M6.4 4.6V3h3.2v1.6M4.6 4.6l.6 8.4h5.6l.6-8.4"
              fill="none"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      {/if}

      {@render moveControl(movableOf(row))}
    </div>

    {#if row.subCharacters.length > 0}
      <!-- REQ-NPC-034: a sub-character is drawn INSIDE the line of its owner, and is
           never an item of the list on its own (DEC-CTT-06). -->
      <ul class="npcs-row__subs">
        {#each row.subCharacters as sub (sub.id)}
          <li class="npcs-row__sub" data-sub-of={row.id} data-sub-id={sub.id}>
            <ActorPortrait
              img={sub.img}
              docRef={{ table: "actors", id: sub.id }}
              name={sub.name}
              size={20}
            />
            <span class="npcs-row__sub-name">{sub.name}</span>
            <span class="npcs-row__sub-kind">{companionKindLabel(sub.kind)}</span>
            <ConditionChips conditions={sub.conditions} idPrefix={`npc-sub-${sub.id}`} />
          </li>
        {/each}
      </ul>
    {/if}
  </li>
{/snippet}

<div class="npcs-panel" data-role={isGm ? "gm" : "player"}>
  <!-- REQ-NPC-010: a fixed bar with the search field taking the available width,
       no textual title of the tab and no ✕ (DEC-GAV-03). -->
  <header class="npcs-panel__tools">
    <input
      type="search"
      class="npcs-panel__search"
      data-npc-search
      placeholder={t("FUSION.Npcs.Search")}
      aria-label={t("FUSION.Npcs.Search")}
      bind:value={query}
    />
    <!-- REQ-NPC-040: the first of the two doors into creation — the head of the
         panel. The second is the head of each folder, below. Icon-only
         (npcs-tab.prototype.html, npcsHead()): the label lives in aria-label,
         never as visible text next to the search field. -->
    <button
      class="npcs-panel__tool-btn npcs-panel__tool-btn--icon"
      type="button"
      data-action="new-npc"
      aria-label={t("FUSION.Npcs.Create.New")}
      title={t("FUSION.Npcs.Create.New")}
      onclick={() => openCreate(null)}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
        <path
          d="M8 3v10M3 8h10"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
        />
      </svg>
    </button>
  </header>

  {#if error !== null}
    <p class="npcs-panel__error" role="alert">{error}</p>
  {/if}

  <!-- REQ-NPC-023/DEC-NPC-03: the pinned block sits at the TOP, outside the
       folder's place in the tree, and shows the mother's path so two folders with
       the same name are still tellable apart. The folder (and its whole subtree)
       IS removed from the tree below — `flattenTree` never draws it there while
       it is pinned (see folderTree.ts). -->
  {#if pinnedBlock.length > 0}
    <section
      class="npcs-panel__pinned"
      data-npc-pinned-block
      aria-label={t("FUSION.Npcs.Folder.PinnedBlock")}
    >
      {#each pinnedBlock as entry (entry.node.id)}
        <!-- REQ-NPC-028: the pinned entry is the same folder, so it takes the same
             drop — a shortcut you cannot drop onto is only half a shortcut. -->
        <div
          class="npcs-pinned-row"
          role="group"
          aria-label={entry.node.name}
          data-pinned-folder-id={entry.node.id}
          data-drop-target={entry.node.id}
          data-drag-over={dragOverFolder === entry.node.id ? "true" : "false"}
          ondragover={(event) => onFolderDragOver(event, entry.node.id)}
          ondragleave={() => onFolderDragLeave(entry.node.id)}
          ondrop={(event) => onFolderDrop(event, entry.node.id)}
        >
          <span class="npcs-pinned-row__name">{entry.node.name}</span>
          {#if entry.parentPath.length > 0}
            <span class="npcs-pinned-row__path" data-parent-path
              >{entry.parentPath.join(" / ")}</span
            >
          {/if}
          <span class="npcs-pinned-row__count" data-folder-count={entry.node.subtreeCount}
            >{entry.node.subtreeCount}</span
          >
          <button
            class="npcs-panel__icon-btn"
            type="button"
            data-action="unpin"
            aria-label={t("FUSION.Npcs.Folder.Unpin", { name: entry.node.name })}
            onclick={() => onTogglePin(entry.node.id)}
          >
            <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
              <path
                d="M6 2h4l-.6 4.2 2.2 2.2H4.4l2.2-2.2z M8 8.4V14"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </div>
      {/each}
    </section>
  {/if}

  <div class="npcs-panel__body">
    <!-- REQ-NPC-021: creating a folder is reachable from the panel itself — now
         a discreet text link next to the "pastas" label, matching
         npcs-tab.prototype.html's treeBlock (the `.sec` header with the `.add`
         button), rather than a bar button next to the search field. -->
    <div class="npcs-tree__section" data-npc-folder-section>
      <span class="npcs-tree__section-label">{t("FUSION.Npcs.Folder.SectionLabel")}</span>
      <span class="npcs-tree__section-line"></span>
      <button
        class="npcs-tree__section-add"
        type="button"
        data-action="new-root-folder"
        aria-label={t("FUSION.Npcs.Folder.New")}
        onclick={() => startCreate("")}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
          <path
            d="M2.4 5.4a1 1 0 0 1 1-.9h2.4l1.1 1.1h5.7a1 1 0 0 1 1 .9v5.3a1 1 0 0 1-1 1H3.4a1 1 0 0 1-1-1z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linejoin="round"
          />
          <path
            d="M8 7.4v3.2M6.4 9h3.2"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linecap="round"
          />
        </svg>
        {t("FUSION.Npcs.Folder.NewShort")}
      </button>
    </div>

    {#if creatingUnder === ""}
      <input
        class="npcs-panel__name-input"
        data-input="new-root-folder"
        value={nameDraft}
        aria-label={t("FUSION.Npcs.Folder.Name")}
        placeholder={t("FUSION.Npcs.Folder.Name")}
        oninput={(event) => {
          nameDraft = event.currentTarget.value;
        }}
        onkeydown={(event) => onNameKeydown(event, "create")}
        onblur={() => void confirmCreate()}
      />
    {/if}

    <ul class="npcs-tree" data-npc-tree>
      {#each rows as row (row.node.id)}
        <li
          class="npcs-tree__item"
          data-folder-id={row.node.id}
          data-depth={row.node.depth}
          data-pinned={row.pinned ? "true" : "false"}
        >
          <!-- REQ-NPC-028: the folder header is the drop zone of the drag path. -->
          <div
            class="npcs-folder"
            style="--npc-depth: {row.node.depth}"
            role="group"
            aria-label={row.node.name}
            data-drop-target={row.node.id}
            data-drag-over={dragOverFolder === row.node.id ? "true" : "false"}
            ondragover={(event) => onFolderDragOver(event, row.node.id)}
            ondragleave={() => onFolderDragLeave(row.node.id)}
            ondrop={(event) => onFolderDrop(event, row.node.id)}
          >
            <button
              class="npcs-panel__icon-btn"
              type="button"
              data-action="toggle-collapse"
              aria-expanded={!row.collapsed}
              aria-label={row.collapsed
                ? t("FUSION.Npcs.Folder.Expand", { name: row.node.name })
                : t("FUSION.Npcs.Folder.Collapse", { name: row.node.name })}
              onclick={() => onToggleCollapse(row.node.id)}
            >
              <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
                <path
                  d={row.collapsed ? "M6 3.6 10.4 8 6 12.4" : "M3.6 6 8 10.4 12.4 6"}
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linejoin="round"
                />
              </svg>
            </button>

            {#if renamingId === row.node.id}
              <input
                class="npcs-panel__name-input"
                data-input="rename-folder"
                value={nameDraft}
                aria-label={t("FUSION.Npcs.Folder.Rename", { name: row.node.name })}
                oninput={(event) => {
                  nameDraft = event.currentTarget.value;
                }}
                onkeydown={(event) => onNameKeydown(event, "rename")}
                onblur={() => void confirmRename()}
              />
            {:else}
              <span class="npcs-folder__name">{row.node.name}</span>
              <!-- REQ-NPC-026: the count is the whole subtree, not the folder alone. -->
              <span class="npcs-folder__count" data-folder-count={row.node.subtreeCount}
                >{row.node.subtreeCount}</span
              >
            {/if}

            <span class="npcs-folder__tools">
              <!-- REQ-NPC-040/REQ-NPC-047: creating from a folder head opens the
                   window with that folder already selected. -->
              <button
                class="npcs-panel__icon-btn"
                type="button"
                data-action="new-npc-in-folder"
                data-npc-create-folder={row.node.id}
                aria-label={t("FUSION.Npcs.Create.NewInFolder", { name: row.node.name })}
                onclick={() => openCreate(row.node.id)}
              >
                <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
                  <path
                    d="M8 4.2v7.6M4.2 8h7.6"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                  />
                  <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.2" />
                </svg>
              </button>
              <button
                class="npcs-panel__icon-btn"
                type="button"
                data-action="pin"
                aria-pressed={row.pinned}
                aria-label={row.pinned
                  ? t("FUSION.Npcs.Folder.Unpin", { name: row.node.name })
                  : t("FUSION.Npcs.Folder.Pin", { name: row.node.name })}
                onclick={() => onTogglePin(row.node.id)}
              >
                <svg
                  viewBox="0 0 16 16"
                  width="11"
                  height="11"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    d="M6 2h4l-.6 4.2 2.2 2.2H4.4l2.2-2.2z M8 8.4V14"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
              <button
                class="npcs-panel__icon-btn"
                type="button"
                data-action="new-child-folder"
                aria-label={t("FUSION.Npcs.Folder.NewChild", { name: row.node.name })}
                onclick={() => startCreate(row.node.id)}
              >
                <svg
                  viewBox="0 0 16 16"
                  width="11"
                  height="11"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M8 3.2v9.6M3.2 8h9.6" fill="none" stroke="currentColor" stroke-width="1.6" />
                </svg>
              </button>
              <button
                class="npcs-panel__icon-btn"
                type="button"
                data-action="rename-folder"
                aria-label={t("FUSION.Npcs.Folder.Rename", { name: row.node.name })}
                onclick={() => startRename(row.node.id, row.node.name)}
              >
                <svg
                  viewBox="0 0 16 16"
                  width="11"
                  height="11"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    d="M11 2.6 13.4 5 5.4 13H3v-2.4z"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
              <button
                class="npcs-panel__icon-btn npcs-panel__icon-btn--danger"
                type="button"
                data-action="delete-folder"
                aria-label={t("FUSION.Npcs.Folder.Delete", { name: row.node.name })}
                onclick={() =>
                  void onDeleteFolder(row.node.id, row.node.name, row.node.subtreeCount)}
              >
                <svg
                  viewBox="0 0 16 16"
                  width="11"
                  height="11"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    d="M3.4 4.6h9.2M6.4 4.6V3h3.2v1.6M4.6 4.6l.6 8.4h5.6l.6-8.4"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
            </span>
          </div>

          {#if creatingUnder === row.node.id}
            <input
              class="npcs-panel__name-input"
              data-input="new-child-folder"
              value={nameDraft}
              aria-label={t("FUSION.Npcs.Folder.Name")}
              placeholder={t("FUSION.Npcs.Folder.Name")}
              oninput={(event) => {
                nameDraft = event.currentTarget.value;
              }}
              onkeydown={(event) => onNameKeydown(event, "create")}
              onblur={() => void confirmCreate()}
            />
          {/if}

          {#if !row.collapsed}
            <ul class="npcs-tree__docs">
              <!-- REQ-NPC-013: alphabetical with localeCompare in pt-BR. -->
              {#each rowsOfFolder(npcRows, row.node.id) as npc (npc.id)}
                {@render npcRowItem(npc)}
              {/each}
            </ul>
          {/if}
        </li>
      {/each}

      <!-- REQ-NPC-014: "Sem pasta" is always last, and has no controls at all — it
           is the absence of a folder, not a folder that could be renamed. -->
      <li
        class="npcs-tree__item npcs-tree__item--unfiled"
        data-folder-id={UNFILED_FOLDER_ID}
        data-unfiled
      >
        <!-- REQ-NPC-029: "Sem pasta" accepts the drop like any folder, even though
             it is not one — the actor lands with no folder at all. -->
        <div
          class="npcs-folder npcs-folder--unfiled"
          role="group"
          aria-label={t("FUSION.Npcs.Folder.Unfiled")}
          data-drop-target={UNFILED_FOLDER_ID}
          data-drag-over={dragOverFolder === UNFILED_FOLDER_ID ? "true" : "false"}
          ondragover={(event) => onFolderDragOver(event, UNFILED_FOLDER_ID)}
          ondragleave={() => onFolderDragLeave(UNFILED_FOLDER_ID)}
          ondrop={(event) => onFolderDrop(event, UNFILED_FOLDER_ID)}
        >
          <span class="npcs-folder__name">{t("FUSION.Npcs.Folder.Unfiled")}</span>
          <span class="npcs-folder__count" data-folder-count={unfiledRows.length}
            >{unfiledRows.length}</span
          >
        </div>
        <ul class="npcs-tree__docs">
          {#each unfiledRows as npc (npc.id)}
            {@render npcRowItem(npc)}
          {/each}
        </ul>
      </li>
    </ul>
  </div>

  <!-- REQ-NPC-062: the footer is FIXED, so it is a sibling of the scrolling body
       and never a child of it. What it holds is spec 42 §5.8 and lives in
       `NpcsFooter.svelte` — the panel only gives it its place. -->
  <NpcsFooter {socket} {activeSceneId} />
</div>

<style>
  .npcs-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    font-family: var(--fusion-font);
    color: var(--fusion-text);
  }

  .npcs-panel__tools {
    display: flex;
    gap: 0.375rem;
    padding: 0.5rem;
    border-bottom: 1px solid var(--fusion-border);
    flex: 0 0 auto;
  }

  .npcs-panel__tool-btn {
    font: inherit;
    font-size: 0.8125rem;
    padding: 0.25rem 0.625rem;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
    cursor: pointer;
    transition: var(--fusion-transition);
  }

  .npcs-panel__tool-btn:hover,
  .npcs-panel__tool-btn:focus-visible {
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
  }

  /* npcs-tab.prototype.html .hbtn.pri: the single icon-only "+" of the top bar
     (REQ-NPC-040) — square, accent-tinted, no visible label. */
  .npcs-panel__tool-btn--icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.625rem;
    height: 1.625rem;
    padding: 0;
    flex: 0 0 auto;
    border-color: var(--fusion-accent);
    color: var(--fusion-accent);
    background: var(--fusion-accent-dim);
  }

  .npcs-panel__error {
    margin: 0;
    padding: 0.375rem 0.5rem;
    font-size: 0.75rem;
    color: var(--fusion-danger);
  }

  .npcs-panel__name-input {
    font: inherit;
    font-size: 0.8125rem;
    margin: 0.25rem 0.5rem;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--fusion-accent);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface);
    color: var(--fusion-text);
  }

  .npcs-panel__pinned {
    flex: 0 0 auto;
    border-bottom: 1px solid var(--fusion-border);
    padding: 0.25rem 0;
    background: var(--fusion-surface-alt);
  }

  .npcs-pinned-row {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.1875rem 0.5rem;
    font-size: 0.8125rem;
  }

  .npcs-pinned-row__name {
    font-weight: 600;
  }

  .npcs-pinned-row__path {
    font-size: 0.6875rem;
    color: var(--fusion-text-subtle);
  }

  .npcs-pinned-row__count,
  .npcs-folder__count {
    margin-left: auto;
    font-size: 0.6875rem;
    color: var(--fusion-text-muted);
    font-variant-numeric: tabular-nums;
  }

  .npcs-panel__body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }

  /* npcs-tab.prototype.html .sec / .sec .add: the "pastas" section head, with the
     new-folder link discreetly beside the label instead of a bar button. */
  .npcs-tree__section {
    display: flex;
    align-items: center;
    gap: 0.3125rem;
    padding: 0.0625rem 0.5rem;
    margin: 0.5rem 0 0.25rem;
  }

  .npcs-tree__section-label {
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--fusion-text-subtle);
  }

  .npcs-tree__section-line {
    flex: 1 1 auto;
    height: 1px;
    background: var(--fusion-border);
  }

  .npcs-tree__section-add {
    display: inline-flex;
    align-items: center;
    gap: 0.1875rem;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    font-size: 0.6875rem;
    color: var(--fusion-text-subtle);
    cursor: pointer;
    transition: var(--fusion-transition);
  }

  .npcs-tree__section-add:hover,
  .npcs-tree__section-add:focus-visible {
    color: var(--fusion-accent);
  }

  .npcs-tree,
  .npcs-tree__docs {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .npcs-folder {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.1875rem 0.5rem;
    padding-left: calc(0.5rem + var(--npc-depth, 0) * 0.75rem);
    font-size: 0.8125rem;
  }

  .npcs-folder__name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .npcs-folder__tools {
    display: inline-flex;
    gap: 0.125rem;
  }

  .npcs-panel__icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.25rem;
    height: 1.25rem;
    padding: 0;
    border: none;
    border-radius: var(--fusion-radius-sm);
    background: transparent;
    color: var(--fusion-text-muted);
    cursor: pointer;
    transition: var(--fusion-transition);
  }

  .npcs-panel__icon-btn:hover,
  .npcs-panel__icon-btn:focus-visible {
    color: var(--fusion-accent);
  }

  .npcs-panel__icon-btn--danger:hover,
  .npcs-panel__icon-btn--danger:focus-visible {
    color: var(--fusion-danger);
  }

  .npcs-panel__search {
    flex: 1 1 auto;
    min-width: 0;
    font: inherit;
    font-size: 0.8125rem;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface);
    color: var(--fusion-text);
  }

  .npcs-row {
    padding: 0.1875rem 0.5rem 0.1875rem 1.75rem;
    font-size: 0.8125rem;
    color: var(--fusion-text);
  }

  .npcs-row__head {
    display: flex;
    align-items: flex-start;
    gap: 0.375rem;
  }

  .npcs-row__identity {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-width: 0;
    flex: 1 1 auto;
  }

  .npcs-row__name-line {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
    min-width: 0;
  }

  .npcs-row__name {
    /* A033: a flex item's default min-width is auto (the size of its content),
       so ellipsis truncation never engages and the name pushes its siblings
       (level/attitude/cycle button) instead of shrinking. min-width: 0 lets it
       shrink below its content, and flex: 1 1 0 makes it the one that yields
       the available row width to the fixed-size siblings. */
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .npcs-row__level,
  .npcs-row__attitude,
  .npcs-row__presence {
    font-size: 0.6875rem;
    color: var(--fusion-text-muted);
    font-variant-numeric: tabular-nums;
  }

  /* REQ-NPC-094: the attitude is a word first; the colour only seconds it. */
  .npcs-row__attitude[data-npc-attitude="enemy"] {
    color: var(--fusion-danger);
  }

  .npcs-row__attitude[data-npc-attitude="ally"] {
    color: var(--fusion-success);
  }

  .npcs-row__title-line {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
  }

  .npcs-row__title {
    font-size: 0.6875rem;
    color: var(--fusion-text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* REQ-NPC-032: the system's own line is visibly not a written title. */
  .npcs-row__title--fallback {
    font-style: italic;
    color: var(--fusion-text-subtle);
  }

  .npcs-row__title-input {
    font: inherit;
    font-size: 0.6875rem;
    padding: 0.0625rem 0.25rem;
    border: 1px solid var(--fusion-accent);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface);
    color: var(--fusion-text);
  }

  .npcs-row__presence-scenes {
    color: var(--fusion-text-subtle);
  }

  .npcs-row__subs {
    list-style: none;
    margin: 0.125rem 0 0;
    padding: 0 0 0 1.75rem;
  }

  .npcs-row__sub {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: var(--fusion-text-muted);
  }

  .npcs-row__sub-kind {
    font-size: 0.6875rem;
    color: var(--fusion-text-subtle);
  }

  .npcs-folder--unfiled .npcs-folder__name {
    color: var(--fusion-text-muted);
    font-style: italic;
  }

  /* REQ-UIF-045: the zone says it accepts the drag BEFORE the drop happens. */
  .npcs-folder[data-drag-over="true"],
  .npcs-pinned-row[data-drag-over="true"] {
    outline: 1px dashed var(--fusion-accent);
    outline-offset: -1px;
    background: var(--fusion-surface-alt);
  }

  /* REQ-NPC-028: the keyboard path. Visible on focus as well as on hover, so it
     is never an affordance that only a pointer can find (REQ-UIF-064).

     A033: `opacity: 0` alone hides the control but keeps reserving its full
     layout box, so a hidden 8rem-wide <select> was permanently stealing width
     from `.npcs-row__name` next door — the name kept truncating even when the
     row had room to spare (a defect the name's own min-width fix could not
     touch, because the cause lived here). At rest the control collapses to a
     1.25rem footprint (matching the icon buttons beside it) and only grows to
     8rem on hover/focus, where it is genuinely visible and needs the room to
     read the folder names. */
  .npcs-row__move {
    font: inherit;
    font-size: 0.6875rem;
    margin-left: auto;
    width: 1.25rem;
    padding: 0.0625rem 0.25rem;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    background: transparent;
    color: var(--fusion-text-muted);
    cursor: pointer;
    opacity: 0;
    overflow: hidden;
    transition: var(--fusion-transition);
  }

  .npcs-row:hover .npcs-row__move,
  .npcs-row:focus-within .npcs-row__move,
  .npcs-row__move:focus-visible {
    opacity: 1;
    width: 8rem;
    border-color: var(--fusion-border);
    background: var(--fusion-surface);
  }
</style>
