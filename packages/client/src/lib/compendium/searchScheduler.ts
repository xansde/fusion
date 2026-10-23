/**
 * searchScheduler.ts — the two halves of RNF-CPD-02, in one pure module.
 *
 * Spec 43 (`specs/43-aba-compendio.md`) §6: "Digitar na busca NÃO DEVE disparar
 * uma requisição por tecla: as chamadas DEVEM ser agrupadas, e uma resposta
 * atrasada NÃO DEVE sobrescrever um resultado mais novo."
 *
 * Those are two different failures with one cause — the panel treating every
 * keystroke as an independent question — so they are answered by one object:
 *
 * 1. **Grouping.** `schedule()` restarts a short window; only the LAST query
 *    asked inside that window ever reaches the wire. Typing "fireball" is one
 *    request, not eight.
 * 2. **Latest wins.** Every request that does go out carries a token, and an
 *    answer whose token is no longer the current one is DROPPED — never handed
 *    to `onResult`/`onError`. A slow answer to "fire" landing after the answer
 *    to "fireball" would otherwise repaint the list with the older question's
 *    result, which is the same bug the user sees as "the list flickers back".
 *
 * It is deliberately free of runes, DOM and socket: `CompendiumBrowser.svelte`
 * builds one of these with `run: (query) => searchAllPacks(...)` and the whole
 * rule stays unit-testable in the client's DOM-less Vitest.
 */

/** Whatever the host environment's timer returns. */
type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * The grouping window, in milliseconds.
 *
 * 200 ms is about one relaxed keystroke interval: long enough that a word typed
 * at speed is a single request, short enough that the result still feels like
 * it answers what is on screen. It lives here so the number has ONE home.
 */
export const SEARCH_GROUPING_MS = 200;

export interface SearchSchedulerOptions<Q, R> {
  /** Runs the query. Called at most once per grouping window. */
  readonly run: (query: Q) => Promise<R>;
  /** Called when a request actually leaves — the moment "searching" begins. */
  readonly onStart?: (query: Q) => void;
  /** Called only for the answer to the NEWEST request. */
  readonly onResult: (result: R, query: Q) => void;
  /** Called only for the failure of the NEWEST request. */
  readonly onError: (error: unknown, query: Q) => void;
  /** Grouping window; defaults to {@link SEARCH_GROUPING_MS}. */
  readonly delayMs?: number;
}

export interface SearchScheduler<Q> {
  /** Ask the question, grouped: restarts the window, replacing any pending ask. */
  schedule(query: Q): void;
  /** Ask it now, skipping the window — what a "try again" button presses. */
  runNow(query: Q): void;
  /**
   * Forget the pending ask AND disown every request already in flight, so
   * leaving the result body cannot be repainted by an answer arriving after.
   */
  cancel(): void;
}

export function createSearchScheduler<Q, R>(
  options: SearchSchedulerOptions<Q, R>,
): SearchScheduler<Q> {
  const delayMs = options.delayMs ?? SEARCH_GROUPING_MS;
  let timer: TimerHandle | null = null;
  let token = 0;

  function clearPending(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function fire(query: Q): void {
    const mine = ++token;
    options.onStart?.(query);
    void options.run(query).then(
      (result) => {
        // The guard is the whole of the second half of RNF-CPD-02: an answer
        // that is no longer the current question is dropped, not rendered.
        if (mine === token) options.onResult(result, query);
      },
      (error: unknown) => {
        if (mine === token) options.onError(error, query);
      },
    );
  }

  return {
    schedule(query: Q): void {
      clearPending();
      timer = setTimeout(() => {
        timer = null;
        fire(query);
      }, delayMs);
    },
    runNow(query: Q): void {
      clearPending();
      fire(query);
    },
    cancel(): void {
      clearPending();
      // Bumping the token disowns whatever is still in flight.
      token++;
    },
  };
}
