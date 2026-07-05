SpellSlotCard — a prepared spell in a patamar row, with an accent availability pip and Lançar / Trocar buttons. Companions: `SpellSlotEmpty` (dashed "Preparar magia…") and `SpellChip` (cantrip / grimoire entry with a trailing action).

```jsx
<div style={{ display: "flex", gap: 10 }}>
  <SpellSlotCard name="Rajada de Força" available onCast={cast} onSwap={swap} />
  <SpellSlotEmpty />
</div>

<SpellChip name="Detectar Magia" actionLabel="Trocar" onAction={swap} />
<SpellChip name="Graxa" actionLabel="Preparar" onAction={prepare} />
```

Lay slot cards in a flex row per patamar. Cantrips use SpellChip in a wrapping flex; grimoire rows use SpellChip with `actionLabel="Preparar"`.
