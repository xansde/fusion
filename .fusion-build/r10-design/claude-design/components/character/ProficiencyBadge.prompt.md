ProficiencyBadge — the TEML rank glyph shown beside every skill, save and spell proficiency. Colour encodes rank: U grey, T violet, E green, M amber, L red.

```jsx
<ProficiencyBadge rank="T" />                 {/* outline, skill rows */}
<ProficiencyBadge rank="M" variant="filled" size={26} />  {/* specimen / stat bar */}
```

`outline` = coloured letter + border on transparent (dense sheet rows). `filled` = tinted wash + border (larger specimen badges). `title` defaults to the Portuguese rank name.
