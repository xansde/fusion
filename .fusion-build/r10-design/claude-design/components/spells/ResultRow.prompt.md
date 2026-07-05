ResultRow — one line in the compendium results list inside the picker Modal. Rank square, action-cost circle, name with trait chips, and source book at the right. The selected row gets an accent wash + border.

```jsx
<ResultRow rank={1} actionCost="2A" name="Rajada de Força"
           traits={["Evocation", "Force"]} source="Player Core" selected />
<ResultRow rank={0} actionCost="1A" name="Detectar Magia"
           traits={["Conjuration"]} source="Player Core" onClick={select} />
```

Stack rows inside a bordered scroll container. Only mechanical ORC data is shown — no prose (clean-room).
