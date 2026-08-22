/**
 * TokenSprite.ts — PIXI shell for a single token.
 *
 * Spec: 06-canvas-e-renderizacao.md §REQ-CNV-025..033, §D7, §D8
 *
 * Design:
 *   - Thin PIXI wrapper — all math delegated to token-visuals.ts.
 *   - Container hierarchy:
 *       root (Container, positioned at token x/y)
 *         ├─ artContainer (Container, centered at footprint center)
 *         │    └─ sprite  (Sprite, from Assets cache or placeholder Graphics)
 *         ├─ ringGraphics (Graphics, border by disposition)
 *         ├─ barsContainer (Container, at bottom of bounding box)
 *         │    ├─ bar1Graphics (Graphics)
 *         │    └─ bar2Graphics (Graphics)
 *         ├─ elevationText (Text, badge at top-right when elevation ≠ 0)
 *         └─ nameplate     (Text, below the token bounding box)
 *
 *   - Texture loading uses PIXI.Assets.load() (cache hit on repeated URLs).
 *   - Placeholder is drawn synchronously as colored Graphics (never stalls frame).
 *   - On 404 / load error, falls back to placeholder seamlessly.
 *   - Animation: remote position updates interpolate via AnimState from token-visuals.
 *     Local drag moves (set via markLocalPending) skip animation on reconcile.
 *
 * REQ-CNV-037: remote updates animate; local drag does not re-animate.
 */

import {
  Container,
  Graphics,
  Rectangle,
  Text,
  TextStyle,
  Assets,
  Sprite,
  type Texture,
} from "pixi.js";

import type { TokenDocument } from "@fusion/shared";
import { resolveEffectiveActor } from "@fusion/shared";
import { resolveAssetUrl } from "../../assets/assetApi.js";
import { fusionApi } from "../../api.js";
import { session } from "../../session.svelte.js";
import type { DocumentMirror } from "../../docs/DocumentMirror.js";
import type { ActorDocument } from "../../actors/actorDirectory.js";
import { footprintOf, type TokenFootprint } from "./footprint.js";
import {
  tokenPixelSize,
  tokenCenter,
  dispositionColor,
  placeholderColor,
  placeholderInitials,
  formatElevation,
  tokenAlpha,
  BAR_HEIGHT_PX,
  BAR_GAP_PX,
  BAR_BG_COLOR,
  BAR_FILL_COLORS,
  barFraction,
  barYOffset,
  computeLod,
  animDuration,
  stepAnimation,
  type AnimState,
  type LodState,
} from "./token-visuals.js";

// ---------------------------------------------------------------------------
// Effective actor (RNF-TOK-01 — resolveEffectiveActor is the ONLY function
// that may apply a token's actorDelta; this shell only calls it and reads the
// result)
// ---------------------------------------------------------------------------

/** The slice of the effective actor TokenSprite draws from. */
interface TokenSpriteActor {
  readonly name: string;
  readonly img?: string | null;
  readonly system: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RING_THICKNESS = 3;
const NAMEPLATE_STYLE = new TextStyle({
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  fontSize: 14,
  fill: 0xffffff,
  stroke: { color: 0x000000, width: 3 },
  align: "center",
});
const ELEVATION_STYLE = new TextStyle({
  fontFamily: "ui-monospace, monospace",
  fontSize: 11,
  fill: 0xffffff,
  stroke: { color: 0x000000, width: 2 },
  align: "right",
});

// ---------------------------------------------------------------------------
// TokenSprite
// ---------------------------------------------------------------------------

export class TokenSprite {
  // Root container — placed at (token.x, token.y) in scene coords.
  readonly container: Container;

  private _doc: TokenDocument;
  private _gridSize: number;
  private _isGm: boolean;
  /**
   * The world mirror, read-only here.
   *
   * TK023 (REQ-CNV-091, RNF-TOK-01): a token carries no art/name of its own —
   * `_resolveActor` reads the base Actor from the mirror by `doc.actorId` and
   * `resolveEffectiveActor` (the ONE shared function, `@fusion/shared`) applies
   * the token's delta when unlinked. When the actor is not (yet) in the mirror
   * this resolves to `undefined` and every draw path falls back to the same
   * placeholder a missing texture used to produce.
   */
  private _mirror: DocumentMirror;
  /** The effective actor resolved from `_doc` — recomputed whenever `_doc` changes. */
  private _actor: TokenSpriteActor | undefined;
  /** This token's footprint (grid cells) — recomputed alongside `_actor`. */
  private _footprint: TokenFootprint;

