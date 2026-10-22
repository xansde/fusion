<!--
  CostGlyphs.svelte — the action cost drawn as Fusion's own marks (ui-mesa-hud, 22/10/2026).

  The cost formatter (`formatActionCost`) speaks in characters — ◆ ◇ ⟳ — and a font draws them
  differently on every system (and the PF2e font is Paizo's, which we never ship). Here each mark
  is a small SVG of our own: a filled diamond per action, an outlined one for a free action, the
  set's "rotate" arrow for a reaction. Anything else in the string (the "a"/"–" of a range, the
  words of a time) stays text. Decorative: the slot's and the tooltip's text carry the cost.
-->
<script lang="ts">
  import Icon from "../common/Icon.svelte";

  interface Props {
    glyphs: string;
    /** Height of a mark in px. */
    size?: number;
  }

  const { glyphs, size = 12 }: Props = $props();

  type Part = { kind: "action" | "free" | "reaction" } | { kind: "text"; text: string };

  const parts = $derived.by((): Part[] => {
    const out: Part[] = [];
    for (const ch of glyphs) {
      if (ch === "◆") out.push({ kind: "action" });
      else if (ch === "◇") out.push({ kind: "free" });
      else if (ch === "⟳" || ch === "↺") out.push({ kind: "reaction" });
      else {
        const last = out.at(-1);
        if (last !== undefined && last.kind === "text") last.text += ch;
        else out.push({ kind: "text", text: ch });
      }
    }
    return out;
  });
</script>

<span class="cost" aria-hidden="true" style:--cost-size="{size}px"
  >{#each parts as part, index (index)}{#if part.kind === "text"}<span class="cost__t">{part.text}</span
      >{:else if part.kind === "reaction"}<Icon name="rotate-ccw" size={size + 2} />{:else}<svg
        class="cost__d"
        viewBox="0 0 12 12"
        focusable="false"
        ><path
          d="M6 1 11 6 6 11 1 6z"
          fill={part.kind === "action" ? "currentColor" : "none"}
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
        /></svg
      >{/if}{/each}</span
>

<style>
  .cost {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    line-height: 1;
    white-space: nowrap;
  }

  .cost__d {
    display: block;
    width: var(--cost-size);
    height: var(--cost-size);
  }

  .cost__t {
    padding: 0 2px;
  }
</style>
