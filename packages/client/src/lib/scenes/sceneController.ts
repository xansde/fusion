/**
 * sceneController.ts — Controller for Scene CRUD operations.
 *
 * Pure TS, no Svelte, no PIXI — safe for Vitest.
 *
 * Responsibilities:
 *   - List scenes from DocumentMirror.
 *   - Validate + submit create/update/delete ops via sendOp.
 *   - Activate a scene (world:activeScene op).
 *   - Expose a typed SceneFormData interface and validate it.
 *
 * The controller does NOT hold reactive state — callers subscribe to
 * DocumentMirror directly for live scene lists.
 */

import type { Socket } from "socket.io-client";
import type { SceneDocument } from "@fusion/shared";
import { createDocumentId } from "@fusion/shared";
import { sendOp, OpError } from "../docs/sendOp.js";
import type { DocumentMirror } from "../docs/DocumentMirror.js";

// ---------------------------------------------------------------------------
// Form data
// ---------------------------------------------------------------------------

export interface SceneFormData {
  name: string;
  /**
   * The folder the scene is filed under, `null` for the unfiled group.
   * REQ-CEN-061: filing is configuration, which is why the archive's drag only
   * reorders inside a group and never moves a scene between folders.
   */
  folder: string | null;
  /** Scene width in pixels. */
  width: number;
  /** Scene height in pixels. */
  height: number;
  /** Grid cell size in pixels (min 50). */
  gridSize: number;
  /**
   * The colour painted under the scene — "preenchimento" of REQ-CEN-061. It is what
   * a scene with no background image shows, and what stays under one that is still
   * loading, so the head never flashes empty (REQ-CEN-012).
   */
  backgroundColor: string;
  /** Optional background URL or path. */
  background: string;
}

export interface SceneFormErrors {
  name?: string;
  width?: string;
  height?: string;
  gridSize?: string;
  backgroundColor?: string;
  background?: string;
}

/** `#rgb` or `#rrggbb` — the shape every scene colour in the schema already has. */
const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate SceneFormData.
 * Returns an empty object when valid, or an object with field-level messages.
 */
export function validateSceneForm(data: SceneFormData): SceneFormErrors {
  const errors: SceneFormErrors = {};

  if (!data.name.trim()) {
    errors.name = "Scene name is required.";
  } else if (data.name.trim().length > 128) {
    errors.name = "Scene name must be 128 characters or fewer.";
  }

  if (!Number.isInteger(data.width) || data.width < 100) {
    errors.width = "Width must be an integer of at least 100 px.";
  } else if (data.width > 20_000) {
    errors.width = "Width must not exceed 20 000 px.";
  }

  if (!Number.isInteger(data.height) || data.height < 100) {
    errors.height = "Height must be an integer of at least 100 px.";
  } else if (data.height > 20_000) {
    errors.height = "Height must not exceed 20 000 px.";
  }

  if (!Number.isInteger(data.gridSize) || data.gridSize < 50) {
    errors.gridSize = "Grid size must be an integer of at least 50 px.";
  } else if (data.gridSize > 500) {
    errors.gridSize = "Grid size must not exceed 500 px.";
  }

  if (!HEX_COLOUR.test(data.backgroundColor.trim())) {
    errors.backgroundColor = "Fill colour must be a hex value such as #101018.";
  }

  // background is optional; if present, just ensure it's a non-empty string
  if (data.background.trim() !== "" && data.background.trim().length > 1024) {
    errors.background = "Background path/URL must be 1 024 characters or fewer.";
  }

  return errors;
}

export function isFormValid(errors: SceneFormErrors): boolean {
  return Object.keys(errors).length === 0;
}

// ---------------------------------------------------------------------------
// Default form data
// ---------------------------------------------------------------------------

export function defaultSceneFormData(): SceneFormData {
  return {
    name: "",
    folder: null,
    width: 4000,
    height: 4000,
    gridSize: 100,
    backgroundColor: "#000000",
    background: "",
  };
}

// ---------------------------------------------------------------------------
// CRUD operations
// ---------------------------------------------------------------------------

/**
 * Create a new Scene document.
 * Resolves with the server-returned SceneDocument on success.
 * Rejects with OpError on failure.
 *
 * REQ-CEN-065: the new scene is born OFF air (`active: false`) and this function
 * emits nothing else — creating a scene is not a way to put one on air, which has
 * a single writer of its own (`activateScene`, DEC-CEN-02).
 *
 * `sort` is the position inside its folder; callers get it from
 * `nextSortInFolder(scenes, folder)` so a new scene lands at the END of its group
 * (REQ-CEN-031).
 */
export async function createScene(
  socket: Socket,
  data: SceneFormData,
  sort = 0,
): Promise<SceneDocument> {
  const id = createDocumentId();

  const sceneData: Record<string, unknown> = {
    _id: id,
    name: data.name.trim(),
    folder: data.folder,
    sort,
    width: data.width,
    height: data.height,
    backgroundColor: data.backgroundColor.trim(),
    grid: {
      type: "square",
      size: data.gridSize,
      distance: 5,
      units: "ft",
      color: "#000000",
      alpha: 0.2,
    },
    background: data.background.trim() || null,
    active: false,
    navigation: true,
    tokenVision: false,
    tokens: [],
    walls: [],
    lights: [],
    sounds: [],
    tiles: [],
    drawings: [],
    templates: [],
    notes: [],
  };

  const result = await sendOp<SceneDocument>(socket, {
    type: "doc:create",
    payload: {
      documentType: "Scene",
      data: [sceneData],
    },
  });

  return result;
}

/**
 * Update basic scene config — REQ-CEN-061's six fields: name, folder, dimensions,
 * fill colour, grid and background. Sends a minimal diff.
 *
 * `active` is deliberately absent: the generic document update refuses it anyway
 * (REQ-CEN-042), and configuring a scene is not a way to put it on air.
 */
export async function updateSceneConfig(
  socket: Socket,
  sceneId: string,
  data: SceneFormData,
): Promise<void> {
  await sendOp(socket, {
    type: "doc:update",
    payload: {
      documentType: "Scene",
      updates: [
        {
          _id: sceneId,
          diff: {
            name: data.name.trim(),
            folder: data.folder,
            width: data.width,
            height: data.height,
            "grid.size": data.gridSize,
            backgroundColor: data.backgroundColor.trim(),
            background: data.background.trim() || null,
          },
        },
      ],
    },
  });
}

/**
 * Activate a scene.
 *
 * Sends the dedicated world:activeScene op. The server handler
 * (buildActiveSceneHandler) atomically deactivates the previously active scene,
 * persists _meta:activeScene, and broadcasts world:activeScene to all clients.
 *
 * The server is responsible for the single active scene invariant.
 */
export async function activateScene(socket: Socket, sceneId: string): Promise<void> {
  await sendOp(socket, {
    type: "world:activeScene",
    payload: { sceneId },
  });
}

/**
 * Delete a Scene document.
 */
export async function deleteScene(socket: Socket, sceneId: string): Promise<void> {
  await sendOp(socket, {
    type: "doc:delete",
    payload: {
      documentType: "Scene",
      ids: [sceneId],
    },
  });
}

// ---------------------------------------------------------------------------
// Mirror helpers
// ---------------------------------------------------------------------------

/**
 * Return all Scene documents from the mirror, sorted by name.
 */
export function listScenes(mirror: DocumentMirror): SceneDocument[] {
  const scenes = mirror.getByType<SceneDocument>("Scene");
  return scenes.slice().sort((a, b) => a.name.localeCompare(b.name));
}

// Re-export OpError so consumers don't need a separate import.
export { OpError };
