<script lang="ts">
  /**
   * QrCode.svelte — renders a QR code as inline SVG.
   *
   * REQ-DST-029: QR code for the LAN invite URL, so players can scan it with
   * a phone camera instead of typing the address.
   *
   * Uses `qrcode-generator` (Kazuhiko Arase, MIT, zero dependencies) ONLY to
   * compute the module matrix (the black/white grid) — the actual rendering
   * is done here as plain <rect> elements, not via the library's own
   * DOM/string renderers. This keeps full control over markup (no
   * dangerouslySetInnerHTML-style raw HTML injection, so it never touches
   * the CSP's script-src/style-src concerns) and lets the SVG scale crisply
   * at any size via `viewBox`.
   */

  import QRCodeGen from "qrcode-generator";

  interface Props {
    /** Text to encode (typically a LAN invite URL). */
    value: string;
    /** Rendered size in CSS pixels (square). Default: 180. */
    size?: number;
  }

  const { value, size = 180 }: Props = $props();

  // Error correction level "M" (15% recovery) is a reasonable default for
  // URLs displayed on a screen and scanned at short range.
  const modules = $derived.by(() => {
    const qr = QRCodeGen(0, "M");
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    const cells: boolean[][] = [];
    for (let row = 0; row < count; row++) {
      const rowCells: boolean[] = [];
      for (let col = 0; col < count; col++) {
        rowCells.push(qr.isDark(row, col));
      }
      cells.push(rowCells);
    }
    return cells;
  });

  const moduleCount = $derived(modules.length);
  // Quiet zone (margin) of 2 modules on each side, per QR spec recommendation.
  const quietZone = 2;
  const viewBoxSize = $derived(moduleCount + quietZone * 2);
</script>

{#if value.length > 0}
  <svg
    class="qr-code"
    width={size}
    height={size}
    viewBox="0 0 {viewBoxSize} {viewBoxSize}"
    role="img"
    aria-label="QR code for {value}"
  >
    <rect width={viewBoxSize} height={viewBoxSize} fill="#ffffff" />
    {#each modules as row, rowIndex (rowIndex)}
      {#each row as isDark, colIndex (colIndex)}
        {#if isDark}
          <rect x={colIndex + quietZone} y={rowIndex + quietZone} width="1" height="1" fill="#000000" />
        {/if}
      {/each}
    {/each}
  </svg>
{/if}

<style>
  .qr-code {
    background: #ffffff;
    border-radius: var(--fusion-radius-sm, 4px);
    display: block;
    image-rendering: pixelated;
  }
</style>
