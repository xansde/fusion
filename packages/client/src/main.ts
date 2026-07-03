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
 */

import "./styles/base.css";
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
