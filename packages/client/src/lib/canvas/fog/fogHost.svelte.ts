/**
 * fogHost.svelte.ts — owns everything manual-fog on one canvas: the layer that
 * draws it, the tool controller that edits it, and the optimistic copy kept
 * between "the GM released the mouse" and "the server echoed the scene".
 *
 * TableScreen only creates it, feeds it the scene (`syncScene`) and hands its
 * `current()` / `commit()` to the toolbar. Shape → fog maths is in @fusion/shared
 * (`appendFogOp`), so the budget the server enforces is the one checked here too.
 */

import type { Socket } from "socket.io-client";
import { appendFogOp, defaultManualFog, type FogOp, type ManualFog } from "@fusion/shared";
import type { SceneDocument } from "@fusion/shared";
import type { FusionCanvas } from "../FusionCanvas.js";
import { effectiveGridSize } from "../sceneCoords.js";
import { sendOp } from "../../docs/sendOp.js";
import { t } from "../../i18n/i18n.js";
import { ManualFogLayer } from "./ManualFogLayer.js";
import { FogToolController } from "./FogToolController.js";
import { fogToolState } from "./fogToolState.svelte.js";

interface Override {
  readonly sceneId: string;
  readonly fog: ManualFog;
}

export class ManualFogHost {
  private readonly _layer: ManualFogLayer;
  private readonly _controller: FogToolController;
  private readonly _getSocket: () => Socket | null;
  private _scene = $state.raw<SceneDocument | null>(null);
  private _override = $state<Override | null>(null);
  private _privileged = false;

  constructor(opts: {
    canvas: FusionCanvas;
    container: HTMLElement;
    getSocket: () => Socket | null;
  }) {
    this._getSocket = opts.getSocket;
    this._layer = new ManualFogLayer(opts.canvas.getLayer("fog"));
    this._controller = new FogToolController({
      container: opts.container,
      canvas: opts.canvas,
      previewLayer: opts.canvas.getLayer("controls"),
      getOptions: () => ({
        tool: this._privileged ? fogToolState.tool : "none",
        mode: fogToolState.mode,
        radius: fogToolState.radius,
        snap: fogToolState.snap,
      }),
      getGridSize: () => effectiveGridSize(this._scene),
      onCommit: (op) => {
        this._commitOp(op);
      },
    });
  }

  /** The fog the toolbar should show: the optimistic copy while a save is in flight. */
  current(): ManualFog {
    const ov = this._override;
    if (ov && ov.sceneId === this._scene?._id) return ov.fog;
    return this._scene?.manualFog ?? defaultManualFog();
  }

  /** Feed the latest scene document (call on every scene mutation; it is cheap). */
  syncScene(scene: SceneDocument | null, privileged: boolean): void {
    this._scene = scene;
    this._privileged = privileged;
    const ov = this._override;
    if (ov && (ov.sceneId !== scene?._id || JSON.stringify(scene?.manualFog) === JSON.stringify(ov.fog))) {
      // Echoed (or the scene changed): the document is authoritative again.
      this._override = null;
    }
    this._layer.sync(scene, privileged, this._override?.fog ?? null);
    if (!privileged || scene?.manualFog?.enabled !== true) fogToolState.tool = "none";
    this._controller.refresh();
  }

  /** Re-read the tool options (tool/mode/radius changed in the toolbar). */
  refreshTool(): void {
    this._controller.refresh();
  }

  /** Save a whole new fog for the current scene. */
  async commit(next: ManualFog): Promise<void> {
    const scene = this._scene;
    const sock = this._getSocket();
    if (!scene || !sock) return;
    this._override = { sceneId: scene._id, fog: next };
    this._layer.sync(scene, true, next);
    try {
      await sendOp(sock, {
        type: "doc:update",
        payload: { documentType: "Scene", updates: [{ _id: scene._id, diff: { manualFog: next } }] },
      });
    } catch {
      this._override = null;
      fogToolState.notice = t("FUSION.Fog.SaveFailed");
      this._layer.sync(this._scene, true, null);
    }
  }

  private _commitOp(op: FogOp): void {
    fogToolState.notice = null;
    const res = appendFogOp(this.current(), op);
    if (!res.ok) {
      fogToolState.notice = t("FUSION.Fog.TooComplex");
      return;
    }
    void this.commit(res.fog);
  }

  destroy(): void {
    this._controller.destroy();
    this._layer.destroy();
  }
}