  // Sub-containers / graphics
  private _artContainer: Container;
  private _sprite: Sprite | null = null;
  private _placeholder: Graphics | null = null;
  private _ringGraphics: Graphics;
  private _barsContainer: Container;
  private _bar1: Graphics;
  private _bar2: Graphics;
  private _nameplate: Text;
  private _elevationText: Text;

  // Animation
  private _anim: AnimState | null = null;
  /**
   * When true, the next position reconcile from the mirror (i.e. the server
   * ack) should NOT trigger an animation — the local drag already applied it
   * optimistically. Set by TokenLayer after a local drag, cleared after first
   * reconcile.
   */
  private _localPending = false;

  // Selection / pending visual state
  private _selected = false;
  private _pending = false;

  // LOD
  private _lastLod: LodState = { showNameplate: true, showBars: true, showBarDetail: true };

  // Current rendered position (scene pixels) — may differ from doc while animating
  private _renderX: number;
  private _renderY: number;

  constructor(doc: TokenDocument, gridSize: number, isGm: boolean, mirror: DocumentMirror) {
    this._doc = doc;
    this._gridSize = gridSize;
    this._isGm = isGm;
    this._mirror = mirror;
    this._actor = this._resolveActor(doc);
    this._footprint = footprintOf(doc, this._actor);

    this.container = new Container();
    this.container.label = `token:${doc._id}`;
    this.container.eventMode = "static"; // enables pointer events for drag/select

    // Art
    this._artContainer = new Container();
    this._artContainer.eventMode = "none";
    this.container.addChild(this._artContainer);

    // Ring
    this._ringGraphics = new Graphics();
    this._ringGraphics.eventMode = "none";
    this.container.addChild(this._ringGraphics);

    // Bars
    this._barsContainer = new Container();
    this._barsContainer.eventMode = "none";
    this.container.addChild(this._barsContainer);
    this._bar1 = new Graphics();
    this._bar2 = new Graphics();
    this._barsContainer.addChild(this._bar1);
    this._barsContainer.addChild(this._bar2);

    // Elevation
    this._elevationText = new Text({ text: "", style: ELEVATION_STYLE });
    this._elevationText.eventMode = "none";
    this.container.addChild(this._elevationText);

    // Nameplate
    this._nameplate = new Text({
      text: this._displayName(doc, this._actor),
      style: NAMEPLATE_STYLE,
    });
    this._nameplate.eventMode = "none";
    this.container.addChild(this._nameplate);

    const { pixelW, pixelH } = tokenPixelSize(
      this._footprint.width,
      this._footprint.height,
      gridSize,
    );
    this._renderX = doc.x;
    this._renderY = doc.y;

    // PIXI hit-testing (EventBoundary.hitTestFn) only accepts a Container as a
    // target when it has an explicit hitArea — a plain Container has no
    // containsPoint of its own, so `eventMode = "static"` alone never made
    // this clickable. Without this, every click on a token silently fell
    // through to the tokens-layer's always-true hitArea (used to detect
    // empty-canvas clicks), and _getTokenIdFromTarget always returned null.
    this.container.hitArea = new Rectangle(0, 0, pixelW, pixelH);

    this._applyPosition(doc.x, doc.y);
    this._drawRing(pixelW, pixelH);
    this._drawBars(doc, pixelW, pixelH);
    this._drawNameplate(doc, pixelW, pixelH);
    this._drawElevation(doc);
    this._applyAlpha(doc);
    this._applyRotation(doc);

    // Load art (async, non-blocking)
    void this._loadArt(doc, pixelW, pixelH);
  }

  // ---------------------------------------------------------------------------
  // Public API — called by TokenLayer
  // ---------------------------------------------------------------------------

  /** The token _id this sprite represents. */
  get id(): string {
    return this._doc._id;
  }

  /**
   * Mark that a local optimistic move was applied.
   * The next reconcile from the mirror will NOT trigger animation.
   * REQ-CNV-036 / D5.
   */
  markLocalPending(): void {
    this._localPending = true;
  }

