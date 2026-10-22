<!--
  Icon.svelte — the one way to draw an icon in the client (ui-fundacao, 22/10/2026).

  Draws a glyph of the shared set (`@fusion/shared` `iconSvg`, Lucide subset, ISC) in
  `currentColor`, so it follows the text and the theme. Decorative by default: give the
  button or link around it the accessible name; pass `label` only when the icon stands
  alone and carries meaning by itself.
-->
<script lang="ts">
  import { iconSvg, type IconName } from "@fusion/shared";

  interface Props {
    name: IconName;
    size?: number;
    label?: string;
    class?: string;
  }

  let { name, size = 20, label, class: className }: Props = $props();

  const markup = $derived(iconSvg(name, { size, label, className: ["fusion-icon", className].filter(Boolean).join(" ") }));
</script>

<!-- eslint-disable-next-line svelte/no-at-html-tags -- markup built from the static icon set, attributes escaped -->
{@html markup}

<style>
  :global(.fusion-icon) {
    display: inline-block;
    flex: none;
    vertical-align: middle;
  }
</style>
