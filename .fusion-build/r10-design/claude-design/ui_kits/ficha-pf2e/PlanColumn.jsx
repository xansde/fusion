// Plan column: ABC cards + level-by-level assembly (Pathbuilder style).
const { ABCCard, LevelCard, Slot, EmptySlot, OptionalBadge, Button } = window.FusionVTTDesignSystem_1daa5f;

function PlanColumn({ c, onHide }) {
  return (
    <div style={{
      width: 300, flexShrink: 0, borderRight: "1px solid var(--fusion-border)",
      background: "var(--fusion-surface)", display: "flex", flexDirection: "column",
      overflowY: "auto", padding: 12, gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Plano</h2>
        <Button variant="secondary" size="tiny" onClick={onHide}>Ocultar plano</Button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {c.plan.abc.map((a) => (
          <ABCCard key={a.typeLabel} typeLabel={a.typeLabel} name={a.name} subLine={a.subLine} />
        ))}
      </div>

      {c.plan.levels.map((lv) => (
        <LevelCard key={lv.level} level={lv.level} autoFeatures={lv.auto}>
          {lv.slots.map((s) => (
            <Slot key={s.name} name={s.name} type={s.type}
                  badge={s.optional ? <OptionalBadge /> : undefined} onRemove={() => {}} />
          ))}
          {lv.empty && <EmptySlot>{lv.empty}</EmptySlot>}
        </LevelCard>
      ))}

      <div style={{ marginTop: "auto", paddingTop: 8 }}>
        <Button variant="primary" size="lg" fullWidth>Subir de nível → 4</Button>
      </div>
    </div>
  );
}

window.PlanColumn = PlanColumn;