  /**
   * Clear the local pending flag without applying any position change.
   * Called on rollback so the next server broadcast for this token animates
   * normally instead of being silently swallowed.
   */
  clearLocalPending(): void {
    this._localPending = false;
  }

  /**
   * Toggle the selection outline on this token.
   * REQ-CNV: selection ring — M1-C minimal implementation (bright outline).
   */
  setSelected(selected: boolean): void {
    if (this._selected === selected) return;
    this._selected = selected;
    this._applySelectionOutline();
  }

  /**
   * Toggle the pending (awaiting-ack) visual state.
   * REQ-CNV / RTT feedback: subtle desaturation while the move op is in flight.
   */
  setPending(pending: boolean): void {
    if (this._pending === pending) return;
    this._pending = pending;
    this._applyPendingVisual();
  }

  /**
   * Apply a document update from the DocumentMirror.
   * Position changes from peers animate; local-pending ones snap.
   */
  update(newDoc: TokenDocument, gridSize: number): void {
    const oldDoc = this._doc;
    const oldActor = this._actor;
    const oldFootprint = this._footprint;
    this._doc = newDoc;
    this._gridSize = gridSize;
    this._actor = this._resolveActor(newDoc);
    this._footprint = footprintOf(newDoc, this._actor);

    const { pixelW, pixelH } = tokenPixelSize(
      this._footprint.width,
      this._footprint.height,
      gridSize,
    );

    // Position
    const xChanged = newDoc.x !== oldDoc.x || newDoc.y !== oldDoc.y;
    if (xChanged) {
      if (this._localPending) {
        // Optimistic move already applied — snap silently to authoritative pos
        this._localPending = false;
        this._renderX = newDoc.x;
        this._renderY = newDoc.y;
        this._applyPosition(newDoc.x, newDoc.y);
      } else {
        // Peer update — animate from current render position to new position
        const dur = animDuration(this._renderX, this._renderY, newDoc.x, newDoc.y);
        if (dur > 0) {
          this._anim = {
            fromX: this._renderX,
            fromY: this._renderY,
            toX: newDoc.x,
            toY: newDoc.y,
            durationMs: dur,
            elapsed: 0,
          };
        } else {
          this._renderX = newDoc.x;
          this._renderY = newDoc.y;
          this._applyPosition(newDoc.x, newDoc.y);
        }
      }
    }

    // Art changes with the EFFECTIVE actor, not with the token doc alone: it
    // moves when actorId/actorLink/actorDelta change the resolution, or when
    // the base actor itself was edited elsewhere (a fresh `_resolveActor`
    // call above picks that up). This `update()` runs both on a genuine
    // token-doc change AND whenever TokenLayer's Actor subscription fires a
    // full reconcile of the active scene's tokens — see TokenLayer's
    // `_unsubscribeActor` doc comment.
    const oldName = this._displayName(oldDoc, oldActor);
    const newName = this._displayName(newDoc, this._actor);
    const artChanged = (oldActor?.img ?? null) !== (this._actor?.img ?? null);

    // Re-draw visuals if anything else changed
    const visualChanged =
      this._footprint.width !== oldFootprint.width ||
      this._footprint.height !== oldFootprint.height ||
      newDoc.disposition !== oldDoc.disposition ||
      newName !== oldName ||
      newDoc.elevation !== oldDoc.elevation ||
      newDoc.hidden !== oldDoc.hidden ||
      artChanged ||
      newDoc.rotation !== oldDoc.rotation;

    if (visualChanged || xChanged) {
      this.container.hitArea = new Rectangle(0, 0, pixelW, pixelH);
      this._drawRing(pixelW, pixelH);
      this._drawBars(newDoc, pixelW, pixelH);
      this._drawNameplate(newDoc, pixelW, pixelH);
      this._drawElevation(newDoc);
      this._applyAlpha(newDoc);
      this._applyRotation(newDoc);

      if (artChanged) {
        void this._loadArt(newDoc, pixelW, pixelH);
      }
    }
  }

  /**
   * Update LOD visibility based on current camera zoom.
   * Called by TokenLayer on every zoom change.
   */
  updateLod(zoom: number): void {
    const lod = computeLod(zoom);
    if (
      lod.showNameplate === this._lastLod.showNameplate &&
      lod.showBars === this._lastLod.showBars &&
      lod.showBarDetail === this._lastLod.showBarDetail
    ) {
      return;
    }
    this._lastLod = lod;
    this._nameplate.visible = lod.showNameplate;
    this._barsContainer.visible = lod.showBars;
  }

