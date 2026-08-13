/**
 * NoteLayer.ts — draws the map pins.
 *
 * Spec: 06 (REQ-CNV-057/058), 34 (REQ-MREG-005/013), 02 (REQ-DOC-056/057).
 *
 * Three states, and the client only ever draws two of them:
 *
 *   none      — never arrives. The server strips it from the payload
 *               (REQ-DOC-058), so there is nothing here to skip.
 *   limited   — a rumour: the position, and a "?" that says something is here.
 *               The name, icon and linked entry are not withheld by this
 *               renderer — they were never sent.
 *   observer+ — the whole pin: icon, label, tooltip.
 *
 * The GM is the exception: they receive every pin as authored, so this layer
 * dims the ones no player can see yet. Without that the GM cannot tell, at a
 * glance, what the table already knows — which is the one question they ask of
 * a region map constantly.
 *
 * Sizing follows DEC-MREG-04: **the world scales, the interface does not.**
 * Pin geometry is drawn in screen pixels and divided by the camera scale each
 * frame, so zooming out turns a region into a readable constellation instead
 * of a soup of blobs.
 */

import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { OwnershipLevel, getUserLevel } from "@fusion/shared";
import type { NoteDocument } from "@fusion/shared";

/**
 * Roles that see every pin as authored: GM (4) and Assistant GM (3).
 *
 * The client mirrors the server's cut rather than owning it — the server has
 * already decided what reached this socket. This only decides how to DRAW what
 * arrived, and being wrong here shows the GM a rumour marker over a pin they
 * authored, not a leak.
 */
const PRIVILEGED_ROLE_FLOOR = 3;

/** Radius of a pin's disc, in SCREEN pixels (never scene pixels). */
const PIN_RADIUS_PX = 11;
/** Distance from the pin's centre to its label baseline, in screen pixels. */
const LABEL_OFFSET_PX = 20;

const COLOR_KNOWN = 0xf2e2c4;
const COLOR_RUMOUR = 0x8d7fb8;
const COLOR_RING = 0x1b1a24;

interface NoteEntry {
  root: Container;
  disc: Graphics;
  label: Text | null;
  /** What was drawn, so a re-sync only rebuilds when the reading changed. */
  drawnAs: "known" | "rumour";
  drawnLabel: string;
  hiddenFromAll: boolean;
}

export interface NoteLayerOptions {
  /** Local user id, to resolve each pin's level. */
  userId: string;
  /** Local user's role, so a privileged viewer sees authored pins. */
  role: number;
}

export class NoteLayer {
  private _root: Container;
  private _entries = new Map<string, NoteEntry>();
  private _userId: string;
  private _role: number;
  private _destroyed = false;
  /** Camera scale as of the last frame, to keep pins at a fixed screen size. */
  private _cameraScale = 1;

  constructor(parent: Container, opts: NoteLayerOptions) {
    this._root = new Container();
    this._root.label = "notes";
    // Pins are click targets in a later slice (open the linked entry, reveal
    // menu). Until that exists they must not eat pointer events meant for the
    // canvas underneath.
    this._root.eventMode = "none";
    parent.addChild(this._root);
    this._userId = opts.userId;
    this._role = opts.role;
  }

  /** Reconcile the drawn pins against the scene's note list. */
  sync(notes: readonly NoteDocument[]): void {
    if (this._destroyed) return;

    const seen = new Set<string>();

    for (const note of notes) {
      seen.add(note._id);
      const reading = this._read(note);
      const existing = this._entries.get(note._id);

      if (!existing) {
        this._create(note, reading);
        continue;
      }

      if (
        existing.drawnAs !== reading.as ||
        existing.drawnLabel !== reading.label ||
        existing.hiddenFromAll !== reading.hiddenFromAll
      ) {
        existing.root.destroy({ children: true });
        this._entries.delete(note._id);
        this._create(note, reading);
        continue;
      }

      existing.root.x = note.x;
      existing.root.y = note.y;
    }

    for (const [id, entry] of this._entries) {
      if (seen.has(id)) continue;
      entry.root.destroy({ children: true });
      this._entries.delete(id);
    }
  }

