// Perícias panel — all 17 skills in two columns, always visible.
const { Panel, SkillRow } = window.FusionVTTDesignSystem_1daa5f;

function SkillsPanel({ c }) {
  const half = Math.ceil(c.skills.length / 2);
  const left = c.skills.slice(0, half);
  const right = c.skills.slice(half);
  return (
    <Panel title="Perícias">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
        <div>{left.map((s) => <SkillRow key={s.name} rank={s.rank} name={s.name} modifier={s.mod} />)}</div>
        <div>{right.map((s) => <SkillRow key={s.name} rank={s.rank} name={s.name} modifier={s.mod} />)}</div>
      </div>
    </Panel>
  );
}

window.SkillsPanel = SkillsPanel;