  /**
   * Advance animations by deltaMs.
   * Called by TokenLayer ticker.
   * Returns true if there was an active animation.
   */
  tick(deltaMs: number): boolean {
    if (!this._anim) return false;
    const result = stepAnimation(this._anim, deltaMs);
    this._renderX = result.x;
    this._renderY = result.y;
    this._applyPosition(result.x, result.y);
    if (result.done) this._anim = null;
    return true;
  }

  /**
   * Instantly teleport to a position (used for optimistic local moves).
   * Does NOT affect the animation state — a pending animation from a peer
   * would be overridden.
   */
  snapTo(x: number, y: number): void {
    this._anim = null;
    this._renderX = x;
    this._renderY = y;
    this._applyPosition(x, y);
  }

  // ---------------------------------------------------------------------------
  // Private — selection / pending visuals (REQ-CNV minimal M1-C)
  // ---------------------------------------------------------------------------

  /**
   * Draw or clear the selection outline on the ring graphics.
   * Uses a bright white inner stroke layered on top of the disposition ring.
   */
  private _applySelectionOutline(): void {
    const { pixelW, pixelH } = tokenPixelSize(
      this._footprint.width,
      this._footprint.height,
      this._gridSize,
    );
    // Re-draw the ring, adding a selection highlight on top when selected.
    this._drawRing(pixelW, pixelH);
    if (this._selected) {
      // Second pass: bright white outline, slightly inset, to create a "selected" glow.
      const inset = RING_THICKNESS + 1;
      this._ringGraphics.roundRect(
        inset,
        inset,
        pixelW - inset * 2,
        pixelH - inset * 2,
        Math.max(2, Math.min(pixelW, pixelH) * 0.08),
      );
      this._ringGraphics.stroke({ width: 2, color: 0xffffff, alpha: 0.85 });
    }
  }

  /**
   * Apply or clear the pending (awaiting-ack) desaturation filter.
   * Uses alpha reduction as a lightweight stand-in for a desaturation filter.
   *
   * FIX M1-C: compose the pending factor with the token's base alpha so that
   * the GM's HIDDEN_ALPHA (0.4) is respected during drag — a hidden token being
   * dragged shows at 0.65 × 0.4 = 0.26, not 0.65.
   */
  private _applyPendingVisual(): void {
    if (this._pending) {
      // Compute base alpha first, then apply the pending dimming factor on top.
      const base = tokenAlpha(this._doc.hidden, this._isGm, 1);
      this.container.alpha = 0.65 * base;
    } else {
      this._applyAlpha(this._doc);
    }
  }

  /**
   * Destroy the sprite and all children.
   * Safe to call after removal from the layer.
   */
  destroy(): void {
    // Release texture reference (cache remains in Assets)
    this._sprite?.destroy({ texture: false });
    this._placeholder?.destroy();
    this.container.destroy({ children: true });
  }

  // ---------------------------------------------------------------------------
  // Private — position
  // ---------------------------------------------------------------------------

  private _applyPosition(x: number, y: number): void {
    this.container.position.set(x, y);
  }

  // ---------------------------------------------------------------------------
  // Private — effective actor (RNF-TOK-01, REQ-CNV-091)
  // ---------------------------------------------------------------------------

  /**
   * Resolve `doc`'s effective actor from the mirror, through the ONE shared
   * function (`resolveEffectiveActor`, `@fusion/shared`) — never reimplemented
   * here. `undefined` when the base actor is not (yet) in the mirror; every
   * caller of `_actor` already treats that the same way a missing texture used
   * to be treated: draw the placeholder.
   */
  private _resolveActor(doc: TokenDocument): TokenSpriteActor | undefined {
    const baseActor = this._mirror.getDoc<ActorDocument>("Actor", doc.actorId);
    if (!baseActor) return undefined;
    return resolveEffectiveActor(doc, {
      name: baseActor.name,
      img: baseActor.img ?? null,
      system: baseActor.system ?? {},
    });
  }

