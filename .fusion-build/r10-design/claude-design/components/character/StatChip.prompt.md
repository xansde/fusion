StatChip — a compact micro-label-over-value chip. One component covers saving throws, Percepção and attribute pills; the value is set in mono.

```jsx
<StatChip label="Fort" value="+8" />
<StatChip label="Percepção" value="+5" />
<StatChip label="DES" value="+3" minWidth={42} />
<StatChip label="CA" value="19" interactive={false} />
```

Interactive by default — hovering shows an accent border + wash to signal the stat is rollable. Set `interactive={false}` for read-only display. Use `minWidth={42}` for the tighter attribute pills.
