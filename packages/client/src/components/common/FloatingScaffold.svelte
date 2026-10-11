<!--
  SCAFFOLDING (BAR-F1-03) — a worked example of Tooltip, Popover and ContextMenu together,
  standing in for the action bar until BAR-F1-04 mounts the real one. Nothing imports it.
  Delete it when the bar uses the three; until then it is how to see them on screen and the
  quickest way to learn how they are wired.

  It mimics what the bar will do with them (docs/design/barra-de-acoes, screens T1, T3, T4):
    - hover or focus a slot      → Tooltip, short; hold Alt → the expanded level
    - right-click a slot         → ContextMenu at the pointer (Shift+F10 or the menu key: at the
                                   slot, with the first item active)
    - click the "Chuva de Força" → Popover with the cost choices
  The text is placeholder wording for the example, not game content.
-->
<script lang="ts">
  import Tooltip from "./Tooltip.svelte";
  import Popover from "./Popover.svelte";
  import ContextMenu from "./ContextMenu.svelte";
  import type { MenuEntry } from "../../lib/ui/menu.js";

  interface ScaffoldSlot {
    id: string;
    name: string;
    cost: string;
    summary: string;
    unavailable?: string;
    variable?: boolean;
  }

  const SLOTS: ScaffoldSlot[] = [
    { id: "strike", name: "Golpe de Espada", cost: "◆", summary: "Corpo a corpo · +12 · 1d8+4" },
    { id: "bolt", name: "Rajada Elétrica", cost: "◆◆", summary: "Truque · CD 18 · alcance 18 m" },
    { id: "rain", name: "Chuva de Força", cost: "◆ a ◆◆◆", summary: "Magia · escolha o custo", variable: true },
    {
      id: "command",
      name: "Comandar um Animal",
      cost: "◆",
      summary: "Ação · Perícia",
      unavailable: "Já comandou neste turno",
    },
  ];

  let slotEls = $state<Array<HTMLButtonElement | null>>(SLOTS.map(() => null));
  let altHeld = $state(false);

  let menuOpen = $state(false);
  let menuSlot = $state(0);
  let menuPoint = $state<{ x: number; y: number } | null>(null);
  let menuVia = $state<"pointer" | "keyboard">("pointer");

  let popoverOpen = $state(false);
  let lastChoice = $state("nenhuma ainda");

  const menuItems = $derived<MenuEntry[]>([
    {
      kind: "group",
      label: "Variantes",
      items: [
        { id: "map:0", label: "1º ataque", detail: "+12" },
        { id: "map:1", label: "2º ataque", detail: "+7 (MAP −5)", hint: "depois deste: MAP −10" },
        { id: "map:2", label: "3º ataque", detail: "+2 (MAP −10)", disabled: true, reason: "Faça o 2º ataque antes" },
      ],
    },
    { kind: "separator" },
    { id: "pin", label: "Fixar nos favoritos" },
    { id: "details", label: "Ver detalhes", detail: "Alt" },
    { id: "sheet", label: "Abrir na ficha" },
  ]);

  function openMenuAt(index: number, event: MouseEvent): void {
    event.preventDefault();
    menuSlot = index;
    menuPoint = { x: event.clientX, y: event.clientY };
    menuVia = "pointer";
    menuOpen = true;
  }

  function onSlotKeydown(index: number, event: KeyboardEvent): void {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      menuSlot = index;
      menuPoint = null;
      menuVia = "keyboard";
      menuOpen = true;
    }
  }

  function onSlotClick(slot: ScaffoldSlot): void {
    if (slot.variable) popoverOpen = !popoverOpen;
    else lastChoice = `${slot.name} (clique)`;
  }

  const COSTS = [
    { glyph: "◆", name: "1 ação", effect: "Um dardo, 1d4+1" },
    { glyph: "◆◆", name: "2 ações", effect: "Dois dardos" },
    { glyph: "◆◆◆", name: "3 ações", effect: "Três dardos" },
  ];
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === "Alt") altHeld = true;
  }}
  onkeyup={(event) => {
    if (event.key === "Alt") altHeld = false;
  }}
  onblur={() => (altHeld = false)}
/>