  /**
   * The name to draw: `doc.name` when set, else the effective actor's name
   * (REQ-TOK-060 — `null` means "herda do ator"), else empty.
   *
   * WHO gets to see this name (REQ-TOK-073, redaction) is a server concern —
   * this is display-only, drawing whatever the mirror already handed the
   * client.
   */
  private _displayName(doc: TokenDocument, actor: TokenSpriteActor | undefined): string {
    return doc.name ?? actor?.name ?? "";
  }

  // ---------------------------------------------------------------------------
  // Private — art loading (REQ-CNV-025, D7, RNF-TOK-01)
  // ---------------------------------------------------------------------------

  private async _loadArt(doc: TokenDocument, pixelW: number, pixelH: number): Promise<void> {
    // Remove existing art
    this._sprite?.destroy({ texture: false });
    this._sprite = null;
    this._placeholder?.destroy();
    this._placeholder = null;
    this._artContainer.removeChildren();

    const actor = this._actor;
    const rawImg = actor?.img;
    if (actor && rawImg) {
      try {
        // BUG A FIX: rawImg is a clean "/assets/<name>" path (no query token —
        // see resolveAssetUrl()'s doc comment in assetApi.ts). Obtain a fresh
        // credential right before loading, otherwise the server 401s.
        //
        // TK023 (REQ-CNV-091): a token has no art field of its own — the docRef
        // is the ACTOR, because the art IS the actor's `img` (its effective
        // value, once TK021's delta applies). This replaces the old T025 scene
        // grant (a token no longer carries its own `texture`).
        const accessToken = fusionApi.getToken();
        const userId = session.user?.id;
        const loadUrl =
          accessToken && userId
            ? await resolveAssetUrl(rawImg, accessToken, userId, {
                table: "actors",
                id: doc.actorId,
              })
            : rawImg;
        const texture = await Assets.load<Texture>(loadUrl);
        const sprite = new Sprite(texture);
        // Position sprite centered within the footprint bounding box
        sprite.anchor.set(0.5, 0.5);
        sprite.x = pixelW / 2;
        sprite.y = pixelH / 2;
        // Art scale is independent of footprint (D7 / REQ-CNV-025)
        // The sprite fills the footprint by default (scale=1).
        // Additional art scale from future token.scale field would be applied here.
        sprite.width = pixelW;
        sprite.height = pixelH;
        sprite.eventMode = "none";

        // Apply tint if set (spec REQ-CNV-026)
        // Currently TokenDocument has no tint field, placeholder for when it arrives
        this._sprite = sprite;
        this._artContainer.addChild(sprite);
        return;
      } catch {
        // Fall through to placeholder
      }
    }

    // Placeholder: colored rectangle with initials (REQ-CNV-025 fallback —
    // also the "actor not in the mirror yet" and "actor has no img" cases).
    this._drawPlaceholder(doc, pixelW, pixelH);
  }

  private _drawPlaceholder(doc: TokenDocument, pixelW: number, pixelH: number): void {
    const name = this._displayName(doc, this._actor);
    const bg = new Graphics();
    const color = placeholderColor(name);
    bg.roundRect(0, 0, pixelW, pixelH, Math.min(pixelW, pixelH) * 0.15);
    bg.fill({ color, alpha: 1 });
    bg.eventMode = "none";
    this._placeholder = bg;
    this._artContainer.addChild(bg);

    // Initials label
    const initials = placeholderInitials(name);
    const style = new TextStyle({
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      fontSize: Math.max(12, Math.min(pixelW * 0.35, 40)),
      fontWeight: "700",
      fill: 0xffffff,
      stroke: { color: 0x00000044, width: 2 },
      align: "center",
    });
    const label = new Text({ text: initials, style });
    label.anchor.set(0.5, 0.5);
    label.x = pixelW / 2;
    label.y = pixelH / 2;
    label.eventMode = "none";
    this._artContainer.addChild(label);
  }

  // ---------------------------------------------------------------------------
  // Private — ring (REQ-CNV-027)
  // ---------------------------------------------------------------------------

