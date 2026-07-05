Panel — the surface-alt card that wraps every sheet section. Optional title on the left, optional actions on the right.

```jsx
<Panel title="Perícias">…rows…</Panel>

<Panel title="Grimório" actions={<Button variant="primary" size="sm">+ Adicionar magia</Button>}>
  …list…
</Panel>
```

It's a plain bordered container — no shadow. Nest StatChips, SkillRows, SpellSlotCards etc. inside.
