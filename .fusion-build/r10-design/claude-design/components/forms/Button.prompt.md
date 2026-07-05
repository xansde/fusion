Button — the primary action control; use `primary` (accent-filled) for the single main action per view, everything else `secondary`/`ghost`/`subtle`.

```jsx
<Button variant="primary" size="md">Adicionar magia</Button>
<Button variant="secondary">Cancelar</Button>
<Button variant="ghost" size="tiny">Trocar</Button>
```

Variants: `primary` (violet fill, white text), `secondary` (bordered, muted), `ghost` (bordered, full text, accent border on hover), `subtle` (surface-alt fill), `danger` (red outline). Sizes: `tiny` / `sm` / `md` / `lg`. `fullWidth` stretches it (the plan column's "Subir de nível"). The accent only appears on `primary` and on interactive hover — never decoratively.
