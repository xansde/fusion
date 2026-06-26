/**
 * compendiumApi.ts — typed socket calls for the compendium browser.
 *
 * REQ-CMP-010..018
 * Spec: 16-compendiums-e-importacao.md §API e eventos
 *
 * All calls use the "query" socket event (read-only) except import which uses "op".
 * Returns typed results from the server handlers.
 */

import type { Socket } from "socket.io-client";
import type {
  PackManifest,
  PackIndexEntry,
  CompendiumSearchPayload,
  CompendiumImportResult,
} from "@fusion/shared";
import { sendOp } from "../docs/sendOp.js";

// ---------------------------------------------------------------------------
// sendQuery helper (mirrors sendOp but uses "query" event)
// ---------------------------------------------------------------------------

function sendQuery<R = unknown>(
  socket: Socket,
  type: string,
  payload: unknown,
  timeoutMs = 10_000,
): Promise<R> {
  return new Promise<R>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Query "${type}" timed out`));
    }, timeoutMs);

    socket.emit(
      "query",
      { type, payload, ts: Date.now() },
      (ack: { ok: boolean; result?: R; code?: string; message?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);

        if (ack.ok && ack.result !== undefined) {
          resolve(ack.result);
        } else {
          reject(new Error(ack.message ?? `Query "${type}" failed: ${ack.code ?? "UNKNOWN"}`));
        }
      },
    );
  });
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

export interface ListPacksResult {
  packs: PackManifest[];
}

/**
 * List all available compendium packs.
 * REQ-CMP-012.
 */
export function listPacks(
  socket: Socket,
  filter?: { systemId?: string; documentType?: string },
): Promise<ListPacksResult> {
  return sendQuery<ListPacksResult>(socket, "compendium:list", filter ?? {});
}

export interface PackIndexResult {
  packId: string;
  entries: PackIndexEntry[];
}

/**
 * Get the full index for a pack (lazy, first call builds it on server).
 * REQ-CMP-007.
 */
export function getPackIndex(socket: Socket, packId: string): Promise<PackIndexResult> {
  return sendQuery<PackIndexResult>(socket, "compendium:index", { packId });
}

export interface SearchPackResult {
  packId: string;
  entries: PackIndexEntry[];
}

/**
 * Search/filter a pack's index (text + field filters).
 * REQ-CMP-013, REQ-CMP-014.
 */
export function searchPack(
  socket: Socket,
  query: CompendiumSearchPayload,
): Promise<SearchPackResult> {
  return sendQuery<SearchPackResult>(socket, "compendium:search", query);
}

export interface GetDocumentResult {
  document: Record<string, unknown>;
}

/**
 * Load the full document for a Compendium UUID.
 * REQ-CMP-009, REQ-CMP-015 (preview).
 */
export function getDocument(socket: Socket, uuid: string): Promise<GetDocumentResult> {
  return sendQuery<GetDocumentResult>(socket, "compendium:get", { uuid });
}

/**
 * Import one or more pack documents into the world.
 * GM-only — uses "op" event (mutation).
 * REQ-CMP-016, REQ-CMP-021.
 */
export function importToWorld(
  socket: Socket,
  uuids: string[],
  options?: { folderId?: string },
): Promise<CompendiumImportResult> {
  return sendOp<CompendiumImportResult>(socket, {
    type: "compendium:import",
    payload: { uuids, folderId: options?.folderId },
  });
}