  private _drawRing(pixelW: number, pixelH: number): void {
    const g = this._ringGraphics;
    g.clear();

    // TK024/REQ-TOK-080: `null` means "herda do ator" — resolving that
    // inheritance is TK042 (Fase 3), out of this task's scope. Until then a
    // null disposition falls back to neutral (0), the value the schema
    // defaulted to before TK024 made the field nullable (DEC-TOK-12: three
    // real dispositions, `secret` is not one of them) — NOT the gray
    // `SECRET_RING_COLOR`, which `dispositionColor` only reaches for a
    // genuinely out-of-range number and which TK042 removes outright.
    const color = dispositionColor(this._doc.disposition ?? 0);
    g.roundRect(
      RING_THICKNESS / 2,
      RING_THICKNESS / 2,
      pixelW - RING_THICKNESS,
      pixelH - RING_THICKNESS,
      Math.min(pixelW, pixelH) * 0.12,
    );
    g.stroke({ width: RING_THICKNESS, color, alpha: 0.95 });
  }

  // ---------------------------------------------------------------------------
  // Private — bars (REQ-CNV-028)
  // ---------------------------------------------------------------------------

  private _drawBars(doc: TokenDocument, pixelW: number, pixelH: number): void {
    this._drawSingleBar(this._bar1, doc, pixelW, pixelH, 0, "bar1");
    this._drawSingleBar(this._bar2, doc, pixelW, pixelH, 1, "bar2");
  }

  private _drawSingleBar(
    g: Graphics,
    doc: TokenDocument,
    pixelW: number,
    pixelH: number,
    barIndex: 0 | 1,
    barKey: "bar1" | "bar2",
  ): void {
    g.clear();
    const barConfig = doc[barKey];
    if (!barConfig.attribute) return; // bar disabled

    // For M1-C, bars read static value/max from token (actor integration is M3).
    // The bar config only has `attribute` (a dot-path string) — without an actor,
    // we render a full bar as a placeholder until actor data arrives.
    // Real values will come from actor in M3.
    const fraction = 1; // placeholder: full bar
    const fillColor = BAR_FILL_COLORS[barKey];
    const y = barYOffset(barIndex, pixelH);

    // Background
    g.rect(0, y, pixelW, BAR_HEIGHT_PX);
    g.fill({ color: BAR_BG_COLOR, alpha: 0.7 });

    // Fill
    const fillW = Math.max(0, pixelW * barFraction(fraction, 1));
    if (fillW > 0) {
      g.rect(0, y, fillW, BAR_HEIGHT_PX - BAR_GAP_PX);
      g.fill({ color: fillColor, alpha: 0.9 });
    }
  }

  // ---------------------------------------------------------------------------
  // Private — nameplate (REQ-CNV-030)
  // ---------------------------------------------------------------------------

  private _drawNameplate(doc: TokenDocument, pixelW: number, pixelH: number): void {
    this._nameplate.text = this._displayName(doc, this._actor);
    this._nameplate.anchor.set(0.5, 0);
    // Position below the token bounding box
    this._nameplate.x = pixelW / 2;
    this._nameplate.y = pixelH + 4;
  }

  // ---------------------------------------------------------------------------
  // Private — elevation badge (REQ-CNV-032)
  // ---------------------------------------------------------------------------

  private _drawElevation(doc: TokenDocument): void {
    const label = formatElevation(doc.elevation);
    if (!label) {
      this._elevationText.visible = false;
      return;
    }
    const { pixelW } = tokenPixelSize(
      this._footprint.width,
      this._footprint.height,
      this._gridSize,
    );
    this._elevationText.text = label;
    this._elevationText.visible = true;
    // Top-right corner of the bounding box
    this._elevationText.anchor.set(1, 0);
    this._elevationText.x = pixelW - 2;
    this._elevationText.y = 2;
  }

  // ---------------------------------------------------------------------------
  // Private — alpha / rotation
  // ---------------------------------------------------------------------------

  private _applyAlpha(doc: TokenDocument): void {
    this.container.alpha = tokenAlpha(doc.hidden, this._isGm, 1);
  }

  private _applyRotation(doc: TokenDocument): void {
    const { pixelW, pixelH } = tokenPixelSize(
      this._footprint.width,
      this._footprint.height,
      this._gridSize,
    );
    const { cx, cy } = tokenCenter(0, 0, pixelW, pixelH);
    // Rotation is applied to the art container around the center of the token
    this._artContainer.pivot.set(cx, cy);
    this._artContainer.position.set(cx, cy);
    this._artContainer.rotation = (doc.rotation * Math.PI) / 180;
  }
}
