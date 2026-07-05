SkillRow — one line in the Perícias panel. Shows the TEML badge, skill name, a ⚁ d20 hint that fades in on hover, and the modifier in mono. Untrained (`U`) rows are dimmed but stay visible — the sheet lists all 17 skills always.

```jsx
<SkillRow rank="T" name="Arcanismo" modifier="+8" onRoll={roll} />
<SkillRow rank="U" name="Atletismo" modifier="+0" />   {/* dimmed */}
```

Lay two columns of these inside a `Panel title="Perícias"`. The whole row is the click target.
