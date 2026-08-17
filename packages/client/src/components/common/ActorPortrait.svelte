<script lang="ts">
  /**
   * ActorPortrait.svelte — a circular actor portrait with an elegant initials
   * fallback (r19-W4).
   *
   * Shows `img` (resolved through resolveAssetUrl, minting a short-lived asset
   * query-token — the r5 pattern, since our /assets/* route needs one and an
   * <img> can't send an Authorization header). When there is no usable image
   * — absent, a proprietary/compendium placeholder stub, or a load error —
   * it paints a colored circle with the actor's initials instead of a broken
   * image. Color is derived deterministically from the name.
   *
   * Display-only: it never writes. The character-sheet header wraps it with the
   * FilePicker/upload edit affordance; everywhere else it is read-only.
   *
   * Props:
   *   img    — raw stored img path/URL from the actor document (may be null).
   *   docRef — WHICH document `img` was read out of (T025). Required and with no
   *            default: the server signs an asset grant per document, so a
   *            caller that cannot name the actor it is drawing cannot be given
   *            one. Every portrait in the app draws an Actor row, hence
   *            `{ table: "actors", id: <actor._id> }`.
   *   name   — display name (drives initials + fallback color).
   *   size   — diameter in px (default 48).
   *   label  — accessible label; when omitted the portrait is decorative
   *            (aria-hidden), for lists where the name is shown alongside.
   */

  import { resolveAssetUrl } from "$lib/assets/assetApi.js";
  import type { AssetDocRef } from "$lib/assets/assetGrants.svelte.js";
  import { fusionApi } from "$lib/api.js";
  import { session } from "$lib/session.svelte.js";
  import { portraitInitials, portraitColor, isPortraitPlaceholder } from "$lib/common/portrait.js";

  interface Props {
    img?: string | null | undefined;
    docRef: AssetDocRef;
    name?: string | null | undefined;
    size?: number;
    label?: string;
  }

  let { img = null, docRef, name = null, size = 48, label = "" }: Props = $props();

  // A fetchable URL for a REAL stored image; null → render the initials
  // fallback (also the state while an async resolve is still in flight, so the
  // fallback doubles as a skeleton and there is never a broken-image flash).
  let resolvedSrc = $state<string | null>(null);
  let loadFailed = $state(false);

  $effect(() => {
    loadFailed = false;
    resolvedSrc = null;
    const raw = img;
    if (isPortraitPlaceholder(raw)) return;
    const token = fusionApi.getToken();
    const uid = session.user?.id;
    if (!token || !uid) {
      // Can't mint a query-token (no session) → fall back gracefully.
      loadFailed = true;
      return;
    }
    let cancelled = false;
    void resolveAssetUrl(raw as string, token, uid, docRef)
      .then((url) => {
        if (!cancelled) resolvedSrc = url;
      })
      .catch(() => {
        if (!cancelled) loadFailed = true;
      });
    return () => {
      cancelled = true;
    };
  });

  const showImage = $derived(!isPortraitPlaceholder(img) && !loadFailed && resolvedSrc !== null);
  const initials = $derived(portraitInitials(name));
  const bg = $derived(portraitColor(name));
  const fontSize = $derived(Math.max(9, Math.round(size * 0.42)));
</script>

{#if showImage}
  <img
    class="actor-portrait actor-portrait--img"
    src={resolvedSrc}
    alt={label}
    aria-hidden={label ? undefined : "true"}
    style="width:{size}px;height:{size}px;"
    onerror={() => { loadFailed = true; }}
  />
{:else}
  <span
    class="actor-portrait actor-portrait--fallback"
    style="width:{size}px;height:{size}px;background:{bg};font-size:{fontSize}px;"
    role={label ? "img" : undefined}
    aria-label={label || undefined}
    aria-hidden={label ? undefined : "true"}
  >{initials}</span>
{/if}

<style>
  .actor-portrait {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    flex-shrink: 0;
    overflow: hidden;
    vertical-align: middle;
  }

  .actor-portrait--img {
    object-fit: cover;
    border: 1px solid var(--fusion-border);
    background: var(--fusion-surface-alt);
  }

  .actor-portrait--fallback {
    color: #fff;
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    font-family: var(--fusion-font);
    user-select: none;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.12);
  }
</style>
