Pip / PipRow — the accent dots that track Pontos de Foco and Pontos de Heroísmo. Filled = available, empty = spent, locked = hatched (a slot above your current maximum).

```jsx
{/* Foco: 1 available, current max 1, but show 3 possible slots */}
<PipRow label="Pontos de Foco" filled={1} total={1} cap={3}
        lockedTitle="Além do seu máximo atual de Pontos de Foco (1)" />

<PipRow label="Pontos de Heroísmo" filled={1} cap={3} />

<Pip state="filled" />  {/* single pip, e.g. inline */}
```

`filled` counts from the left; pips at index ≥ `total` render locked. Set only `cap` (no `total`) for a plain filled/empty row like Heroísmo.
