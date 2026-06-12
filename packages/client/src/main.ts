/**
 * Fusion VTT — browser entry point.
 *
 * Mounts the root Svelte 5 application into #fusion-app.
 * REQ-ARQ-003: this module must NOT import from @fusion/server.
 * REQ-ARQ-013: full boot sequence (auth → WebSocket → snapshot → PIXI) is M0-C.
 */

import "./styles/base.css";
import { mount } from "svelte";
import App from "./App.svelte";

const target = document.getElementById("fusion-app");
if (!target) {
  throw new Error("Mount target #fusion-app not found in DOM.");
}

mount(App, { target });
