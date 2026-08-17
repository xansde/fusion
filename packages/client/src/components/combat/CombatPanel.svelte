<script lang="ts">
  /**
   * CombatPanel.svelte — Combat tracker sidebar panel.
   *
   * Rendered as the "Combat" tab inside the side drawer (spec 36).
   * All logic is delegated to combatStore and combatTracker.ts (pure functions).
   *
   * Supports:
   *   - GM: full combat controls (create, start, roll all/individual, manual init,
   *     next/previous, toggle defeated, toggle hidden, end combat, remove combatant).
   *   - Player: read-only tracker + "Roll my initiative" button on own combatants.
   *   - Empty state: "No active combat" with "Create Combat" button for GM.
   *
   * REQ-CBT-040..047: tracker UI requirements.
   * REQ-CBT-031..035: visibility requirements (server redacts hidden from players).
   *
   * Spec: 10-combate-e-iniciativa.md
   */

  import type { Socket } from "socket.io-client";
  import { combatStore, combatActions, getSortedCombatants } from "../../lib/combat/combatStore.svelte.js";
  import {
    buildRotatedQueue,
    buildTrackerRows,
    controlsState,
    canPlayerRollInitiative,
    turnsUntilOwnTurn,
  } from "../../lib/combat/combatTracker.js";
  import {
    activeCombatantIsOwnedBy,
    ownedActorIdsOf,
  } from "../../lib/combat/combatBadge.svelte.js";
  import { viewerRole, redactCombatForViewer, canUseGmControls } from "../../lib/combat/combatVisibility.js";
  import { buildCombatVitals } from "../../lib/combat/combatVitals.js";
  import {
    assemblySummary,
    buildInitiativeCells,
    combatPhase,
    creatureCombatantIds,
    encounterCandidates,
    initiativeRollOptions,
    initiativeStatisticOptions,
  } from "../../lib/combat/combatSetup.js";
  import type { InitiativeStatisticOption } from "../../lib/combat/combatSetup.js";
  import type { AddableTokenActor } from "../../lib/combat/combatTracker.js";
  import { turnHeadState, turnKeyOf } from "../../lib/combat/turnHead.svelte.js";
  import { worldMirror } from "../../lib/docs/worldSync.js";
  import TurnHead from "./TurnHead.svelte";
  import CombatQueue from "./CombatQueue.svelte";
  import { activeSceneState } from "../../lib/docs/activeScene.svelte.js";
  import { untrack } from "svelte";
  import { t } from "../../lib/i18n/i18n.js";

  const {
    socket,
    isGm,
    userId,
  }: {
    socket: Socket;
    isGm: boolean;
    /** Current user's ID (for determining which combatants the player owns). */
    userId: string;
  } = $props();

  // ---- Derived state ----

  const combat = $derived(combatStore.combat);
  const busy = $derived(combatStore.busy);
  const error = $derived(combatStore.error);

  // Viewer role drives both control gating and the defense-in-depth hidden
  // filter. The server already redacts hidden combatants from player payloads,
  // but the client re-applies the filter so a leaked hidden combatant is never
  // rendered for a player (REQ-CBT-031/032/033).
  const role = $derived(viewerRole(isGm));
  const gmControls = $derived(canUseGmControls(role));

  // For players, render only non-hidden combatants. For the GM, the original
  // combat (with hidden combatants flagged) is used so they see everything.
  const viewCombat = $derived(combat ? redactCombatForViewer(combat, role) : null);

  const rows = $derived(viewCombat ? buildTrackerRows(viewCombat) : []);
  const controls = $derived(combat ? controlsState(combat) : null);

  // Set of actorIds owned by this user (simplified: we check hasPlayerOwner
  // which the server sets; for full ownership we'd need the actor ownerId list,
  // but for MVP we use hasPlayerOwner as a proxy).
  // Players "own" combatants where hasPlayerOwner === true AND userId matches
  // — we use a simplified check via hasPlayerOwner for now.
  const playerOwnedActorIds = $derived(
    new Set(
      combat?.combatants
        .filter((c) => c.hasPlayerOwner && c.actorId)
        .map((c) => c.actorId!)
        ?? [],
    ),
  );

  // ---- Health and conditions (spec 40 §5.5/§5.6, REQ-CBA-040..043 / REQ-CBA-050..054) ----
  //
  // Both are read off the Actor documents the mirror holds, which is also what makes
  // REQ-CBA-054 true: a condition added to an actor arrives as a normal doc:update, the
  // subscription fires, and the head and the queue redraw without the tab being reopened.
  //
  // Q-CBA-02 / REQ-CBA-083: what `buildCombatVitals` does for a player — refusing creature
  // health — is a rule of THIS SCREEN. The same numbers can already be on the player's
  // machine, drawn by the token's own resource bars (REQ-CNV-090); closing that is the
  // Token area's decision, at the server's single redaction module, not another filter
  // here. A player's mirror also simply lacks the creature Actor (the snapshot is
  // ownership-filtered), so most of the time there is nothing to resolve either way — the
  // rule is what makes the answer the same whether or not the document happens to be there.
  let actorDocs = $state<Record<string, unknown>[]>([]);

  $effect(() => {
    const unsub = worldMirror.subscribe<Record<string, unknown>>("Actor", (docs) => {
      actorDocs = docs;
    });
    actorDocs = worldMirror.getByType<Record<string, unknown>>("Actor");
    return unsub;
  });

  const actorsById = $derived(
    new Map(
      actorDocs
        .filter((doc) => typeof doc["_id"] === "string")
        .map((doc) => [doc["_id"] as string, doc] as const),
    ),
  );

  /** Health and conditions per combatant id, resolved for this viewer's role. */
  const vitals = $derived(buildCombatVitals(role, viewCombat?.combatants ?? [], actorsById));

  // ---- Turn head (spec 40 §5.3, DEC-CBA-02) ----
  //
  // In "em andamento" the participant of the turn leaves the scrollable list and gets a
  // fixed-height block at the top of the panel (REQ-CBA-020), with the advance control
  // anchored to its footer (REQ-CBA-021). The head only exists while the encounter is
  // running: montagem and the empty state have no turn to head.
  const inProgress = $derived(combat !== null && combat.started && !combat.ended);
  const activeRow = $derived(rows.find((row) => row.isActive) ?? null);
  const showTurnHead = $derived(inProgress && activeRow !== null);

  // REQ-CBA-023: advancing or rewinding drops the expansion the previous turn had. The
  // turn key (round + active participant) is what changes on both gestures, so the head
  // does not need to know which of the two happened. `untrack` keeps the effect
  // depending on the combat alone — reading the state it writes would re-run it.
  $effect(() => {
    const key = turnKeyOf(combat);
    untrack(() => {
      turnHeadState.syncTurn(key);
    });
  });

  // ---- The queue below the head (spec 40 §5.4, REQ-CBA-030/031/034) ----
  //
  // The list is not the raw initiative order: it is that order rotated from the current
  // turn, with the participant of the turn removed (it is the head) and whoever already
  // acted kept in a labelled group of its own. `gmControls` doubles as the hidden filter
  // the queue applies on top of the server's redaction (REQ-CBA-034).
  const queue = $derived(buildRotatedQueue(rows, gmControls));

  // ---- Whose turn it is (spec 40 §5.8, REQ-CBA-072/073/074) ----
  //
  // "Mine" is decided by real ownership of the Actor, read by `ownedActorIdsOf` — the
  // same reading of `ownership` the server does before it accepts the advance
  // (REQ-CBA-081). It is NOT `hasPlayerOwner`, which only says "some player owns this":
  // with that proxy every player would be told it is their turn whenever any player's
  // character was up, and would be offered a control the server then refuses
  // (REQ-CBA-073, REQ-CBA-080). The control still exists only as convenience — hiding it
  // is not the protection; the server's refusal is.
  const ownedActorIds = $derived(ownedActorIdsOf(actorDocs, userId));
  const isMyTurn = $derived(activeCombatantIsOwnedBy(combat, ownedActorIds));

  /**
   * REQ-CBA-074: how many turns until this user's next one — `null` when they own nobody
   * in the encounter, or when the turn is already theirs (the head says so in words).
   *
   * `skipDefeated` comes from the encounter itself, because the count has to match the
   * advance the server will actually perform (DEC-CBT-07): a defeated participant stays
   * in the queue (REQ-CBA-033) but is walked past, so it costs no turn.
   */
  const turnsUntilMine = $derived(
    isMyTurn ? null : turnsUntilOwnTurn(queue, ownedActorIds, combat?.skipDefeated ?? true),
  );

  /** REQ-CBA-072: ending your own turn is the same advance, by the same server op. */
  const canEndOwnTurn = $derived(!gmControls && isMyTurn);

  /** The turn order the reorder gestures rewrite — the ring, not the rotated reading. */
  const turnOrder = $derived(combat ? getSortedCombatants(combat).map((c) => c._id) : []);

  /** Which combatants this player may roll initiative for (REQ-CBT-034). */
  const rollableByPlayer = $derived(
    gmControls || !combat
      ? new Set<string>()
      : new Set(
          combat.combatants
            .filter((c) =>
              canPlayerRollInitiative(c, combat, userId, playerOwnedActorIds, false),
            )
            .map((c) => c._id),
        ),
  );

  // ---- Assembly (spec 40 §5.7, DEC-CBA-12) ----
  //
  // Creating the encounter, choosing who enters it and rolling initiative all happen INSIDE
  // the drawer, in this same panel: no floating window, no change of width (REQ-CBA-061).
  // Assembling is a list operation and the drawer is good at lists; a window would make the
  // GM switch context at exactly the moment they are looking at the map to decide who is in.
  const phase = $derived(combatPhase(combat));
  const isAssembling = $derived(phase === "assembly");

  /** REQ-CBA-011: what the header counts while assembling — over what this viewer can see. */
  const summary = $derived(assemblySummary(viewCombat?.combatants ?? []));

  /**
   * REQ-CBA-064/067/070 — what each initiative cell may say, decided once here and handed
   * to the queue. The queue draws; it does not decide who reads what.
   */
  const initiativeCells = $derived(buildInitiativeCells(phase, role, viewCombat?.combatants ?? []));

  /** REQ-CBA-063: the creatures a bulk roll would cover, without touching the players'. */
  const creatureIds = $derived(creatureCombatantIds(combat?.combatants ?? []));

  // ---- The candidate list (REQ-CBA-060/061, DEC-CBA-06) ----
  //
  // DEC-CBA-06: nothing on this screen says "token" (REQ-CBA-062), because there is no spec
  // that owns the concept — it is split across `02`, `04` and `06`, and none of them defines
  // it as a document with an owner. So the list is defined for now as "what the active scene
  // offers"; the reserved spec `41`, when it exists, is what will say what that is. The
  // gesture below does not change when it does — only where `encounterCandidates()` reads
  // from. It is a collapsible block of this panel, never a popup (REQ-CBA-061).
  let candidatesOpen = $state(false);

  /**
   * REQ-TOK-060/RNF-TOK-01: resolve a candidate's effective actor from the same
   * `actorsById` map the health/vitals/statistics lookups already use — narrowed
   * defensively since the mirror hands back a generic document, not a typed
   * `ActorDocument` (same pattern as `initiativeStatisticOptions` below).
   */
  function resolveCandidateActor(actorId: string): AddableTokenActor | undefined {
    const actor = actorsById.get(actorId);
    if (!actor || typeof actor["name"] !== "string") return undefined;
    const system = actor["system"];
    return {
      name: actor["name"],
      img: typeof actor["img"] === "string" ? actor["img"] : null,
      system: typeof system === "object" && system !== null ? (system as Record<string, unknown>) : {},
    };
  }

  const candidates = $derived(
    encounterCandidates(activeSceneState.scene?.tokens ?? [], combat, resolveCandidateActor),
  );

  /**
   * Statistics each participant could roll initiative with (REQ-CBA-066, Q-CBA-03), read
   * off the actor the mirror already holds. An actor the viewer cannot see yields no menu.
   */
  const statisticOptions = $derived(
    new Map<string, readonly InitiativeStatisticOption[]>(
      (viewCombat?.combatants ?? []).map((c) => [
        c._id,
        c.actorId ? initiativeStatisticOptions(actorsById.get(c.actorId)) : [],
      ]),
    ),
  );

  // ---- GM: create combat ----
  async function handleCreateCombat(): Promise<void> {
    const sceneId = activeSceneState.id;
    if (!sceneId) return;
    await combatActions.create(socket, sceneId);
  }

  /**
   * Open the candidate list, creating the encounter first when there is none.
   *
   * The GM's flow is "activate a scene → add participants → begin", and making them press
   * "create" before the list can even be opened is a step that carries no decision.
   */
  async function handleToggleCandidates(): Promise<void> {
    if (candidatesOpen) {
      candidatesOpen = false;
      return;
    }
    if (!combat) {
      const sceneId = activeSceneState.id;
      if (!sceneId) return;
      await combatActions.create(socket, sceneId);
    }
    candidatesOpen = true;
  }

  async function handleAddCandidate(candidateId: string, actorId: string | null): Promise<void> {
    if (!combat) return;
    await combatActions.addCombatant(socket, combat._id, candidateId, actorId ?? undefined);
  }

  /** REQ-CBA-063: roll only the creatures, leaving the players their own gesture. */
  async function handleRollCreatures(): Promise<void> {
    if (!combat || creatureIds.length === 0) return;
    await combatActions.rollInitiative(socket, combat._id, creatureIds);
  }

  /**
   * Roll one participant's initiative, carrying the statistic chosen in the same gesture
   * (REQ-CBA-066). `null` means no choice was made and the system's own formula applies.
   */
  async function handleRollOne(combatantId: string, statistic: string | null): Promise<void> {
    if (!combat) return;
    await combatActions.rollInitiative(
      socket,
      combat._id,
      [combatantId],
      initiativeRollOptions(statistic),
    );
  }
