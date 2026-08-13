/**
 * noticeDemo.ts — SCAFFOLDING. Delete when a real caller emits notices.
 *
 * The notice stack has no producer yet: the callers arrive with spec 28 (a
 * mission advancing) and spec 34 (a location revealed). Until then the whole
 * component is invisible, which makes it impossible to review on screen.
 *
 * So, behind an explicit `?hud-demo=1` in the query string, this plays one
 * notice of each tone and hangs a replay hook on `window`. Off by default —
 * a session that did not ask for it sees nothing and pays nothing.
 *
 * It lives in `lib/` rather than inline in the component for one reason: it is
 * then testable, and a demo that silently stops working is a demo that will be
 * blamed on the feature it was meant to show.
 */

import type { NoticeInput } from "./systemNotice.js";

/** Query-string flag that turns the demo on. */
export const NOTICE_DEMO_PARAM = "hud-demo";

/** Name of the replay hook installed on `window`. */
export const NOTICE_DEMO_HOOK = "fusionHudDemo";

/** Delay before each notice, so they arrive as a sequence, not a wall. */
const STEP_MS = 1_200;

/** One of each tone, in the order a table would plausibly meet them. */
export const DEMO_NOTICES: readonly NoticeInput[] = [
  {
    title: "Sistema conectado",
    body: "Janela do Sistema disponível. Q, C e M abrem os painéis.",
    tone: "system",
  },
  {
    title: "Boato registrado",
    body: "Algo sobre a torre ao norte de Shoneymouth. Ninguém confirmou.",
    tone: "rumour",
  },
  { title: "Local revelado", body: "Shoneymouth entrou no seu mapa.", tone: "good" },
  { title: "Relógio avançou", body: "A facção rival ganhou um passo.", tone: "bad" },
] as const;

/** True when the current query string asks for the demo. */
export function isNoticeDemoRequested(search: string): boolean {
  return new URLSearchParams(search).has(NOTICE_DEMO_PARAM);
}

/** Minimal shape this module needs from `window`. */
export interface DemoHost {
  setTimeout: (handler: () => void, timeout: number) => number;
  clearTimeout: (handle: number) => void;
}

/**
 * Play the demo and install the replay hook.
 *
 * Returns a teardown that cancels pending timers and removes the hook — so an
 * unmount mid-sequence cannot fire a notice into a component that is gone.
 */
export function runNoticeDemo(emit: (input: NoticeInput) => string, host: DemoHost): () => void {
  // `Window` has no index signature, so hanging a property on it needs the
  // cast. Confined to this line rather than widening the parameter type, which
  // would make every caller prove something `window` cannot prove.
  const hookHost = host as unknown as Record<string, unknown>;
  const timers: number[] = [];

  const play = (): void => {
    DEMO_NOTICES.forEach((notice, index) => {
      timers.push(host.setTimeout(() => emit(notice), index * STEP_MS));
    });
  };

  play();
  hookHost[NOTICE_DEMO_HOOK] = play;

  return () => {
    for (const timer of timers) host.clearTimeout(timer);
    timers.length = 0;
    // Assigned rather than `delete`d: the key is computed, and dropping a
    // property off `window` is not worth the deoptimisation it triggers.
    hookHost[NOTICE_DEMO_HOOK] = undefined;
  };
}
