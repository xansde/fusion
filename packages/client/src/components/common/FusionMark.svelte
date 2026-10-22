<!--
  FusionMark.svelte — the Fusion mark (ui-fundacao, 22/10/2026).

  An original drawing for Fusion: the silhouette of a twenty-sided die (hexagon, inner
  triangle, three edges), stroked like the rest of the icon set so it sits beside them.
  The same drawing is the favicon (`public/favicon.svg`). Decorative: the world or app name
  next to it is the text.
-->
<script lang="ts">
  interface Props {
    size?: number;
  }

  let { size = 22 }: Props = $props();
</script>

<svg
  class="fusion-mark"
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width="1.75"
  stroke-linecap="round"
  stroke-linejoin="round"
  focusable="false"
  aria-hidden="true"
>
  <path d="M12 2.5 20.5 7.25v9.5L12 21.5 3.5 16.75v-9.5z" />
  <path d="M12 7.5 16.5 15h-9z" />
  <path d="M12 2.5v5M20.5 16.75 16.5 15M3.5 16.75 7.5 15" />
</svg>

<style>
  .fusion-mark {
    display: inline-block;
    flex: none;
    color: var(--fusion-accent);
    vertical-align: middle;
  }
</style>
