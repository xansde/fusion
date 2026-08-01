SearchBox — the compendium search input; a surface-alt field with a leading 🔍 glyph that gains an accent border on focus.

```jsx
<SearchBox placeholder="Buscar no compêndio…" onChange={(e) => setQuery(e.target.value)} />
```

Forwards all standard input props. Used at the top of the spell-picker modal.
