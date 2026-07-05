ModeToggle — a small segmented switch; the sheet uses it for the Jogar/Editar mode toggle in the title bar.

```jsx
<ModeToggle options={["Jogar", "Editar"]} defaultValue="Jogar" onChange={setMode} />
```

Works controlled (`value` + `onChange`) or uncontrolled (`defaultValue`). The active segment gets the violet fill; inactive segments are muted and brighten on hover.
