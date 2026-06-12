/**
 * OpBuffer — circular buffer of the last N canonical ops per world.
 *
 * REQ-NET-062: server maintains a circular buffer of the last N=1000
 * canonical ops per world (each with its seq) to support delta resync.
 *
 * Design:
 *   - Fixed-size circular array in memory (no persistence — survives reconnects
 *     within the same server process, but resets on server restart).
 *   - push(op) — adds an op to the buffer, overwriting the oldest when full.
 *   - opsAfter(lastSeq, currentSeq) — returns ops with seq > lastSeq in order,
 *     or null if the range cannot be served (buffer overflow or post-restart
 *     empty buffer with stale client). Null signals snapshot fallback needed.
 */

import type { Envelope } from "@fusion/shared";

export const OP_BUFFER_SIZE = 1000;

export class OpBuffer {
  /** Fixed-capacity ring storage. */
  private readonly ring: Array<Envelope | undefined>;
  /** Write pointer (index of next slot to write). */
  private writeIdx = 0;
  /** Total number of ops ever pushed (monotonic). */
  private totalPushed = 0;

  constructor(private readonly capacity = OP_BUFFER_SIZE) {
    this.ring = new Array<Envelope | undefined>(capacity).fill(undefined);
  }

  /**
   * Push a canonical op into the buffer.
   * The op MUST have op.seq set by the caller.
   */
  push(op: Envelope): void {
    this.ring[this.writeIdx] = op;
    this.writeIdx = (this.writeIdx + 1) % this.capacity;
    this.totalPushed += 1;
  }

  /**
   * Return all ops with seq > lastSeq, in ascending seq order.
   *
   * @param lastSeq     Last seq the client has already applied.
   * @param currentSeq  The server's current canonical seq (from SeqStore.peek()).
   *                    Required to correctly handle the post-restart case where
   *                    the ring buffer is empty but the persistent seq is ahead
   *                    of what the client knows.
   *
   * Returns null when the range [lastSeq+1 .. currentSeq] cannot be served
   * from the buffer — either because:
   *   (a) the buffer is empty yet lastSeq < currentSeq (server restarted and
   *       lost in-memory ops — client is stale), or
   *   (b) lastSeq is older than the oldest op still in the ring (buffer overflow).
   * In both cases the caller must fall back to a full snapshot.
   *
   * Returns an empty array only when the client is genuinely up-to-date
   * (lastSeq >= currentSeq, nothing to replay).
   */
  opsAfter(lastSeq: number, currentSeq: number): Envelope[] | null {
    // Client already up-to-date — nothing to send regardless of buffer state.
    if (lastSeq >= currentSeq) {
      return [];
    }

    // Collect all non-undefined entries
    const all: Envelope[] = [];
    for (const entry of this.ring) {
      if (entry !== undefined) {
        all.push(entry);
      }
    }

    if (all.length === 0) {
      // Buffer is empty but the client is behind (lastSeq < currentSeq).
      // This happens after a server restart: the SeqStore loaded a non-zero seq
      // from the DB but the in-memory ring was cleared.  We cannot reconstruct
      // the missing ops, so the client must perform a full snapshot resync.
      return null;
    }

    // Sort by seq (ring order may not be ascending after wraparound)
    all.sort((a, b) => ((a.seq ?? 0) > (b.seq ?? 0) ? 1 : -1));

    // The oldest seq still in the buffer
    const oldestSeq = all[0]?.seq ?? 0;

    // If lastSeq is less than oldestSeq - 1, the gap is too large.
    // Special case: lastSeq === 0 means the client has no ops at all;
    // if the buffer happens to start at seq=1 (common case), allow it.
    if (lastSeq < oldestSeq - 1) {
      return null; // buffer overflow — full snapshot needed
    }

    // Return ops strictly after lastSeq
    return all.filter((op) => (op.seq ?? 0) > lastSeq);
  }

  /** The number of ops currently stored (≤ capacity). */
  get size(): number {
    return Math.min(this.totalPushed, this.capacity);
  }
}
