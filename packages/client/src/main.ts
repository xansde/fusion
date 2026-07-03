/**
 * Fusion VTT — browser entry point.
 *
 * Mounts the root Svelte 5 application into #fusion-app.
 * REQ-ARQ-003: this module must NOT import from @fusion/server.
 * REQ-ARQ-013: full boot sequence (auth → WebSocket → snapshot → PIXI) is M0-C.
 *
 * Routing decision (M6/B2, REQ-DST-011): the client has no general-purpose
 * router (App.svelte is a single-shell state machine driven by
 * session.svelte.ts's `screen`, not URL-based routes — see App.svelte's own
 * doc comment). Rather than bolt on a router dependency for exactly one
 * extra path, /setup is handled here at the entry point with a plain
 * `pathname` check: it mounts a COMPLETELY SEPARATE component
 * (SetupWizard.svelte) that never touches session.svelte.ts, the socket
 * layer, or the game API — it only talks to /admin/*. This keeps the
 * install-time admin plane (REQ-DST-015A plan 1) fully decoupled from the
 * game session plane (plan 2), matching the server-side separation between
 * admin/routes.ts and auth/routes.ts. The server's SPA catch-all
 * (spa/routes.ts) already serves index.html for /setup like any other
 * unmatched path, so no server-side routing change was needed for this to
 * work — see spa/routes.ts's catch-all doc comment.
 *
 * i18n bootstrap (bug fix): most components call `t()`/`i18n` via the bare
 * resolver module (`lib/i18n/i18n.js`), which exports an EMPTY singleton —
 * the pt-BR/en bundles are only registered as a side effect of importing the
 * barrel (`lib/i18n/index.js`, see that file's own doc comment). Previously
 * nothing imported the barrel on the /setup path (SetupWizard.svelte mounts
 * standalone here, without ever touching App.svelte's tree), so the wizard
 * rendered raw translation keys ("FUSION.Setup.Title" etc.) instead of
 * pt-BR text — the shared singleton was simply never populated on that path.
 * The main App tree happened to reach the barrel incidentally, through a
 * dynamically-registered Etmos character sheet several hops away, which is
 * NOT a reliable load-bearing path either. Importing the barrel here, once,
 * for its registerBundle() side effect, guarantees both entry points always
 * have translations loaded before anything calls t().
 */

import "./styles/base.css";
import "./lib/i18n/index.js";
import { mount } from "svelte";

const target = document.getElementById("fusion-app");
if (!target) {
  throw new Error("Mount target #fusion-app not found in DOM.");
}

if (window.location.pathname === "/setup") {
  const { default: SetupWizard } = await import("./components/setup/SetupWizard.svelte");
  mount(SetupWizard, { target });
} else {
  const { default: App } = await import("./App.svelte");
  mount(App, { target });
}
