/**
 * scrollState.ts — scroll state machine for the chat log.
 *
 * Tracks whether the user is scrolled to the bottom ("pinned") or has
 * scrolled up. When pinned, new messages auto-scroll the view. When not
 * pinned, a "new messages" indicator is shown instead.
 *
 * Pure logic — no DOM, no Svelte runes. Accepts a callback interface so
 * it can be unit-tested without a browser.
 *
 * REQ-CHT spec 09: scroll gruda no fim; indicador de novas mensagens.
 *
 * Spec 38 (`specs/38-aba-chat.md`) §5.1 turned that indicator into a contract:
 *  - REQ-ACH-006: with the tab open and the log away from the end, an incoming
 *    message must NOT move the log. The count of what piled up is part of the
 *    floating notice ("↓ N novas"), so `setIndicatorVisible` carries it;
 *  - REQ-ACH-005: the "N novas" divider survives until the reader actually
 *    reaches the end of the log — which only this state machine can observe, so
 *    it reports the moment through `reachedEnd`;
 *  - REQ-ACH-004: opening the tab lands on the first unread instead of the end,
 *    which is `positionAtAnchor()`: not pinned, nothing pending, no notice.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScrollStateCallbacks {
  /** Scroll the element to the bottom. */
  scrollToBottom: () => void;
  /**
   * Show or hide the "new messages" notice.
   *
   * `count` is how many messages piled up while the reader was away from the
   * end — the number the notice spells out (REQ-ACH-006). It is `0` whenever
   * `visible` is `false`.
   */
  setIndicatorVisible: (visible: boolean, count: number) => void;
  /**
   * The view just reached the end of the log (REQ-ACH-005).
   *
   * Fired on the transition only — scrolling around at the bottom does not
   * repeat it. The chat uses it to retire the "N novas" divider; a log with no
   * divider simply has nothing to do here, which is why it is optional.
   */
  reachedEnd?: () => void;
}

// ---------------------------------------------------------------------------
// ScrollStateManager
// ---------------------------------------------------------------------------

/**
 * Manages scroll behavior for a chat log container.
 *
 * Usage:
 *   const sm = new ScrollStateManager(callbacks);
 *   // On scroll event:
 *   sm.onScroll(scrollTop, scrollHeight, clientHeight);
 *   // When a new message arrives:
 *   sm.onNewMessage();
 *   // When user clicks "jump to bottom":
 *   sm.jumpToBottom();
 */
export class ScrollStateManager {
  /** Whether the view is pinned to the bottom. */
  private _pinned = true;
  /** Number of new messages received while not pinned. */
  private _pendingCount = 0;
  /** Distance from bottom (px) that counts as "at bottom". */
  private readonly _threshold: number;

  constructor(
    private readonly _callbacks: ScrollStateCallbacks,
    threshold = 40,
  ) {
    this._threshold = threshold;
  }

  /**
   * Call this on the scroll event with current scroll metrics.
   */
  onScroll(scrollTop: number, scrollHeight: number, clientHeight: number): void {
    const distanceFromBottom = scrollHeight - clientHeight - scrollTop;
    const atBottom = distanceFromBottom <= this._threshold;

    if (atBottom && !this._pinned) {
      // User scrolled back to the bottom — re-pin and clear indicator
      this._pinned = true;
      this._pendingCount = 0;
      this._callbacks.setIndicatorVisible(false, 0);
      this._callbacks.reachedEnd?.();
    } else if (!atBottom && this._pinned) {
      // User started scrolling up — unpin
      this._pinned = false;
    }
  }

  /**
   * Call when a new message arrives.
   *
   * Away from the end the log does NOT move (REQ-ACH-006): the arrival only
   * raises the pending count, which the notice spells out.
   */
  onNewMessage(): void {
    if (this._pinned) {
      // Auto-scroll
      this._callbacks.scrollToBottom();
    } else {
      // Accumulate unseen messages
      this._pendingCount += 1;
      this._callbacks.setIndicatorVisible(true, this._pendingCount);
    }
  }

  /**
   * Call when the user clicks the "new messages" indicator.
   */
  jumpToBottom(): void {
    this._pinned = true;
    this._pendingCount = 0;
    this._callbacks.setIndicatorVisible(false, 0);
    this._callbacks.scrollToBottom();
    this._callbacks.reachedEnd?.();
  }

  /**
   * Force-scroll to bottom and re-pin (e.g., on initial history load).
   */
  forceScrollToBottom(): void {
    this._pinned = true;
    this._pendingCount = 0;
    this._callbacks.setIndicatorVisible(false, 0);
    this._callbacks.scrollToBottom();
    this._callbacks.reachedEnd?.();
  }

  /**
   * Land on the first unread instead of the end (REQ-ACH-004).
   *
   * The caller has already moved the viewport to the anchor element; what this
   * records is the consequence — the view is NOT at the end, so a message that
   * arrives next must not drag it there (REQ-ACH-006). Nothing is pending yet,
   * so no notice is drawn, and `reachedEnd` deliberately does not fire: the
   * reader has not reached the end, that is the whole point of the anchor.
   */
  positionAtAnchor(): void {
    this._pinned = false;
    this._pendingCount = 0;
    this._callbacks.setIndicatorVisible(false, 0);
  }

  get pinned(): boolean {
    return this._pinned;
  }

  get pendingCount(): number {
    return this._pendingCount;
  }
}

// ---------------------------------------------------------------------------
// Where the "N novas" divider goes (REQ-ACH-004, RNF-ACH-02)
// ---------------------------------------------------------------------------

/**
 * Decide which rendered row the "N novas" divider sits above.
 *
 * The log renders one row per *top-level* message: a nested roll (attack, damage,
 * save) is drawn inside its parent card and has no row of its own. So the first
 * unread may well be a message that is not itself drawable — the divider then
 * belongs above the first row that is at or after it, which is the row the reader
 * has to look at to see what they missed.
 *
 * Returns `null` when the anchor is not in the loaded page at all. That is the
 * RNF-ACH-02 half: the anchor is resolved against what pagination has already
 * brought in, never by walking the whole history to find it — an anchor that
 * aged out of the loaded window simply stops having a divider.
 *
 * Pure: ids in, id out. No DOM, no store, no I/O.
 */
export function resolveMarkerAnchorId(
  orderedIds: readonly string[],
  topLevelIds: readonly string[],
  anchorId: string | null | undefined,
): string | null {
  if (!anchorId) return null;

  const anchorIndex = orderedIds.indexOf(anchorId);
  if (anchorIndex < 0) return null;

  const atOrAfter = new Set(orderedIds.slice(anchorIndex));
  for (const id of topLevelIds) {
    if (atOrAfter.has(id)) return id;
  }
  return null;
}
