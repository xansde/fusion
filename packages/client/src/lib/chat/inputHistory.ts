/**
 * inputHistory.ts — keyboard history navigation for the chat input.
 *
 * Maintains a circular buffer of sent messages (up to MAX_HISTORY items).
 * Arrow-up navigates backwards; arrow-down navigates forwards.
 * When at the newest end and pressing down, the input is restored to the
 * draft (the text typed but not yet sent).
 *
 * Pure logic — no DOM, no Svelte runes.
 *
 * REQ-CHT spec 09: history com setas ↑↓.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HISTORY = 50;

// ---------------------------------------------------------------------------
// InputHistory
// ---------------------------------------------------------------------------

export class InputHistory {
  private _entries: string[] = [];
  /** Current navigation cursor (-1 = not navigating, i.e., draft is shown). */
  private _cursor = -1;
  /** Text that was in the input before the user started navigating. */
  private _draft = "";

  /**
   * Push a new entry when the user successfully sends a message.
   * Does not push empty strings or duplicates of the last entry.
   */
  push(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (this._entries[this._entries.length - 1] === trimmed) return;

    this._entries.push(trimmed);
    if (this._entries.length > MAX_HISTORY) {
      this._entries.shift();
    }
    // Reset navigation
    this._cursor = -1;
    this._draft = "";
  }

  /**
   * Handle arrow-up key.
   * @param currentText The current text in the input field.
   * @returns The text to set in the input, or null if no change.
   */
  navigateUp(currentText: string): string | null {
    if (this._entries.length === 0) return null;

    if (this._cursor === -1) {
      // Save draft before starting navigation
      this._draft = currentText;
      this._cursor = this._entries.length - 1;
    } else if (this._cursor > 0) {
      this._cursor -= 1;
    } else {
      // Already at the oldest entry — no change
      return this._entries[0] ?? null;
    }

    return this._entries[this._cursor] ?? null;
  }

  /**
   * Handle arrow-down key.
   * @returns The text to set in the input, or null if no change.
   */
  navigateDown(): string | null {
    if (this._cursor === -1) return null; // Not navigating

    if (this._cursor < this._entries.length - 1) {
      this._cursor += 1;
      return this._entries[this._cursor] ?? null;
    } else {
      // Past the newest entry — restore draft
      this._cursor = -1;
      return this._draft;
    }
  }

  /**
   * Reset navigation state (call when input is manually edited while navigating).
   */
  resetNavigation(): void {
    this._cursor = -1;
    this._draft = "";
  }

  get cursor(): number {
    return this._cursor;
  }

  get length(): number {
    return this._entries.length;
  }
}
