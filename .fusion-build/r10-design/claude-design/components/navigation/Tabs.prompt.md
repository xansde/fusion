Tabs — the primary section switcher (Principal / Perícias / Ações / Magias / Inventário / Talentos / Bio). Active tab turns violet with a 2px accent underline.

```jsx
<Tabs
  tabs={["Principal", "Perícias", "Ações", "Magias", "Inventário", "Talentos", "Bio"]}
  defaultValue="Magias"
  onChange={setTab}
/>
```

Accepts plain strings or `{id, label}` objects. Controlled via `value`+`onChange`, or uncontrolled via `defaultValue`. For the sub-tab row inside the Magias tab (Magus/Alquimista/Foco/Rituais) use `Chip` with `active`, not this bar.
