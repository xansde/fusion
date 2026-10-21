/**
 * showPlayers.ts — "Mostrar aos jogadores": what the GM sends and what a player's screen shows.
 *
 * Spec: 04-rede-e-sincronizacao.md (ephemeral channel). The server fans the event out
 * with a per-recipient asset grant (server/src/net/show-players.ts); here the grant is
 * turned into the image URL and the event into the one popup the table shows.
 */

import type { Socket } from "socket.io-client";
import { assetNameFromPath, assetUrl } from "../assets/assetApi.js";

/** A picture and/or note being shown to the table. */
export interface ShownItem {
  /** Distinguishes two consecutive shows of the same content. */
  id: number;
  title?: string;
  text?: string;
  imageUrl?: string;
  fromName?: string;
}

let counter = 0;

/**
 * Turn the wire payload into a {@link ShownItem}, or null when it carries nothing
 * to show (a malformed event must not open an empty window).
 */
export function shownFromPayload(payload: Record<string, unknown>): ShownItem | null {
  const title = typeof payload["title"] === "string" ? payload["title"] : undefined;
  const text = typeof payload["text"] === "string" ? payload["text"] : undefined;
  const fromName = typeof payload["fromName"] === "string" ? payload["fromName"] : undefined;

  let imageUrl: string | undefined;
  const img = payload["image"];
  if (typeof img === "object" && img !== null) {
    const i = img as Record<string, unknown>;
    if (
      typeof i["name"] === "string" &&
      typeof i["token"] === "string" &&
      typeof i["exp"] === "number" &&
      typeof i["userId"] === "string"
    ) {
      imageUrl = assetUrl(i["name"], { token: i["token"], exp: i["exp"], userId: i["userId"] });
    }
  }

  if (!title && !text && !imageUrl) return null;
  return {
    id: ++counter,
    ...(title ? { title } : {}),
    ...(text ? { text } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(fromName ? { fromName } : {}),
  };
}

export interface ShowRequest {
  title?: string;
  text?: string;
  /** The value the FilePicker returned (a `/assets/<name>` path). */
  imagePath?: string;
}

/** True when there is something worth sending. */
export function canSendShow(req: ShowRequest): boolean {
  return Boolean(req.title?.trim() || req.text?.trim() || req.imagePath);
}

/** GM only (the server refuses anyone else). Returns false when nothing was sent. */
export function emitShow(socket: Socket | null, req: ShowRequest): boolean {
  if (!socket?.connected || !canSendShow(req)) return false;
  const title = req.title?.trim();
  const text = req.text?.trim();
  const image = req.imagePath ? assetNameFromPath(req.imagePath) : undefined;
  socket.emit("ephemeral", {
    type: "presence:show",
    ts: Date.now(),
    payload: {
      ...(title ? { title } : {}),
      ...(text ? { text } : {}),
      ...(image ? { image } : {}),
    },
  });
  return true;
}