  /**
   * Keep pins the same size on screen at any zoom (DEC-MREG-04).
   * Call once per frame with the world container's current scale.
   */
  setCameraScale(scale: number): void {
    if (this._destroyed || scale <= 0) return;
    if (Math.abs(scale - this._cameraScale) < 0.001) return;
    this._cameraScale = scale;
    const inverse = 1 / scale;
    for (const entry of this._entries.values()) {
      entry.root.scale.set(inverse);
    }
  }

  /** Number of pins currently drawn — for diagnostics and tests. */
  get count(): number {
    return this._entries.size;
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._entries.clear();
    if (!this._root.destroyed) this._root.destroy({ children: true });
  }

  // -------------------------------------------------------------------------

  /**
   * How this viewer reads this pin.
   *
   * For a player the answer is already baked into what arrived: a rumour comes
   * with `ownership: { default: LIMITED }` and every content field nulled, so
   * resolving the level reproduces the server's decision rather than second-
   * guessing it. For the GM the authored ownership map is intact, which is
   * also what tells us whether anybody else can see it yet.
   */
  private _read(note: NoteDocument): {
    as: "known" | "rumour";
    label: string;
    hiddenFromAll: boolean;
  } {
    const level =
      note.global || this._role >= PRIVILEGED_ROLE_FLOOR
        ? OwnershipLevel.OBSERVER
        : getUserLevel(note.ownership, this._userId);
    const as = level >= OwnershipLevel.OBSERVER ? "known" : "rumour";
    const label = as === "known" ? (note.text ?? "") : "";
    const hiddenFromAll = !note.global && !this._anyoneCanSee(note);
    return { as, label, hiddenFromAll };
  }

  /** Does any user at all have this pin above `none`? (GM affordance only.) */
  private _anyoneCanSee(note: NoteDocument): boolean {
    for (const [key, level] of Object.entries(note.ownership)) {
      if (key === "default") continue;
      if (level >= OwnershipLevel.LIMITED) return true;
    }
    return (note.ownership["default"] ?? OwnershipLevel.NONE) >= OwnershipLevel.LIMITED;
  }

  private _create(
    note: NoteDocument,
    reading: { as: "known" | "rumour"; label: string; hiddenFromAll: boolean },
  ): void {
    const root = new Container();
    root.label = `note:${note._id}`;
    root.x = note.x;
    root.y = note.y;
    root.scale.set(1 / this._cameraScale);
    root.eventMode = "none";

    const disc = new Graphics();
    const fill = reading.as === "known" ? COLOR_KNOWN : COLOR_RUMOUR;
    disc.circle(0, 0, PIN_RADIUS_PX).fill({ color: fill }).stroke({ color: COLOR_RING, width: 2 });
    root.addChild(disc);

    let label: Text | null = null;

    if (reading.as === "rumour") {
      // The rumour marker carries no information beyond "something is here".
      const mark = new Text({
        text: "?",
        style: new TextStyle({ fontFamily: "Signika", fontSize: 14, fill: COLOR_RING }),
      });
      mark.anchor.set(0.5);
      root.addChild(mark);
    } else if (reading.label) {
      label = new Text({
        text: reading.label,
        style: new TextStyle({
          fontFamily: "Signika",
          fontSize: 13,
          fill: 0xf2e2c4,
          stroke: { color: COLOR_RING, width: 4 },
        }),
      });
      label.anchor.set(0.5, 0);
      label.y = LABEL_OFFSET_PX;
      root.addChild(label);
    }

    // GM affordance: a pin nobody can see yet reads as a draft, not as part of
    // the map the table shares.
    root.alpha = reading.hiddenFromAll ? 0.45 : 1;

    this._root.addChild(root);
    this._entries.set(note._id, {
      root,
      disc,
      label,
      drawnAs: reading.as,
      drawnLabel: reading.label,
      hiddenFromAll: reading.hiddenFromAll,
    });
  }
}
