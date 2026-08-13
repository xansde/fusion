/**
 * TokenSprite.ts — PIXI shell for a single token.
 *
 * Spec: 06-canvas-e-renderizacao.md §REQ-CNV-025..033, §DEC-CNV-07, §DEC-CNV-08
 *
 * Design:
 *   - Thin PIXI wrapper — all math delegated to token-visuals.ts.
 *   - Container hierarchy:
 *       root (Container, positioned at token x/y)
 *         ├─ artContainer (Container, centered at footprint center)
 *         │    └─ sprite  (Sprite, from Assets cache or placeholder Graphics)
 *         ├─ ringGraphics (Graphics, border by disposition)
 *         ├─ barsContainer (Container "bars", at bottom of bounding box)
 *         │    ├─ bar1Bg / bar1Fill (Graphics "bar1-bg" / "bar1-fill")
 *         │    └─ bar2Bg / bar2Fill (Graphics "bar2-bg" / "bar2-fill")
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
  Text,
  TextStyle,
  Assets,
  Sprite,
  Rectangle,
  type Texture,
} from "pixi.js";

import type { TokenDocument } from "@fusion/shared";
import { resolveAssetUrl } from "../../assets/assetApi.js";
import { fusionApi } from "../../api.js";
import { session } from "../../session.svelte.js";
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
  barYOffset,
  computeLod,
  animDuration,
  stepAnimation,
  type AnimState,
  type LodState,
} from "./token-visuals.js";
import {
  resolveTokenBarValue,
  shouldShowTokenBars,
  tokenActorFingerprint,
  tokenDisplayBars,
  type TokenBarContext,
  type TokenActorView,
} from "./token-bars.js";

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

  // Sub-containers / graphics
  private _artContainer: Container;
  private _sprite: Sprite | null = null;
  private _placeholder: Graphics | null = null;
  private _ringGraphics: Graphics;
  private _barsContainer: Container;
  /**
   * Each bar is TWO Graphics — track (background) and fill — instead of one.
   * The fill then owns its own geometry, so "how full is this bar" is a fact
   * about the scene graph rather than a private number: a test can measure the
   * painted width, and an absent bar is an object with no instructions at all.
   */
  private _bar1Bg: Graphics;
  private _bar1Fill: Graphics;
  private _bar2Bg: Graphics;
  private _bar2Fill: Graphics;
  private _nameplate: Text;
  private _elevationText: Text;

  /** Actor window used to resolve bar values and the viewer's ownership. */
  private _barContext: TokenBarContext | null;

  /** Whether the pointer is currently over this token (hover display modes). */
  private _hovered = false;

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

  constructor(
    doc: TokenDocument,
    gridSize: number,
    isGm: boolean,
    barContext: TokenBarContext | null = null,
  ) {
    this._doc = doc;
    this._gridSize = gridSize;
    this._isGm = isGm;
    this._barContext = barContext;

    this.container = new Container();
    this.container.label = `token:${doc._id}`;
    this.container.eventMode = "static"; // enables pointer events for drag/select
    // hitArea is REQUIRED, not an optimization. PIXI only hit-tests an object
    // that either owns a hitArea or implements containsPoint (Sprite, Graphics,
    // Mesh). This is a plain Container, and every visual child below is
    // eventMode "none" — so without a hitArea nothing here can ever be the
    // target of a click, no matter that eventMode says "static". The click then
    // resolved to the token LAYER (which TokenInteractionManager gives a
    // catch-all hitArea), the manager found no "token:" label walking up, and
    // treated every click on a token as a click on empty canvas. Tokens could
    // not be selected or dragged by anyone. Set here and kept in sync with the
    // footprint in _applyHitArea().

    // Art
    this._artContainer = new Container();
    this._artContainer.eventMode = "none";
    this.container.addChild(this._artContainer);

    // Ring
    this._ringGraphics = new Graphics();
    this._ringGraphics.eventMode = "none";
    this.container.addChild(this._ringGraphics);

    // Bars — track first, fill on top (addChild order IS z order).
    this._barsContainer = new Container();
    this._barsContainer.label = "bars";
    this._barsContainer.eventMode = "none";
    this.container.addChild(this._barsContainer);
    this._bar1Bg = new Graphics();
    this._bar1Bg.label = "bar1-bg";
    this._bar1Fill = new Graphics();
    this._bar1Fill.label = "bar1-fill";
    this._bar2Bg = new Graphics();
    this._bar2Bg.label = "bar2-bg";
    this._bar2Fill = new Graphics();
    this._bar2Fill.label = "bar2-fill";
    for (const g of [this._bar1Bg, this._bar1Fill, this._bar2Bg, this._bar2Fill]) {
      // Same rule as every other child: the hit test must never descend into
      // them, or the token stops being clickable (see token-sprite-hittest).
      g.eventMode = "none";
      this._barsContainer.addChild(g);
    }

    // Elevation
    this._elevationText = new Text({ text: "", style: ELEVATION_STYLE });
    this._elevationText.eventMode = "none";
    this.container.addChild(this._elevationText);

    // Nameplate
    this._nameplate = new Text({ text: doc.name, style: NAMEPLATE_STYLE });
    this._nameplate.eventMode = "none";
    this.container.addChild(this._nameplate);

    const { pixelW, pixelH } = tokenPixelSize(doc.width, doc.height, gridSize);
    this._renderX = doc.x;
    this._renderY = doc.y;

    this._applyHitArea(pixelW, pixelH);
    this._applyPosition(doc.x, doc.y);
    this._drawRing(pixelW, pixelH);
    this._drawBars(doc, pixelW, pixelH);
    this._drawNameplate(doc, pixelW, pixelH);
    this._drawElevation(doc);
    this._applyAlpha(doc);
    this._applyRotation(doc);
    this._wireHover();

    // Load art (async, non-blocking)
    void this._loadArt(doc, pixelW, pixelH);
  }

  /**
   * Track the pointer for the `hoverObserver` / `hoverAll` display modes.
   *
   * Listeners go on the ROOT container only — it is already `eventMode:
   * "static"` with an explicit hitArea, so this adds behaviour without touching
   * the hit test. Children stay `eventMode: "none"`; giving one of them events
   * would let the hit test descend and is exactly how token clicks broke once.
   */
  private _wireHover(): void {
    this.container.on("pointerover", this._onPointerOver);
    this.container.on("pointerout", this._onPointerOut);
  }

  private readonly _onPointerOver = (): void => {
    this.setHovered(true);
  };

  private readonly _onPointerOut = (): void => {
    this.setHovered(false);
  };

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
   * Mark the pointer as being over (or off) this token.
   *
   * Only the `hoverObserver` / `hoverAll` display modes care, so this repaints
   * the bars and nothing else (REQ-CNV-089).
   */
  setHovered(hovered: boolean): void {
    if (this._hovered === hovered) return;
    this._hovered = hovered;
    this.refreshBars();
  }

  /**
   * Repaint the resource bars from the CURRENT actor data.
   *
   * HP lives on the Actor, not on the TokenDocument, so no `doc:update` for the
   * token ever arrives when a character takes damage — `update()` is never
   * called and the bar would sit frozen at the value it was born with. The
   * TokenLayer calls this whenever the mirror's Actor collection changes
   * (REQ-CNV-090).
   */
  refreshBars(): void {
    const { pixelW, pixelH } = tokenPixelSize(this._doc.width, this._doc.height, this._gridSize);
    this._drawBars(this._doc, pixelW, pixelH);
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
    this._doc = newDoc;
    this._gridSize = gridSize;

    const { pixelW, pixelH } = tokenPixelSize(newDoc.width, newDoc.height, gridSize);

    // Footprint or grid size may have changed — a stale hitArea leaves the
    // token clickable at its previous size.
    this._applyHitArea(pixelW, pixelH);

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

    // Re-draw visuals if anything else changed.
    //
    // This list is a closed, silent contract: a field that is not named here
    // renders once and then never again, with no error to point at it. The bar
    // fields below (`bar1`/`bar2`/`displayBars`/`actorId`) are compared by the
    // value that actually drives the drawing — `bar1` arrives as a fresh object
    // from the mirror on every scene op, so `!==` on the object would repaint
    // the bars on every token move for nothing.
    const visualChanged =
      newDoc.width !== oldDoc.width ||
      newDoc.height !== oldDoc.height ||
      newDoc.disposition !== oldDoc.disposition ||
      newDoc.name !== oldDoc.name ||
      newDoc.elevation !== oldDoc.elevation ||
      newDoc.hidden !== oldDoc.hidden ||
      newDoc.texture !== oldDoc.texture ||
      newDoc.rotation !== oldDoc.rotation ||
      newDoc.bar1.attribute !== oldDoc.bar1.attribute ||
      newDoc.bar2.attribute !== oldDoc.bar2.attribute ||
      tokenDisplayBars(newDoc) !== tokenDisplayBars(oldDoc) ||
      newDoc.actorId !== oldDoc.actorId ||
      // REQ-CNV-092 / REQ-DOC-033: an unlinked token's hit points live in its
      // OWN document, so damage to it arrives here and nowhere else — no Actor
      // op is emitted and the Actor subscription in TokenLayer never fires.
      tokenActorFingerprint(newDoc) !== tokenActorFingerprint(oldDoc);

    if (visualChanged || xChanged) {
      this._drawRing(pixelW, pixelH);
      this._drawBars(newDoc, pixelW, pixelH);
      this._drawNameplate(newDoc, pixelW, pixelH);
      this._drawElevation(newDoc);
      this._applyAlpha(newDoc);
      this._applyRotation(newDoc);

      // Reload art if texture URL changed
      if (newDoc.texture !== oldDoc.texture) {
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
    const { pixelW, pixelH } = tokenPixelSize(this._doc.width, this._doc.height, this._gridSize);
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

  /**
   * Keep the clickable area matching the token footprint.
   *
   * Local coordinates: the container sits at the token's top-left, so the
   * footprint spans (0,0)–(pixelW,pixelH) — the same box _drawRing outlines.
   * Must be called whenever the footprint changes, or a resized token stays
   * clickable at its old size.
   */
  private _applyHitArea(pixelW: number, pixelH: number): void {
    this.container.hitArea = new Rectangle(0, 0, pixelW, pixelH);
  }

  // ---------------------------------------------------------------------------
  // Private — art loading (REQ-CNV-025, D7)
  // ---------------------------------------------------------------------------

  private async _loadArt(doc: TokenDocument, pixelW: number, pixelH: number): Promise<void> {
    // Remove existing art
    this._sprite?.destroy({ texture: false });
    this._sprite = null;
    this._placeholder?.destroy();
    this._placeholder = null;
    this._artContainer.removeChildren();

    if (doc.texture) {
      try {
        // BUG A FIX: doc.texture is a clean "/assets/<name>" path (no query
        // token — see resolveAssetUrl()'s doc comment in assetApi.ts). Mint a
        // fresh token right before loading, otherwise the server 401s.
        const accessToken = fusionApi.getToken();
        const userId = session.user?.id;
        const loadUrl =
          accessToken && userId
            ? await resolveAssetUrl(doc.texture, accessToken, userId)
            : doc.texture;
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

    // Placeholder: colored rectangle with initials (REQ-CNV-025 fallback)
    this._drawPlaceholder(doc, pixelW, pixelH);
  }

  private _drawPlaceholder(doc: TokenDocument, pixelW: number, pixelH: number): void {
    const bg = new Graphics();
    const color = placeholderColor(doc.name);
    bg.roundRect(0, 0, pixelW, pixelH, Math.min(pixelW, pixelH) * 0.15);
    bg.fill({ color, alpha: 1 });
    bg.eventMode = "none";
    this._placeholder = bg;
    this._artContainer.addChild(bg);

    // Initials label
    const initials = placeholderInitials(doc.name);
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

    const color = dispositionColor(this._doc.disposition);
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

  /**
   * Paint both resource bars from the actor the token points at.
   *
   * REQ-CNV-090: real value, fraction clamped to [0,1], and NO bar at all when
   * the path does not resolve / the token has no actor / `max <= 0`. The old
   * code drew a full bar as a placeholder in every one of those cases, which
   * reads on the table as "this monster is at full health".
   * REQ-CNV-089 / DEC-CNV-15: the whole bars container is hidden when this
   * viewer is not allowed to read them at this moment.
   */
  private _drawBars(doc: TokenDocument, pixelW: number, pixelH: number): void {
    const actor = this._barContext?.resolve(doc) ?? null;
    const allowed = shouldShowTokenBars({
      mode: tokenDisplayBars(doc),
      level: actor?.level ?? 0,
      privileged: this._barContext?.privileged ?? false,
      hovered: this._hovered,
    });

    this._drawSingleBar(
      this._bar1Bg,
      this._bar1Fill,
      doc,
      pixelW,
      pixelH,
      0,
      "bar1",
      actor,
      allowed,
    );
    this._drawSingleBar(
      this._bar2Bg,
      this._bar2Fill,
      doc,
      pixelW,
      pixelH,
      1,
      "bar2",
      actor,
      allowed,
    );
  }

  private _drawSingleBar(
    bg: Graphics,
    fill: Graphics,
    doc: TokenDocument,
    pixelW: number,
    pixelH: number,
    barIndex: 0 | 1,
    barKey: "bar1" | "bar2",
    actor: TokenActorView | null,
    allowed: boolean,
  ): void {
    bg.clear();
    fill.clear();
    if (!allowed) return;

    const reading = resolveTokenBarValue(actor?.system, doc[barKey].attribute);
    if (!reading) return; // REQ-CNV-090: absent, never a placeholder

    const y = barYOffset(barIndex, pixelH);

    // Track
    bg.rect(0, y, pixelW, BAR_HEIGHT_PX);
    bg.fill({ color: BAR_BG_COLOR, alpha: 0.7 });

    // Fill — width is the clamped fraction of the footprint
    const fillW = pixelW * reading.fraction;
    if (fillW > 0) {
      fill.rect(0, y, fillW, BAR_HEIGHT_PX - BAR_GAP_PX);
      fill.fill({ color: BAR_FILL_COLORS[barKey], alpha: 0.9 });
    }
  }

  // ---------------------------------------------------------------------------
  // Private — nameplate (REQ-CNV-030)
  // ---------------------------------------------------------------------------

  private _drawNameplate(doc: TokenDocument, pixelW: number, pixelH: number): void {
    this._nameplate.text = doc.name;
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
    const { pixelW } = tokenPixelSize(doc.width, doc.height, this._gridSize);
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
    const { pixelW, pixelH } = tokenPixelSize(doc.width, doc.height, this._gridSize);
    const { cx, cy } = tokenCenter(0, 0, pixelW, pixelH);
    // Rotation is applied to the art container around the center of the token
    this._artContainer.pivot.set(cx, cy);
    this._artContainer.position.set(cx, cy);
    this._artContainer.rotation = (doc.rotation * Math.PI) / 180;
  }
}
