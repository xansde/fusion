// Character header: identity + always-visible stat block.
const { StatChip, ACShield, PipRow } = window.FusionVTTDesignSystem_1daa5f;

function CharacterHeader({ c }) {
  return (
    <div style={{
      display: "flex", gap: 20, alignItems: "flex-start",
      background: "var(--fusion-surface-alt)", border: "1px solid var(--fusion-border)",
      borderRadius: "var(--fusion-radius)", padding: 16,
    }}>
      <div style={{ flexShrink: 0, width: 210 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" }}>{c.name}</h1>
        <div style={{ fontSize: 12, color: "var(--fusion-text-muted)", lineHeight: 1.5 }}>{c.identity}</div>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", flex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--fusion-text-subtle)" }}>HP</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input defaultValue={c.hp.current} style={{
              width: 48, textAlign: "center", fontSize: 16, fontWeight: 600,
              background: "var(--fusion-surface)", border: "1px solid var(--fusion-border)",
              color: "var(--fusion-text)", borderRadius: "var(--fusion-radius-sm)", padding: "4px 2px",
              fontFamily: "var(--fusion-font-mono)",
            }} />
            <span style={{ fontSize: 16, color: "var(--fusion-text-muted)", fontFamily: "var(--fusion-font-mono)" }}>/ {c.hp.max}</span>
          </div>
        </div>

        <ACShield value={c.ac} />

        <div style={{ display: "flex", gap: 6 }}>
          {c.saves.map((s) => <StatChip key={s.label} label={s.label} value={s.value} />)}
          <StatChip label="Percepção" value={c.perception} />
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {c.attrs.map((a) => <StatChip key={a.label} label={a.label} value={a.value} minWidth={42} />)}
        </div>

        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <PipRow label="Heroísmo" filled={c.heroism.filled} cap={c.heroism.cap} />
          <PipRow label="Foco" filled={c.focus.filled} total={c.focus.total} cap={c.focus.cap}
                  lockedTitle="Além do seu máximo atual de Pontos de Foco (1)" />
        </div>
      </div>
    </div>
  );
}

window.CharacterHeader = CharacterHeader;
