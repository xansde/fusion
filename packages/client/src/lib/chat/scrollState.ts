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
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScrollStateCallbacks {
  /** Scroll the element to the bottom. */
  scrollToBottom: () => void;
  /** Show or hide the "new messages" indicator. */
  setIndicatorVisible: (visible: boolean) => void;
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
      this._callbacks.setIndicatorVisible(false);
    } else if (!atBottom && this._pinned) {
      // User started scrolling up — unpin
      this._pinned = false;
    }
  }

  /**
   * Call when a new message arrives.
   */
  onNewMessage(): void {
    if (this._pinned) {
      // Auto-scroll
      this._callbacks.scrollToBottom();
    } else {
      // Accumulate unseen messages
      this._pendingCount += 1;
      this._callbacks.setIndicatorVisible(true);
    }
  }

  /**
   * Call when the user clicks the "new messages" indicator.
   */
  jumpToBottom(): void {
    this._pinned = true;
    this._pendingCount = 0;
    this._callbacks.setIndicatorVisible(false);
    this._callbacks.scrollToBottom();
  }

  /**
   * Force-scroll to bottom and re-pin (e.g., on initial history load).
   */
  forceScrollToBottom(): void {
    this._pinned = true;
    this._pendingCount = 0;
    this._callbacks.setIndicatorVisible(false);
    this._callbacks.scrollToBottom();
  }

  get pinned(): boolean {
    return this._pinned;
  }

  get pendingCount(): number {
    return this._pendingCount;
  }
}