</script>

<!-- REQ-CBA-010: exactly three states — vazio, montagem, em andamento. The phase is on the
     node itself, not only implied by which branch rendered, so the panel can be reasoned
     about (and tested) as the state machine the requirement describes. -->
<div class="combat-panel" data-phase={phase}>

  <!-- ---- Error banner ----
    BUG FIX: previously nested inside the {:else} branch below (only rendered
    when `combat` was already truthy), so a failed combatActions.create()
    (e.g. DEC-CBT-06 "combat already exists for this scene") silently no-op'd
    from the GM's perspective whenever the mirror didn't already have a Combat
    doc — exactly the empty-state case where "Criar Combate" is clicked. Hoisted
    above the {#if !combat} split so it renders in both states. -->
  {#if error}
    <div class="combat-panel__error" role="alert">{error}</div>
  {/if}

  {#if !combat || phase === "empty"}
    <!-- ---- Empty state (REQ-CBA-090/091) ----
      A privileged role gets the two gestures that start an encounter; everyone else gets
      the sentence and nothing to press. -->
    <div class="combat-panel__empty">
      <p class="combat-panel__empty-text">{t("FUSION.Combat.Empty")}</p>
      {#if isGm}
        <div class="combat-panel__empty-actions">
          <button
            class="btn btn--primary btn--sm"
            onclick={handleCreateCombat}
            disabled={busy || !activeSceneState.id}
            aria-label={t("FUSION.Combat.Create")}
          >
            {t("FUSION.Combat.Create")}
          </button>
          <button
            class="btn btn--ghost btn--sm"
            onclick={handleToggleCandidates}
            disabled={busy || !activeSceneState.id}
            aria-label={t("FUSION.Combat.Setup.Candidates")}
            title={t("FUSION.Combat.Setup.CandidatesHint")}
          >
            {t("FUSION.Combat.Setup.Candidates")}
          </button>
        </div>
        {#if !activeSceneState.id}
          <p class="combat-panel__empty-text">{t("FUSION.Combat.Setup.CandidatesNoScene")}</p>
        {/if}
      {/if}
    </div>

  {:else}
    <!-- ---- Header (REQ-CBA-011/012/013) ----
      In andamento it carries the round number; in montagem it carries the two numbers that
      say whether the encounter can start — how many are in, and how many still have no
      initiative. It carries no ✕ and no width control (REQ-CBA-012): closing the drawer and
      sizing it belong to the drawer, not to a tab inside it. -->
    <div class="combat-panel__header">
      <span class="combat-panel__round">
        {#if isAssembling}
          {t("FUSION.Combat.NotStarted")}
        {:else}
          {t("FUSION.Combat.Started", { round: combat.round })}
        {/if}
      </span>

      {#if isAssembling}
        <span class="combat-panel__count">
          {#if summary.total === 0}
            {t("FUSION.Combat.Setup.CountEmpty")}
          {:else if summary.withoutInitiative === 0}
            {t("FUSION.Combat.Setup.CountReady", { total: summary.total })}
          {:else}
            {t("FUSION.Combat.Setup.Count", {
              total: summary.total,
              pending: summary.withoutInitiative,
            })}
          {/if}
        </span>
      {/if}

      {#if isGm && controls}
        <div class="combat-panel__header-btns">
          {#if controls.canStart}
            <button
              class="btn btn--primary btn--xs"
              onclick={() => combatActions.start(socket, combat._id)}
              disabled={busy}
              title={t("FUSION.Combat.Begin")}
            >{t("FUSION.Combat.Begin")}</button>
          {/if}

          <!-- DEC-CBA-02: while the turn head is up, advancing, rewinding and ending
               belong to it and to nowhere else — a second "next" somewhere in the header
               is a second place for the most repeated gesture to be, which is exactly what
               REQ-CBA-021 is against, and REQ-CBA-071 names the head as where the three
               gestures are reached from. In montagem there is no head, so the header keeps
               them. -->
          {#if controls.canPrevious && !showTurnHead}
            <button
              class="btn btn--ghost btn--xs"
              onclick={() => combatActions.previousTurn(socket, combat._id)}
              disabled={busy}
              title={t("FUSION.Combat.PreviousTurn")}
              aria-label={t("FUSION.Combat.PreviousTurn")}
            >&#x276E;</button>
          {/if}

          {#if controls.canNext && !showTurnHead}
            <button
              class="btn btn--accent btn--xs"
              onclick={() => combatActions.nextTurn(socket, combat._id)}
              disabled={busy}
              title={t("FUSION.Combat.NextTurn")}
              aria-label={t("FUSION.Combat.NextTurn")}
            >&#x276F;</button>
          {/if}

          {#if controls.canEnd && !showTurnHead}
            <button
              class="btn btn--danger btn--xs"
              onclick={() => combatActions.end(socket, combat._id)}
              disabled={busy}
              title={t("FUSION.Combat.End")}
              aria-label={t("FUSION.Combat.End")}
            >{t("FUSION.Combat.End")}</button>
          {/if}
        </div>
      {/if}
    </div>

    <!-- ---- Assembly sub-controls (REQ-CBA-060/063) ----
      Only while assembling: once the encounter is running the number is gone for everyone
      (REQ-CBA-070), so a bulk roll would be a gesture with no visible result. -->
    {#if isGm && controls && isAssembling}
      <div class="combat-panel__subcontrols">
        <button
          class="btn btn--ghost btn--xs"
          onclick={handleToggleCandidates}
          disabled={busy || !activeSceneState.id}
          aria-expanded={candidatesOpen}
          aria-controls="combat-candidates"
          title={t("FUSION.Combat.Setup.CandidatesHint")}
        >{t("FUSION.Combat.Setup.Candidates")}</button>
        {#if controls.canRollAll}
          <button
            class="btn btn--ghost btn--xs"
            onclick={() => combatActions.rollInitiative(socket, combat._id)}
            disabled={busy}
            title={t("FUSION.Combat.RollAll")}
          >{t("FUSION.Combat.RollAll")}</button>
          <!-- REQ-CBA-063: the opposition rolls without rolling over the players, who have
               their own gesture on their own rows (REQ-CBA-065). -->
          <button
            class="btn btn--ghost btn--xs"
            onclick={handleRollCreatures}
            disabled={busy || creatureIds.length === 0}
            title={t("FUSION.Combat.Setup.RollCreaturesTitle")}
          >{t("FUSION.Combat.Setup.RollCreatures")}</button>
        {/if}
        {#if controls.canReset}
          <button
            class="btn btn--ghost btn--xs"
            onclick={() => combatActions.resetInitiative(socket, combat._id)}
            disabled={busy}
            title={t("FUSION.Combat.Setup.ClearInitiative")}
          >{t("FUSION.Combat.Setup.ClearInitiative")}</button>
        {/if}
      </div>
    {/if}

    <!-- ---- Candidates the active scene offers (REQ-CBA-060/061, DEC-CBA-06) ----
      A collapsible block of this very panel — no floating window, no change of width
      (DEC-CBA-12). It never says "token" (REQ-CBA-062): the word has no owning spec, and
      the aba calls what the scene offers a candidate until `41` says otherwise. -->
    {#if isGm && candidatesOpen}
      <div
        class="candidates"
        id="combat-candidates"
        role="region"
        aria-label={t("FUSION.Combat.Setup.Candidates")}
      >
        <div class="candidates__header">
          <span class="candidates__title">{t("FUSION.Combat.Setup.CandidatesHint")}</span>
          <button
            class="btn btn--ghost btn--xs"
            onclick={() => { candidatesOpen = false; }}
            aria-expanded="true"
            aria-controls="combat-candidates"
            type="button"
          >{t("FUSION.Combat.Setup.Collapse")}</button>
        </div>
        {#if candidates.length === 0}
          <p class="candidates__empty">{t("FUSION.Combat.Setup.CandidatesEmpty")}</p>
        {:else}
          <ul class="candidates__list" role="list">
            {#each candidates as candidate (candidate.id)}
              <li class="candidates__item">
                <span class="candidates__name" title={candidate.name}>{candidate.name}</span>
                <button
                  class="btn btn--primary btn--xs"
                  onclick={() => void handleAddCandidate(candidate.id, candidate.actorId)}
                  disabled={busy}
                  aria-label={t("FUSION.Combat.Setup.AddCandidate", { name: candidate.name })}
                  type="button"
                >{t("FUSION.Combat.Setup.Add")}</button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    <!-- ---- Turn head (REQ-CBA-020) ----
      Above the list and OUTSIDE it: the list below is the element that scrolls
      (REQ-CBA-036), and the head must not travel with it. Health arrives already decided
      by role (REQ-CBA-040/041) and is `null` whenever it is not this viewer's to read or
      not resolvable, which the head omits rather than drawing an empty bar (REQ-CBA-043);
      conditions arrive ordered by the system's declared contract (REQ-CBA-050/051) and do
      not consult the health rule (REQ-CBA-053). -->
    {#if showTurnHead && activeRow}
      {@const row = activeRow}
      <TurnHead
        name={row.name}
        img={row.img}
        isYours={isMyTurn}
        defeated={row.isDefeated}
        health={vitals.get(row.id)?.health ?? null}
        conditions={vitals.get(row.id)?.conditions ?? []}
        canAdvance={gmControls || canEndOwnTurn}
        canPrevious={gmControls && (controls?.canPrevious ?? false)}
        canEnd={gmControls && (controls?.canEnd ?? false)}
        advanceLabel={canEndOwnTurn ? t("FUSION.Combat.TurnHead.EndMyTurn") : undefined}
        busy={busy}
        onAdvance={() => void combatActions.nextTurn(socket, combat._id)}
        onPrevious={() => void combatActions.previousTurn(socket, combat._id)}
        onEnd={() => void combatActions.end(socket, combat._id)}
      />
    {/if}

    <!-- ---- Turn notice (REQ-CBA-074) ----
      The other half of the notice: when the turn is a participant of this user's, the head
      already says so in words (REQ-CBA-024); when it is not, what the player needs is the
      distance to their own, and the rotated queue is exactly that sequence. Nothing is said
      when they own nobody here — there is no number, and inventing one is worse than
      silence. It sits outside the scroller so it does not travel with the queue, and after
      the head so the head's fixed height is untouched (REQ-CBA-021). -->
    {#if showTurnHead && !gmControls && turnsUntilMine !== null}
      <p class="combat-panel__turn-notice" role="status">
        {turnsUntilMine === 1
          ? t("FUSION.Combat.TurnNotice.Next")
          : t("FUSION.Combat.TurnNotice.Waiting", { count: turnsUntilMine })}
      </p>
    {/if}

    <!-- ---- The queue (REQ-CBA-030..036) ----
      This div is the panel's only scroller: the head above it stays put while twenty
      participants roll past (REQ-CBA-036). What scrolls inside is CombatQueue, which
      owns the rotation's two groups, the marks and the reorder gestures. -->
    <div class="combat-panel__list" aria-label={t("FUSION.Combat.TurnOrder")}>
      {#if rows.length === 0}
        <p class="combat-panel__empty-text">
          {isGm ? t("FUSION.Combat.NoCombatantsGm") : t("FUSION.Combat.NoCombatants")}
        </p>
      {:else}
        <CombatQueue
          {queue}
          {vitals}
          {initiativeCells}
          {statisticOptions}
          {gmControls}
          {busy}
          order={turnOrder}
          rollable={rollableByPlayer}
          onReorder={(order) => void combatActions.reorder(socket, combat._id, order)}
          onRollInitiative={(id, statistic) => void handleRollOne(id, statistic)}
          onToggleDefeated={(id, defeated) =>
            void combatActions.toggleDefeated(socket, combat._id, id, defeated)}
          onToggleHidden={(id, hidden) =>
            void combatActions.setHidden(socket, combat._id, id, hidden)}
          onRemove={(id) => void combatActions.removeCombatant(socket, combat._id, id)}
          onSetInitiative={(id, value) =>
            void combatActions.setInitiative(socket, combat._id, id, value)}
        />
      {/if}
    </div>
  {/if}

</div>

<style>
  .combat-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ---- Empty state ---- */
  .combat-panel__empty {
    align-items: center;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    justify-content: center;
    padding: 2rem 1rem;
    text-align: center;
  }

  .combat-panel__empty-text {
    color: var(--fusion-text-subtle);
    font-size: 0.8125rem;
  }

  .combat-panel__empty-actions {
    display: flex;
    gap: 0.5rem;
  }

  /* ---- Candidates block (REQ-CBA-060/061) ----
     A block of the panel, bounded in height so a crowded scene cannot push the queue off
     the bottom — and never a floating window, and never wider than the drawer. */
  .candidates {
    border-bottom: 1px solid var(--fusion-border);
    flex-shrink: 0;
    padding: 0.5rem 0.75rem;
  }

  .candidates__header {
    align-items: center;
    display: flex;
    gap: 0.5rem;
    justify-content: space-between;
    margin-bottom: 0.4rem;
  }

  .candidates__title {
    color: var(--fusion-text);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .candidates__empty {
    color: var(--fusion-text-subtle);
    font-size: 0.75rem;
    padding: 0.4rem 0;
  }

  .candidates__list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    list-style: none;
    max-height: 160px;
    overflow-y: auto;
  }

  .candidates__item {
    align-items: center;
    background: var(--fusion-surface-alt);
    border-radius: var(--fusion-radius-sm);
    display: flex;
    gap: 0.5rem;
    justify-content: space-between;
    padding: 0.25rem 0.4rem;
  }

  .candidates__name {
    color: var(--fusion-text);
    font-size: 0.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ---- Header ---- */
  .combat-panel__header {
    align-items: center;
    border-bottom: 1px solid var(--fusion-border);
    display: flex;
    flex-shrink: 0;
    gap: 0.5rem;
    justify-content: space-between;
    padding: 0.5rem 0.75rem;
  }

  .combat-panel__round {
    color: var(--fusion-text);
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  /* REQ-CBA-011: the montagem count, next to the state, in the same header. */
  .combat-panel__count {
    color: var(--fusion-text-muted);
    flex: 1;
    font-size: 0.6875rem;
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .combat-panel__header-btns {
    display: flex;
    gap: 0.25rem;
  }

  /* ---- Sub-controls ---- */
  .combat-panel__subcontrols {
    border-bottom: 1px solid var(--fusion-border);
    display: flex;
    flex-shrink: 0;
    gap: 0.25rem;
    padding: 0.3rem 0.5rem;
  }

  /* ---- Error ---- */
  .combat-panel__error {
    color: var(--fusion-danger);
    font-size: 0.75rem;
    padding: 0.4rem 0.75rem;
  }

  /* ---- List ---- */
  .combat-panel__list {
    flex: 1;
    overflow-y: auto;
    padding: 0.25rem 0;
  }

  /* REQ-CBA-074: outside the scroller, so the distance to your turn stays readable while
     the queue scrolls. It is one line and never wraps into the list's space. */
  .combat-panel__turn-notice {
    color: var(--fusion-text-muted);
    flex: none;
    font-size: 0.75rem;
    margin: 0;
    overflow: hidden;
    padding: 0.25rem 0.5rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ---- Buttons ---- */
  .btn {
    align-items: center;
    border: 1px solid transparent;
    border-radius: var(--fusion-radius-sm);
    cursor: pointer;
    display: inline-flex;
    font-family: var(--fusion-font);
    font-size: 0.875rem;
    font-weight: 500;
    justify-content: center;
    padding: 0.5rem 1.25rem;
    transition: background-color var(--fusion-transition), opacity var(--fusion-transition);
    white-space: nowrap;
  }

  .btn:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  .btn--primary {
    background: var(--fusion-accent);
    color: #fff;
  }

  .btn--primary:hover:not(:disabled) {
    background: var(--fusion-accent-hover);
  }

  .btn--ghost {
    background: transparent;
    border-color: var(--fusion-border);
    color: var(--fusion-text-muted);
  }

  .btn--ghost:hover:not(:disabled) {
    background: var(--fusion-surface-alt);
    color: var(--fusion-text);
  }

  .btn--accent {
    background: rgba(255, 215, 0, 0.15);
    border-color: #ffd700;
    color: #ffd700;
  }

  .btn--accent:hover:not(:disabled) {
    background: rgba(255, 215, 0, 0.25);
  }

  .btn--danger {
    background: transparent;
    border-color: var(--fusion-danger);
    color: var(--fusion-danger);
  }

  .btn--danger:hover:not(:disabled) {
    background: rgba(255, 92, 92, 0.1);
  }

  .btn--sm {
    font-size: 0.8125rem;
    padding: 0.3rem 0.75rem;
  }

  .btn--xs {
    font-size: 0.75rem;
    padding: 0.2rem 0.5rem;
  }
</style>
