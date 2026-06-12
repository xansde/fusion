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
  /** Scene width in pixels. */
  width: number;
  /** Scene height in pixels. */
  height: number;
  /** Grid cell size in pixels (min 50). */
  gridSize: number;
  /** Optional background URL or path. */
  background: string;
}

export interface SceneFormErrors {
  name?: string;
  width?: string;
  height?: string;
  gridSize?: string;
  background?: string;
}

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
    width: 4000,
    height: 4000,
    gridSize: 100,
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
 */
export async function createScene(socket: Socket, data: SceneFormData): Promise<SceneDocument> {
  const id = createDocumentId();

  const sceneData: Record<string, unknown> = {
    _id: id,
    name: data.name.trim(),
    width: data.width,
    height: data.height,
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
 * Update basic scene config (name, dimensions, grid, background).
 * Sends a minimal diff.
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
            width: data.width,
            height: data.height,
            "grid.size": data.gridSize,
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
