/**
 * legacySidebarRemoved.test.ts — the burial of the pre-drawer sidebar (plan G017).
 *
 * The drawer of spec 36 is not "another sidebar next to the old one": while the
 * legacy component survives in the tree, a second collapse control and a second
 * source of drawer state survive with it, and the next lane wires a tab into the
 * wrong file. So the removal itself is the behaviour under test.
 *
 * Covers REQ-GAV-011 (the rail's active tab is the ONLY collapse gesture — the
 * legacy `❯`/`☰` toggle must not exist anywhere to be mounted) and REQ-GAV-014
 * (`open`/`activeTab` live in the drawer's per world+user preferences, not in an
 * in-memory object owned by the scenes module).
 *
 * The scene LIST is not drawer state and stays: it is world data mirrored from the
 * server, and the Cenas tab still reads it.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as scenesState from "../../scenes/scenesState.svelte.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/** packages/client/src */
const CLIENT_SRC = resolve(HERE, "..", "..", "..");
/** This very file mentions the buried names, so it is never its own evidence. */
const SELF = resolve(HERE, "legacySidebarRemoved.test.ts");

const SOURCE_FILE = /\.(ts|svelte)$/;

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (SOURCE_FILE.test(entry) && resolve(full) !== SELF) {
      out.push(full);
    }
  }
  return out;
}

const SOURCES = listSourceFiles(CLIENT_SRC);

function filesMentioning(name: string): string[] {
  return SOURCES.filter((file) => readFileSync(file, "utf8").includes(name)).map((file) =>
    file.slice(CLIENT_SRC.length + 1).replace(/\\/g, "/"),
  );
}

describe("the pre-drawer sidebar is buried (G017)", () => {
  it("REQ-GAV-011: no legacy sidebar component is left in the client to be mounted", () => {
    // Both carried their own ❯/☰ collapse button, which REQ-GAV-011 forbids.
    expect(filesMentioning("AppSidebar")).toEqual([]);
    expect(filesMentioning("ScenesSidebar")).toEqual([]);
  });

  it("REQ-GAV-014: the scenes module no longer owns any drawer state", () => {
    const exported = Object.keys(scenesState);

    // `open`/`activeTab` belong to lib/sidebar (persisted per world+user), and the
    // toggle belongs to the rail's active tab — none of it lives here anymore.
    expect(exported).not.toContain("sidebarState");
    expect(exported).not.toContain("toggleSidebar");
    expect(exported).not.toContain("openSidebar");
  });

  it("REQ-GAV-014: the scene list survives the burial — it is world data, not drawer state", () => {
    expect(typeof scenesState.refreshSceneList).toBe("function");
    expect(typeof scenesState.attachSceneListSync).toBe("function");
    expect(Array.isArray(scenesState.sceneListState.scenes)).toBe(true);
    // What stayed is world data only — the scenes and, since REQ-CEN-030, the folders
    // the archive groups them by. No drawer state came back in with them.
    expect(Object.keys(scenesState.sceneListState)).toEqual(["scenes", "folders"]);
    expect(Array.isArray(scenesState.sceneListState.folders)).toBe(true);
  });
});