<section class="scaffold" data-scaffolding="BAR-F1-03" aria-label="SCAFFOLDING: tooltip, popover e menu">
  <p class="scaffold__note">
    SCAFFOLDING · passe o mouse ou use Tab nos slots · Alt expande · botão direito ou Shift+F10
    abre o menu · "Chuva de Força" abre o popover
  </p>

  <div class="scaffold__bar" role="toolbar" aria-label="Slots de exemplo">
    {#each SLOTS as slot, i (slot.id)}
      <button
        bind:this={slotEls[i]}
        type="button"
        class="scaffold__slot"
        class:is-off={slot.unavailable !== undefined}
        onclick={() => onSlotClick(slot)}
        oncontextmenu={(event) => openMenuAt(i, event)}
        onkeydown={(event) => onSlotKeydown(i, event)}
      >
        <span class="scaffold__cost">{slot.cost}</span>
        <span class="scaffold__name">{slot.name}</span>
      </button>

      <Tooltip anchor={slotEls[i] ?? null} expanded={altHeld} placement="top">
        {#snippet content()}
          <div class="tip__head"><b>{slot.name}</b><span>{slot.cost}</span></div>
          <div class="tip__sub">{slot.summary}</div>
          {#if slot.unavailable !== undefined}
            <div class="tip__why"><b>Indisponível:</b> {slot.unavailable}</div>
          {/if}
          <div class="tip__foot">Alt: detalhes · Botão direito: opções</div>
        {/snippet}
        {#snippet expandedContent()}
          <div class="tip__head"><b>{slot.name}</b><span>{slot.cost}</span></div>
          <p class="tip__body">
            Painel completo do sistema para “{slot.name}” — o mesmo da ficha. É o nível
            expandido do tooltip: a casca só decide quando mostrá-lo (aqui, com Alt).
          </p>
        {/snippet}
      </Tooltip>
    {/each}
  </div>

  <p class="scaffold__status" aria-live="polite">Última escolha: {lastChoice}</p>

  <ContextMenu
    bind:open={menuOpen}
    items={menuItems}
    label={SLOTS[menuSlot]?.name ?? ""}
    showLabel
    point={menuPoint}
    anchor={slotEls[menuSlot] ?? null}
    openedBy={menuVia}
    onselect={(id) => (lastChoice = `${SLOTS[menuSlot]?.name ?? ""} → ${id}`)}
  />

  <Popover
    bind:open={popoverOpen}
    anchor={slotEls[2] ?? null}
    label="Chuva de Força: escolha o custo"
    placement="top"
  >
    <div class="pop__head">Chuva de Força · escolha o custo</div>
    {#each COSTS as cost (cost.name)}
      <button
        type="button"
        class="pop__option"
        onclick={() => {
          lastChoice = `Chuva de Força, ${cost.name}`;
          popoverOpen = false;
        }}
      >
        <span>{cost.glyph}</span>
        <span>{cost.name}<small>{cost.effect}</small></span>
      </button>
    {/each}
  </Popover>
</section>

<style>
  .scaffold {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    color: var(--fusion-text);
    font-family: var(--fusion-font);
  }

  .scaffold__note {
    max-width: 520px;
    margin: 0;
    color: var(--fusion-warning);
    font-size: 11px;
    text-align: center;
  }

  .scaffold__bar {
    display: flex;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius);
    background: rgba(24, 24, 31, 0.94);
  }

  .scaffold__slot {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    width: 76px;
    height: 64px;
    padding: 4px;
    border: 1px solid var(--fusion-border);
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-surface);
    color: var(--fusion-text);
    font: inherit;
    cursor: pointer;
  }

  .scaffold__slot:hover,
  .scaffold__slot:focus-visible {
    border-color: var(--fusion-accent);
  }

  .scaffold__slot:focus-visible {
    outline: 2px solid var(--fusion-accent-hover);
    outline-offset: 1px;
  }

  /* Dimmed as a signal, not a lock: it still clicks. */
  .scaffold__slot.is-off {
    opacity: 0.45;
  }

  .scaffold__cost {
    color: var(--fusion-accent-hover);
    font-size: 11px;
  }

  .scaffold__name {
    font-size: 10px;
    line-height: 1.15;
    text-align: center;
  }

  .scaffold__status {
    margin: 0;
    color: var(--fusion-text-muted);
    font-size: 11px;
  }

  /* --- Tooltip content (styled here, because the content is this component's) --- */
  .tip__head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }

  .tip__head b {
    font-size: 12.5px;
  }

  .tip__sub {
    margin-top: 1px;
    color: var(--fusion-text-muted);
  }

  .tip__why {
    margin-top: 6px;
    padding: 4px 6px;
    border-radius: var(--fusion-radius-sm);
    background: var(--fusion-warning-dim);
    color: var(--fusion-warning);
  }

  .tip__foot {
    margin-top: 6px;
    padding-top: 5px;
    border-top: 1px solid var(--fusion-border);
    color: var(--fusion-text-muted);
    font-size: 10.5px;
  }

  .tip__body {
    margin: 6px 0 0;
    color: var(--fusion-text-muted);
  }

  /* --- Popover content --- */
  .pop__head {
    padding: 4px 8px 5px;
    color: var(--fusion-text-muted);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .pop__option {
    display: grid;
    grid-template-columns: 44px 1fr;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: 260px;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--fusion-radius-sm);
    background: transparent;
    color: var(--fusion-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .pop__option:hover,
  .pop__option:focus-visible {
    background: var(--fusion-accent-dim);
  }

  .pop__option:focus-visible {
    outline: 2px solid var(--fusion-accent-hover);
    outline-offset: -2px;
  }

  .pop__option small {
    display: block;
    color: var(--fusion-text-muted);
    font-size: 10.5px;
  }
</style>
