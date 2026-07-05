LevelCard — the Pathbuilder-style per-level assembly card in the plan column. Accent-wash "Nível N" header over a body of choice Slots, with locked automatic features as padlock chips.

```jsx
<LevelCard level={1} autoFeatures={["Conjuração Arcana", "Golpe Feiticeiro"]}>
  <Slot name="Tinkering Fingers" type="Talento de Ancestralidade" onRemove={...} />
  <Slot name="Alchemist Dedication" type="Arquétipo Livre"
        badge={<OptionalBadge />} onRemove={...} />
  <EmptySlot>+ Escolher talento de classe</EmptySlot>
</LevelCard>
```

Companion exports (all from this file): `Slot` (filled choice, hover-remove ×), `EmptySlot` (dashed placeholder), `AutoChip` (🔒 locked feature), `OptionalBadge` (amber optional-rule tag). Follow the level cards with a full-width `<Button variant="primary" fullWidth>Subir de nível →</Button>`.
