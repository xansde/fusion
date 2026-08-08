/**
 * TileLayer.ts — renders the extra images a scene is composed from.
 *
 * Spec: 06-canvas-e-renderizacao.md (tiles layer, PrimaryGroup)
 *
 * A scene is rarely one picture. The same room has a before and an after, a
 * trapdoor is revealed mid-fight, the upper floor covers the lower one until
 * the party climbs down. Each of those is a tile the GM shows or hides.
 *
 * The `tiles` layer container has existed since M1-A with nothing to put in
 * it. This fills it, reconciling by id — tiles are added, moved and removed
 * one at a time, so tearing the whole layer down on every scene update would
 * re-download every texture to change one boolean.
 *
 * Players never receive hidden tiles at all (stripHiddenTiles on the server),
 * so from this layer's point of view every tile it is handed is one to draw.
 */

import { Container, Sprite, Texture, Assets } from "pixi.js";
import type { TileDocument } from "@fusion/shared";

/** Resolves a stored asset path into a URL that can actually be loaded. */
export type TextureUrlResolver = (path: string) => Promise<string>;

interface TileEntry {
  sprite: Sprite;
  /** The texture path this sprite was built from, to detect a swap. */
  texture: string | null;
}

export class TileLayer {
  private _root: Container;
  private _entries = new Map<string, TileEntry>();
  private _resolveUrl: TextureUrlResolver;
  private _destroyed = false;
  /** Generation counter: an async load that finishes after destroy is dropped. */
  private _generation = 0;

  constructor(parent: Container, resolveUrl: TextureUrlResolver) {
    this._root = new Container();
    this._root.label = "tiles";
    this._root.eventMode = "none"; // tiles are scenery, never click targets
    parent.addChild(this._root);
    this._resolveUrl = resolveUrl;
  }

  /**
   * Reconcile the drawn tiles against the scene's tile list.
   *
   * @param tiles Tiles from the scene document, in any order.
   */
  sync(tiles: readonly TileDocument[]): void {
    if (this._destroyed) return;

    const seen = new Set<string>();

    for (const tile of tiles) {
      seen.add(tile._id);
      const existing = this._entries.get(tile._id);

      if (!existing) {
        this._create(tile);
        continue;
      }

      if (existing.texture !== tile.texture) {
        // The image itself changed: rebuild rather than patch, so a failed
        // load cannot leave the old picture showing under a new name.
        existing.sprite.destroy();
        this._entries.delete(tile._id);
        this._create(tile);
        continue;
      }

      this._applyTransform(existing.sprite, tile);
    }

    for (const [id, entry] of this._entries) {
      if (seen.has(id)) continue;
      entry.sprite.destroy();
      this._entries.delete(id);
    }

    this._sortByDepth();
  }

  /** Number of tiles currently drawn — for diagnostics and tests. */
  get count(): number {
    return this._entries.size;
  }

  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._generation++;
    this._entries.clear();
    this._root.destroy({ children: true });
  }

  // -------------------------------------------------------------------------

  private _create(tile: TileDocument): void {
    // Placed immediately with an empty texture so ordering and geometry are
    // correct before the image arrives; the load only swaps the pixels in.
    const sprite = new Sprite(Texture.EMPTY);
    sprite.label = `tile:${tile._id}`;
    sprite.eventMode = "none";
    this._applyTransform(sprite, tile);
    this._root.addChild(sprite);
    this._entries.set(tile._id, { sprite, texture: tile.texture });

    if (tile.texture) void this._loadTexture(sprite, tile.texture, this._generation);
  }

  private async _loadTexture(sprite: Sprite, path: string, generation: number): Promise<void> {
    try {
      const url = await this._resolveUrl(path);
      const texture = await Assets.load<Texture>(url);
      // The layer may have been destroyed, or this tile replaced, while the
      // network was busy. Writing to a destroyed sprite throws inside PIXI.
      if (this._destroyed || generation !== this._generation || sprite.destroyed) return;
      sprite.texture = texture;
    } catch (err) {
      // Loudly, not silently: a tile that fails to load is otherwise an
      // invisible rectangle, indistinguishable from one the GM hid.
      console.error("[TileLayer] tile texture failed to load:", path, err);
    }
  }

  private _applyTransform(sprite: Sprite, tile: TileDocument): void {
    // Rotation is about the tile's center, which is what a GM rotating a rug
    // or a door means; PIXI rotates about the anchor, so move it to the middle
    // and place by center rather than by corner.
    sprite.anchor.set(0.5);
    sprite.x = tile.x + tile.width / 2;
    sprite.y = tile.y + tile.height / 2;
    sprite.width = tile.width;
    sprite.height = tile.height;
    sprite.rotation = (tile.rotation * Math.PI) / 180;
    sprite.alpha = tile.alpha;
    sprite.zIndex = tile.sort;
  }

  private _sortByDepth(): void {
    this._root.sortableChildren = true;
    this._root.sortChildren();
  }
}
