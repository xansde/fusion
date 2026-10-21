/**
 * actionBarServices.ts — what the core lends a provider so it can run an entry through the SAME
 * paths as the sheet (BAR-F1-04; spec 53 §7.1, REQ-BAR-016, RNF-BAR-01; tasks.md §2.3).
 *
 * A provider is pure: no DOM, no socket kept. Everything it needs to act on the world comes in
 * through `ActionBarServices`, and everything it can do goes through the world's own doors — the
 * flat-op sender of the sheet (`makeSendOpFn`: it fills `expectedVersion`, serialises writes to one
 * document and retries a stale one), the envelope call that answers (`sendOp` of `lib/docs`), and
 * the sheet opener. The bar adds NO authority: the server validates every roll, spend and
 * permission, and a refusal comes back as an error the bar shows (RNF-BAR-01).
 *
 * Two layers, so each is testable on its own (§2.10):
 *  - {@link createActionBarServices}: the behaviour, with every effect handed in;
 *  - {@link createLiveActionBarServices}: the same, wired to the real modules — the only function
 *    here that imports them.
 *
 * Aim mode (`requestTargets`) does not exist yet (BAR-F8-02 is outside this delivery, D-BA16), so
 * the member is ABSENT rather than a stub that resolves `null`.
 */

import type { Socket } from "socket.io-client";
import { getUserLevel, OwnershipLevel, type Ownership } from "@fusion/shared";

import { worldMirror } from "../docs/worldSync.js";
import { makeSendOpFn, sendOp as sendEnvelope } from "../docs/sendOp.js";
import { openActorSheet as openSheetWindow } from "../sheets/openActorSheet.js";
import { t } from "../i18n/i18n.js";
import type { ActionBarServices } from "./types.js";

/** What `openActorSheet` takes as its window context. */
export interface SheetOpenOptions {
  userId: string;
  ownership: number;
  isGm: boolean;
  worldId: string;
  socket?: Socket;
  sendOpFn: (op: unknown) => void;
}

/** Every effect `createActionBarServices` needs, handed in. */
export interface ServicesDeps {
  /** The live socket, asked for on every use. */
  getSocket(): Socket | null;
  worldId: string;
  userId: string;
  /** The privileged seat (`ctx.viewer.isGm`). */
  isGm: boolean;
  /** Shows a short message on the bar's strip. */
  notify(message: string): void;
  /** The sheet's flat-op sender. */
  sendOp(op: unknown): void;
  /** An envelope with an answer; rejects with the server's refusal. */
  envelope<R>(socket: Socket, type: string, payload: Record<string, unknown>): Promise<R>;
  /** The actor document in the mirror. */
  actorDoc(actorId: string): Record<string, unknown> | undefined;
  /** Opens a sheet window. */
  openSheet(actorId: string, doc: Record<string, unknown>, opts: SheetOpenOptions): void;
}

export function createActionBarServices(deps: ServicesDeps): ActionBarServices {
  return {
    getSocket: () => deps.getSocket(),
    worldId: deps.worldId,
    userId: deps.userId,
    isGm: deps.isGm,
    sendOp: (op) => {
      deps.sendOp(op);
    },
    request<R = unknown>(type: string, payload: Record<string, unknown>): Promise<R> {
      const socket = deps.getSocket();
      if (socket === null)
        return Promise.reject(new Error(t("FUSION.ActionBar.Error.NoConnection")));
      return deps.envelope<R>(socket, type, payload);
    },
    openActorSheet(actorId) {
      const doc = deps.actorDoc(actorId);
      if (doc === undefined) return;
      const ownership = deps.isGm
        ? OwnershipLevel.OWNER
        : getUserLevel((doc["ownership"] ?? {}) as Ownership, deps.userId);
      const socket = deps.getSocket();
      deps.openSheet(actorId, doc, {
        userId: deps.userId,
        ownership,
        isGm: deps.isGm,
        worldId: deps.worldId,
        ...(socket === null ? {} : { socket }),
        sendOpFn: (op) => {
          deps.sendOp(op);
        },
      });
    },
    notify: (message) => {
      deps.notify(message);
    },
  };
}

/** The services wired to the real modules. */
export function createLiveActionBarServices(input: {
  getSocket(): Socket | null;
  worldId: string;
  userId: string;
  isGm: boolean;
  notify(message: string): void;
}): ActionBarServices {
  return createActionBarServices({
    ...input,
    // Lazy socket: a captured one goes stale across a reconnect (the bug `makeSendOpFn` documents).
    sendOp: makeSendOpFn(() => input.getSocket()),
    envelope: <R>(socket: Socket, type: string, payload: Record<string, unknown>) =>
      sendEnvelope<R>(socket, { type, payload } as Parameters<typeof sendEnvelope>[1]),
    actorDoc: (actorId) => worldMirror.getDoc<Record<string, unknown>>("Actor", actorId),
    openSheet: openSheetWindow,
  });
}
