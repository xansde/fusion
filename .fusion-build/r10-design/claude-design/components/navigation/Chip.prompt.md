Chip — a rounded pill. Two jobs: spell-origin sub-tabs (Magus/Alquimista/Foco/Rituais) and compendium filters (rank numbers, traits).

```jsx
<Chip active>Magus</Chip>
<Chip onClick={...}>Alquimista</Chip>
<Chip fixed>Tradição: Arcana</Chip>   {/* dashed, non-interactive context */}
```

`active` = accent wash + border + text. `fixed` = dashed border, muted, non-clickable (a locked context filter). Default hover brightens text and shows an accent border.
